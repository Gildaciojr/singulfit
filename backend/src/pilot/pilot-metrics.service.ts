import { Injectable, NotFoundException } from '@nestjs/common';
import {
  MessageDirection,
  OutboundMessageStatus,
  PilotParticipantStatus,
  Prisma,
  ScheduledMessageStatus,
  Severity,
} from '@prisma/client';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { PilotMetricSummary } from './interfaces/pilot.interface';
import { PILOT_EVENT, PILOT_SOURCE } from './pilot.constants';

@Injectable()
export class PilotMetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventService,
  ) {}

  async calculate(cohortId: string): Promise<PilotMetricSummary> {
    await this.synchronizeActivatedParticipants(cohortId);
    const cohort = await this.prisma.pilotCohort.findUnique({
      where: { id: cohortId },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                createdAt: true,
                activation: {
                  select: {
                    paidAt: true,
                    firstMealReceivedAt: true,
                    firstAnalysisCompletedAt: true,
                    firstRecommendationDeliveredAt: true,
                    firstCoachInteractionAt: true,
                    activatedAt: true,
                    abandonedAt: true,
                  },
                },
                subscriptions: {
                  where: { paidAt: { not: null } },
                  select: { id: true, paidAt: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });

    if (!cohort) {
      throw new NotFoundException('Coorte piloto não encontrada');
    }

    const from = cohort.startsAt;
    const to = new Date(
      Math.max(from.getTime(), Math.min(cohort.endsAt.getTime(), Date.now())),
    );
    const userIds = cohort.participants.map(
      (participant) => participant.userId,
    );
    const userFilter = userIds.length > 0 ? { in: userIds } : { in: [''] };
    const [
      aiQuality,
      blockedAIResponses,
      fallbackAIResponses,
      usage,
      receivedMessages,
      responseMessages,
      automationMessages,
      aiCost,
      whatsappCost,
      storageCost,
    ] = await Promise.all([
      this.prisma.aIResponseEvaluation.aggregate({
        where: {
          userId: userFilter,
          evaluatedAt: { gte: from, lte: to },
        },
        _avg: {
          qualityScore: true,
          safetyScore: true,
        },
        _count: { _all: true },
      }),
      this.prisma.aIResponseEvaluation.count({
        where: {
          userId: userFilter,
          evaluatedAt: { gte: from, lte: to },
          blocked: true,
        },
      }),
      this.prisma.aIResponseEvaluation.count({
        where: {
          userId: userFilter,
          evaluatedAt: { gte: from, lte: to },
          fallbackUsed: true,
        },
      }),
      this.prisma.usageDaily.aggregate({
        where: {
          userId: userFilter,
          date: { gte: from, lte: to },
        },
        _avg: { imagesUsed: true },
      }),
      this.prisma.message.count({
        where: {
          direction: MessageDirection.INBOUND,
          timestamp: { gte: from, lte: to },
          conversation: { userId: userFilter },
        },
      }),
      this.prisma.outboundMessage.count({
        where: {
          userId: userFilter,
          status: {
            in: [OutboundMessageStatus.SENT, OutboundMessageStatus.DELIVERED],
          },
          sentAt: { gte: from, lte: to },
        },
      }),
      this.prisma.scheduledMessage.count({
        where: {
          userId: userFilter,
          status: ScheduledMessageStatus.SENT,
          scheduledFor: { gte: from, lte: to },
        },
      }),
      this.prisma.aIUsage.aggregate({
        where: {
          userId: userFilter,
          createdAt: { gte: from, lte: to },
        },
        _sum: { estimatedCost: true },
      }),
      this.prisma.whatsAppCostSnapshot.aggregate({
        where: {
          userId: userFilter,
          snapshotDate: { gte: from, lte: to },
        },
        _sum: { estimatedCost: true },
      }),
      this.prisma.storageCostSnapshot.aggregate({
        where: {
          userId: userFilter,
          snapshotDate: { gte: from, lte: to },
        },
        _sum: { estimatedCost: true },
      }),
    ]);
    const invitedUsers = cohort.participants.length;
    const registeredUsers = cohort.participants.filter(
      (participant) => participant.user.createdAt <= to,
    ).length;
    const paidUsers = cohort.participants.filter(
      (participant) =>
        this.inPeriod(participant.user.activation?.paidAt, from, to) ||
        participant.user.subscriptions.some((subscription) =>
          this.inPeriod(subscription.paidAt, from, to),
        ),
    ).length;
    const activatedUsers = cohort.participants.filter((participant) =>
      this.inPeriod(participant.user.activation?.activatedAt, from, to),
    ).length;
    const firstMealUsers = cohort.participants.filter((participant) =>
      this.inPeriod(participant.user.activation?.firstMealReceivedAt, from, to),
    ).length;
    const firstAnalysisUsers = cohort.participants.filter((participant) =>
      this.inPeriod(
        participant.user.activation?.firstAnalysisCompletedAt,
        from,
        to,
      ),
    ).length;
    const firstRecommendationUsers = cohort.participants.filter((participant) =>
      this.inPeriod(
        participant.user.activation?.firstRecommendationDeliveredAt,
        from,
        to,
      ),
    ).length;
    const firstCoachUsers = cohort.participants.filter((participant) =>
      this.inPeriod(
        participant.user.activation?.firstCoachInteractionAt,
        from,
        to,
      ),
    ).length;
    const initialChurnUsers = cohort.participants.filter(
      (participant) =>
        participant.status === PilotParticipantStatus.DROPPED ||
        this.inPeriod(participant.user.activation?.abandonedAt, from, to),
    ).length;
    const retainedUsers = invitedUsers - initialChurnUsers;
    const aiUsd = aiCost._sum.estimatedCost ?? new Prisma.Decimal(0);
    const whatsappBrl =
      whatsappCost._sum.estimatedCost ?? new Prisma.Decimal(0);
    const storageBrl = storageCost._sum.estimatedCost ?? new Prisma.Decimal(0);
    const operationalBrl = whatsappBrl.add(storageBrl);

    return {
      invitedUsers,
      registeredUsers,
      paidUsers,
      activatedUsers,
      firstMealUsers,
      firstAnalysisUsers,
      firstRecommendationUsers,
      firstCoachUsers,
      initialChurnUsers,
      activationRate: this.rate(activatedUsers, invitedUsers),
      initialChurnRate: this.rate(initialChurnUsers, invitedUsers),
      retentionRate: this.rate(retainedUsers, invitedUsers),
      averageAIQuality: this.round(aiQuality._avg.qualityScore),
      averageAISafety: this.round(aiQuality._avg.safetyScore),
      aiEvaluations: aiQuality._count._all,
      blockedAIResponses,
      fallbackAIResponses,
      averageDailyUsage: this.round(usage._avg.imagesUsed) ?? 0,
      receivedMessages,
      sentMessages: responseMessages + automationMessages,
      costs: {
        aiUsd: aiUsd.toFixed(8),
        whatsappBrl: whatsappBrl.toFixed(8),
        storageBrl: storageBrl.toFixed(8),
        aiUsdPerUser: this.perUser(aiUsd, invitedUsers),
        operationalBrlPerUser: this.perUser(operationalBrl, invitedUsers),
      },
      period: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
    };
  }

  private async synchronizeActivatedParticipants(cohortId: string) {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        WITH advisory_lock AS (
          SELECT pg_advisory_xact_lock(hashtext(${`pilot-activation:${cohortId}`}))
        )
        SELECT true AS "locked"
        FROM advisory_lock
      `;
      const participants = await transaction.pilotParticipant.findMany({
        where: {
          cohortId,
          activatedAt: null,
          status: {
            notIn: [
              PilotParticipantStatus.COMPLETED,
              PilotParticipantStatus.DROPPED,
            ],
          },
          user: {
            activation: {
              activatedAt: { not: null },
            },
          },
        },
        include: {
          user: {
            select: {
              activation: {
                select: { activatedAt: true },
              },
            },
          },
        },
      });

      for (const participant of participants) {
        const activatedAt = participant.user.activation?.activatedAt;

        if (!activatedAt) {
          continue;
        }

        const updated = await transaction.pilotParticipant.updateMany({
          where: {
            id: participant.id,
            activatedAt: null,
          },
          data: {
            status: PilotParticipantStatus.ACTIVATED,
            activatedAt,
          },
        });

        if (updated.count === 1) {
          await this.events.recordInTransaction(transaction, {
            source: PILOT_SOURCE,
            severity: Severity.INFO,
            eventType: PILOT_EVENT.PARTICIPANT_ACTIVATED,
            message: 'Participante da coorte piloto ativado',
            metadata: {
              cohortId,
              participantId: participant.id,
              userId: participant.userId,
              activatedAt: activatedAt.toISOString(),
            },
          });
        }
      }
    });
  }

  private rate(value: number, total: number): number {
    return total > 0 ? Number(((value / total) * 100).toFixed(2)) : 0;
  }

  private round(value: number | null): number | null {
    return value === null ? null : Number(value.toFixed(2));
  }

  private perUser(value: Prisma.Decimal, users: number): string {
    return users > 0 ? value.div(users).toFixed(8) : '0.00000000';
  }

  private inPeriod(
    value: Date | null | undefined,
    from: Date,
    to: Date,
  ): boolean {
    return Boolean(value && value >= from && value <= to);
  }
}
