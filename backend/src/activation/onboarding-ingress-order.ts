import { ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { INTERNAL_EVENT } from '../event-bus/event-bus.constants';
import { DeliveryPendingError } from '../event-bus/delivery-pending.error';

// OFF disables new admissions only. Persisted positions are always enforced.
export function ingressOrderingMode(): 'OFF' | 'DRAIN' | 'REQUIRED' {
  const mode = process.env.ONBOARDING_INGRESS_ORDERING_MODE ?? 'OFF';
  if (mode !== 'OFF' && mode !== 'DRAIN' && mode !== 'REQUIRED')
    throw new ServiceUnavailableException(
      'Invalid onboarding ingress ordering mode',
    );
  return mode;
}

export function ingressOrderingRequired(): boolean {
  return ingressOrderingMode() !== 'OFF';
}

export async function admitOrderedText(
  transaction: Prisma.TransactionClient,
  userId: string,
  input: {
    instanceName: string;
    externalMessageId: string;
    payload: Prisma.InputJsonValue;
  },
) {
  await transaction.$queryRaw`
    WITH locked AS (SELECT pg_advisory_xact_lock(hashtext(${`onboarding-admission:${userId}`})))
    SELECT true FROM locked
  `;
  const existing = await transaction.evolutionInboundEvent.findUnique({
    where: {
      instanceName_externalMessageId: {
        instanceName: input.instanceName,
        externalMessageId: input.externalMessageId,
      },
    },
  });
  if (existing) {
    if (existing.orderingUserId && existing.orderingUserId !== userId)
      throw new ServiceUnavailableException(
        'Ingress identity changed; operational review required',
      );
    return { event: existing, duplicated: true };
  }
  const user = await transaction.user.update({
    where: { id: userId },
    data: { onboardingIngressCounter: { increment: 1 } },
    select: { onboardingIngressCounter: true },
  });
  const event = await transaction.evolutionInboundEvent.create({
    data: {
      ...input,
      orderingUserId: userId,
      admissionSequence: user.onboardingIngressCounter,
      createdAt: new Date(),
    },
  });
  return { event, duplicated: false };
}

export async function assertOrderedTurn(
  transaction: Prisma.TransactionClient,
  userId: string,
  message: {
    id: string;
    instanceName?: string | null;
    externalMessageId?: string | null;
  },
  safety: boolean,
) {
  const receipt =
    message.instanceName && message.externalMessageId
      ? await transaction.evolutionInboundEvent.findUnique({
          where: {
            instanceName_externalMessageId: {
              instanceName: message.instanceName,
              externalMessageId: message.externalMessageId,
            },
          },
        })
      : null;
  if (receipt?.orderingUserId && receipt.orderingUserId !== userId)
    throw new ServiceUnavailableException('Onboarding ingress owner mismatch');
  // Urgent safety replies do not advance profile fields or confirm dietary data.
  if (safety) return receipt;
  if (!receipt?.admissionSequence) {
    const mode = ingressOrderingMode();
    if (mode === 'REQUIRED')
      throw new ServiceUnavailableException(
        'UNSEQUENCED_ONBOARDING_TURN: drain historical consumers before enabling REQUIRED',
      );
    if (mode === 'DRAIN') return receipt;
    const pending = await transaction.evolutionInboundEvent.findFirst({
      where: {
        orderingUserId: userId,
        admissionSequence: { not: null },
        turnProcessedAt: null,
      },
      select: { id: true },
    });
    if (pending)
      throw new DeliveryPendingError(`ORDERING_PREDECESSOR:${pending.id}`);
    return receipt;
  }
  if (ingressOrderingMode() === 'DRAIN')
    throw new DeliveryPendingError(`ORDERING_DRAIN_BARRIER:${receipt.id}`);
  const historical = await transaction.$queryRaw<
    readonly { id: string; status: string }[]
  >`
    SELECT event."id", event."status"::text AS status
    FROM "outbox_events" event
    JOIN "messages" message ON message."id" = event."aggregateId"
    JOIN "conversations" conversation ON conversation."id" = message."conversationId"
    LEFT JOIN "evolution_inbound_events" inbox
      ON inbox."instanceName" = message."instanceName" AND inbox."externalMessageId" = message."externalMessageId"
    WHERE event."eventType" = ${INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED}
      AND conversation."userId" = ${userId} AND message."id" <> ${message.id}
      AND event."status" <> 'PROCESSED'::"OutboxStatus"
      AND inbox."admissionSequence" IS NULL
    LIMIT 1
  `;
  if (historical[0]) {
    if (historical[0].status === 'DEAD_LETTER')
      throw new ServiceUnavailableException(
        `ORDERING_HISTORICAL_DEAD_LETTER:${historical[0].id}`,
      );
    throw new DeliveryPendingError(
      `ORDERING_HISTORICAL_PREDECESSOR:${historical[0].id}`,
    );
  }
  const predecessor = await transaction.evolutionInboundEvent.findFirst({
    where: {
      orderingUserId: userId,
      admissionSequence: { lt: receipt.admissionSequence },
      turnProcessedAt: null,
    },
    orderBy: { admissionSequence: 'asc' },
  });
  if (predecessor) {
    const blocked = await transaction.outboxEvent.findFirst({
      where: {
        eventType: INTERNAL_EVENT.WHATSAPP_MESSAGE_RECEIVED,
        aggregateId: predecessor.id,
        status: 'DEAD_LETTER',
      },
      select: { id: true },
    });
    const failedTurn = await transaction.$queryRaw<readonly { id: string }[]>`
      SELECT event."id" FROM "outbox_events" event
      JOIN "messages" message ON message."id" = event."aggregateId"
      WHERE event."eventType" = ${INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED}
        AND event."status" = 'DEAD_LETTER'::"OutboxStatus"
        AND message."instanceName" = ${predecessor.instanceName}
        AND message."externalMessageId" = ${predecessor.externalMessageId} LIMIT 1
    `;
    if (blocked || failedTurn[0])
      throw new ServiceUnavailableException(
        `ORDERING_DEAD_LETTER:${blocked?.id ?? failedTurn[0].id}`,
      );
    throw new DeliveryPendingError(`ORDERING_PREDECESSOR:${predecessor.id}`);
  }
  return receipt;
}
