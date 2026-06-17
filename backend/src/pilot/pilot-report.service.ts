import { Injectable, NotFoundException } from '@nestjs/common';
import { Severity } from '@prisma/client';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { PILOT_EVENT, PILOT_SOURCE } from './pilot.constants';
import { PilotGoNoGoService } from './pilot-go-no-go.service';
import { PilotMetricsService } from './pilot-metrics.service';

@Injectable()
export class PilotReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: PilotMetricsService,
    private readonly goNoGo: PilotGoNoGoService,
    private readonly events: EventService,
  ) {}

  async generate(cohortId: string, generatedAt = new Date()) {
    const cohort = await this.prisma.pilotCohort.findUnique({
      where: { id: cohortId },
      include: {
        participants: {
          select: {
            id: true,
            userId: true,
            status: true,
            joinedAt: true,
            activatedAt: true,
            completedAt: true,
            droppedAt: true,
          },
        },
      },
    });

    if (!cohort) {
      throw new NotFoundException('Coorte piloto não encontrada');
    }

    const [metrics, decision, failures] = await Promise.all([
      this.metrics.calculate(cohortId),
      this.goNoGo.evaluate(cohortId, generatedAt),
      this.prisma.systemEvent.findMany({
        where: {
          severity: { in: [Severity.ERROR, Severity.CRITICAL] },
          createdAt: {
            gte: cohort.startsAt,
            lte: generatedAt,
          },
        },
        select: {
          id: true,
          source: true,
          severity: true,
          eventType: true,
          message: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
      }),
    ]);
    const risks = decision.checks
      .filter((check) => check.status !== 'GO')
      .map((check) => ({
        code: check.code,
        status: check.status,
        description: check.message,
        evidence: check.evidence ?? {},
      }));
    const report = {
      generatedAt: generatedAt.toISOString(),
      summary: {
        cohort: {
          id: cohort.id,
          name: cohort.name,
          description: cohort.description,
          status: cohort.status,
          startsAt: cohort.startsAt,
          endsAt: cohort.endsAt,
        },
        participants: cohort.participants.length,
        recommendedDecision: decision.status,
      },
      metrics,
      risks,
      failures,
      costs: metrics.costs,
      retention: {
        retainedUsers: metrics.invitedUsers - metrics.initialChurnUsers,
        retentionRate: metrics.retentionRate,
        initialChurnUsers: metrics.initialChurnUsers,
        initialChurnRate: metrics.initialChurnRate,
      },
      aiQuality: {
        evaluations: metrics.aiEvaluations,
        averageQuality: metrics.averageAIQuality,
        averageSafety: metrics.averageAISafety,
        blockedResponses: metrics.blockedAIResponses,
        fallbackResponses: metrics.fallbackAIResponses,
      },
      decision,
    };

    await this.events.record({
      source: PILOT_SOURCE,
      severity: Severity.INFO,
      eventType: PILOT_EVENT.REPORT_GENERATED,
      message: 'Relatório da coorte piloto gerado',
      metadata: {
        cohortId,
        recommendedDecision: decision.status,
        generatedAt: generatedAt.toISOString(),
      },
    });

    return report;
  }
}
