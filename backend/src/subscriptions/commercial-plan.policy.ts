import { ConflictException, NotFoundException } from '@nestjs/common';
import { PlanType, Prisma } from '@prisma/client';

export const commercialPlanInclude = {
  entitlements: { include: { entitlement: true } },
} satisfies Prisma.PlanInclude;

export type CommercialOffer = Prisma.PlanGetPayload<{
  include: typeof commercialPlanInclude;
}>;

export const BASIC_V2_GRANTS = {
  AUDIO_TRANSCRIPTION: 30,
  IMAGE_ANALYSIS: 30,
  NUTRITION_PLAN_GENERATION: 2,
  WORKOUT_PLAN_GENERATION: 2,
} as const;

export function assertCurrentCommercialOffer(plan: CommercialOffer): void {
  if (!plan.isCurrentOffer || !plan.isActive || !plan.price.isPositive()) {
    throw new ConflictException('Oferta comercial indisponível');
  }
  if (plan.contractVersion === 'legacy-v1') return;
  if (
    plan.type !== PlanType.BASIC ||
    plan.contractVersion !== 'basic-v2' ||
    !plan.price.equals('29.90') ||
    plan.currency !== 'BRL' ||
    plan.billingInterval !== 'MONTH' ||
    plan.billingIntervalCount !== 1 ||
    plan.imageLimit !== 30 ||
    plan.imageUnlimited
  ) {
    throw new ConflictException(
      'Contrato da oferta comercial não provisionado',
    );
  }
  for (const [code, quantity] of Object.entries(BASIC_V2_GRANTS)) {
    const grants = plan.entitlements.filter(
      (grant) => grant.entitlement.code === code,
    );
    if (
      grants.length !== 1 ||
      grants[0].unlimited ||
      grants[0].value !== quantity
    )
      throw new ConflictException('Direitos da oferta comercial incompletos');
  }
  if (
    plan.entitlements.some((grant) =>
      ['IMAGE_ANALYSIS_DAILY', 'IMAGE_ANALYSIS_MONTHLY'].includes(
        grant.entitlement.code,
      ),
    )
  )
    throw new ConflictException(
      'Oferta comercial com cotas legadas conflitantes',
    );
}

export async function lockCurrentCommercialOffer(
  transaction: Prisma.TransactionClient,
  type: PlanType,
  expectedPlanId?: string,
): Promise<CommercialOffer> {
  const rows = await transaction.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "plans"
    WHERE "type" = ${type}::"PlanType" AND "isCurrentOffer" AND "isActive"
    FOR SHARE
  `;
  if (rows.length !== 1)
    throw new NotFoundException('Oferta atual não encontrada');
  if (expectedPlanId && rows[0].id !== expectedPlanId)
    throw new ConflictException(
      'A oferta mudou; confira o contrato atualizado',
    );
  const plan = await transaction.plan.findUniqueOrThrow({
    where: { id: rows[0].id },
    include: commercialPlanInclude,
  });
  assertCurrentCommercialOffer(plan);
  if (plan.contractVersion !== 'legacy-v1' && !expectedPlanId)
    throw new ConflictException(
      'Confirme a identidade da oferta apresentada antes de contratar',
    );
  return plan;
}

export async function assertDisposableCommercialSeed(
  transaction: Prisma.TransactionClient,
  authorized: boolean,
): Promise<void> {
  if (!authorized)
    throw new ConflictException(
      'Seed permitido somente em banco descartável autorizado',
    );
  const [plans, subscriptions] = await Promise.all([
    transaction.plan.count(),
    transaction.subscription.count(),
  ]);
  if (plans !== 0 || subscriptions !== 0)
    throw new ConflictException(
      'Seed não pode sobrescrever ofertas ou contratos',
    );
}
