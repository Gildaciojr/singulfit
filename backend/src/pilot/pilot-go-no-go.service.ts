import { Injectable, NotFoundException } from '@nestjs/common';
import {
  PilotGoStatus,
  PilotManualCheckStatus,
  Severity,
} from '@prisma/client';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductionReadinessService } from '../production/production-readiness.service';
import { PilotGoAssessment, PilotGoCheck } from './interfaces/pilot.interface';
import {
  PILOT_EVENT,
  PILOT_SMOKE_EVENT,
  PILOT_SOURCE,
  REQUIRED_PILOT_CHECKS,
} from './pilot.constants';
import { PilotMetricsService } from './pilot-metrics.service';

const SMOKE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

@Injectable()
export class PilotGoNoGoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly readinessService: ProductionReadinessService,
    private readonly metricsService: PilotMetricsService,
    private readonly events: EventService,
  ) {}

  async evaluate(
    cohortId: string,
    evaluatedAt = new Date(),
  ): Promise<PilotGoAssessment> {
    const cohort = await this.prisma.pilotCohort.findUnique({
      where: { id: cohortId },
      include: { manualChecks: true },
    });

    if (!cohort) {
      throw new NotFoundException('Coorte piloto não encontrada');
    }

    const [readiness, metrics, smoke, criticalErrors, errors] =
      await Promise.all([
        this.readinessService.check(),
        this.metricsService.calculate(cohortId),
        this.prisma.systemEvent.findFirst({
          where: {
            eventType: {
              in: [
                PILOT_SMOKE_EVENT.STARTED,
                PILOT_SMOKE_EVENT.PASSED,
                PILOT_SMOKE_EVENT.FAILED,
              ],
            },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
        this.prisma.systemEvent.count({
          where: {
            severity: Severity.CRITICAL,
            createdAt: {
              gte: cohort.startsAt,
              lte: evaluatedAt,
            },
          },
        }),
        this.prisma.systemEvent.count({
          where: {
            severity: Severity.ERROR,
            createdAt: {
              gte: cohort.startsAt,
              lte: evaluatedAt,
            },
          },
        }),
      ]);
    const checks: PilotGoCheck[] = [
      this.readinessCheck(readiness.status),
      this.componentCheck(
        'WORKERS',
        readiness.checks.workers.status,
        'Heartbeats dos workers',
        readiness.checks.workers.detail,
      ),
      this.smokeCheck(smoke, evaluatedAt),
      this.componentCheck(
        'PAGBANK_CONFIG',
        readiness.checks.pagbank.status,
        'Configuração do PagBank',
        readiness.checks.pagbank.detail,
      ),
      this.componentCheck(
        'EVOLUTION_CONFIG',
        readiness.checks.evolution.status,
        'Configuração da Evolution',
        readiness.checks.evolution.detail,
      ),
      this.componentCheck(
        'OPENAI_CONFIG',
        readiness.checks.openai.status,
        'Configuração da OpenAI',
        readiness.checks.openai.detail,
      ),
      this.deadLetterCheck(readiness.checks.outbox.detail),
      this.errorCheck(criticalErrors, errors),
      this.activationCheck(metrics),
      this.aiQualityCheck(metrics),
    ];
    const manualChecks = REQUIRED_PILOT_CHECKS.map((checkType) => {
      const check = cohort.manualChecks.find(
        (candidate) => candidate.checkType === checkType,
      );

      return {
        checkType,
        status: check?.status ?? ('MISSING' as const),
        notes: check?.notes ?? null,
        checkedAt: check?.checkedAt.toISOString() ?? null,
      };
    });

    for (const check of manualChecks) {
      checks.push({
        code: `MANUAL_${check.checkType}`,
        status:
          check.status === PilotManualCheckStatus.PASSED
            ? PilotGoStatus.GO
            : check.status === PilotManualCheckStatus.WAIVED
              ? PilotGoStatus.WARNING
              : PilotGoStatus.NO_GO,
        message:
          check.status === 'MISSING'
            ? `Check ${check.checkType} sem evidência`
            : `Check ${check.checkType}: ${check.status}`,
        evidence: {
          checkedAt: check.checkedAt,
          notes: check.notes,
        },
      });
    }

    const status = checks.some((check) => check.status === PilotGoStatus.NO_GO)
      ? PilotGoStatus.NO_GO
      : checks.some((check) => check.status === PilotGoStatus.WARNING)
        ? PilotGoStatus.WARNING
        : PilotGoStatus.GO;
    const assessment = {
      status,
      evaluatedAt: evaluatedAt.toISOString(),
      checks,
      manualChecks,
    };

    await this.persistStatusChange(cohortId, status, evaluatedAt);

    return assessment;
  }

  private readinessCheck(status: 'ok' | 'degraded' | 'down'): PilotGoCheck {
    return {
      code: 'HEALTH',
      status:
        status === 'ok'
          ? PilotGoStatus.GO
          : status === 'degraded'
            ? PilotGoStatus.WARNING
            : PilotGoStatus.NO_GO,
      message: `Readiness geral: ${status}`,
    };
  }

  private componentCheck(
    code: string,
    status: 'UP' | 'DEGRADED' | 'DOWN',
    label: string,
    detail: Record<string, unknown>,
  ): PilotGoCheck {
    return {
      code,
      status:
        status === 'UP'
          ? PilotGoStatus.GO
          : status === 'DEGRADED'
            ? PilotGoStatus.WARNING
            : PilotGoStatus.NO_GO,
      message: `${label}: ${status}`,
      evidence: detail,
    };
  }

  private smokeCheck(
    smoke: { eventType: string; createdAt: Date } | null,
    evaluatedAt: Date,
  ): PilotGoCheck {
    const ageMs = smoke
      ? Math.max(0, evaluatedAt.getTime() - smoke.createdAt.getTime())
      : null;
    const passed =
      smoke?.eventType === PILOT_SMOKE_EVENT.PASSED &&
      ageMs !== null &&
      ageMs <= SMOKE_MAX_AGE_MS;

    return {
      code: 'SMOKE',
      status: passed ? PilotGoStatus.GO : PilotGoStatus.NO_GO,
      message: passed
        ? 'Smoke recente concluído com sucesso'
        : 'Smoke ausente, falho, em execução ou expirado',
      evidence: {
        eventType: smoke?.eventType ?? null,
        executedAt: smoke?.createdAt.toISOString() ?? null,
        maximumAgeHours: 24,
      },
    };
  }

  private deadLetterCheck(detail: Record<string, unknown>): PilotGoCheck {
    const deadLetters =
      typeof detail.deadLetter === 'number' ? detail.deadLetter : 0;

    return {
      code: 'DEAD_LETTERS',
      status: deadLetters > 0 ? PilotGoStatus.NO_GO : PilotGoStatus.GO,
      message:
        deadLetters > 0
          ? `${deadLetters} evento(s) em dead letter`
          : 'Sem dead letters',
      evidence: { deadLetters },
    };
  }

  private errorCheck(criticalErrors: number, errors: number): PilotGoCheck {
    const status =
      criticalErrors > 0 || errors >= 5
        ? PilotGoStatus.NO_GO
        : errors > 0
          ? PilotGoStatus.WARNING
          : PilotGoStatus.GO;

    return {
      code: 'ERRORS',
      status,
      message: `${criticalErrors} erro(s) crítico(s) e ${errors} erro(s) operacionais`,
      evidence: { criticalErrors, errors },
    };
  }

  private activationCheck(
    metrics: Awaited<ReturnType<PilotMetricsService['calculate']>>,
  ): PilotGoCheck {
    const status =
      metrics.invitedUsers === 0
        ? PilotGoStatus.WARNING
        : metrics.initialChurnRate >= 40
          ? PilotGoStatus.NO_GO
          : metrics.initialChurnRate >= 20 || metrics.activatedUsers === 0
            ? PilotGoStatus.WARNING
            : PilotGoStatus.GO;

    return {
      code: 'ACTIVATION',
      status,
      message: `Ativação ${metrics.activationRate}% e churn inicial ${metrics.initialChurnRate}%`,
      evidence: {
        invitedUsers: metrics.invitedUsers,
        activatedUsers: metrics.activatedUsers,
        initialChurnUsers: metrics.initialChurnUsers,
      },
    };
  }

  private aiQualityCheck(
    metrics: Awaited<ReturnType<PilotMetricsService['calculate']>>,
  ): PilotGoCheck {
    if (metrics.aiEvaluations === 0 || metrics.averageAIQuality === null) {
      return {
        code: 'AI_QUALITY',
        status: PilotGoStatus.WARNING,
        message: 'Ainda não há avaliações de qualidade de IA na coorte',
      };
    }

    const blockedRate =
      (metrics.blockedAIResponses / metrics.aiEvaluations) * 100;
    const fallbackRate =
      (metrics.fallbackAIResponses / metrics.aiEvaluations) * 100;
    const status =
      metrics.averageAIQuality < 60 || blockedRate > 5
        ? PilotGoStatus.NO_GO
        : metrics.averageAIQuality < 75 || fallbackRate > 15
          ? PilotGoStatus.WARNING
          : PilotGoStatus.GO;

    return {
      code: 'AI_QUALITY',
      status,
      message: `Qualidade média ${metrics.averageAIQuality}/100`,
      evidence: {
        evaluations: metrics.aiEvaluations,
        averageQuality: metrics.averageAIQuality,
        averageSafety: metrics.averageAISafety,
        blockedRate: Number(blockedRate.toFixed(2)),
        fallbackRate: Number(fallbackRate.toFixed(2)),
      },
    };
  }

  private async persistStatusChange(
    cohortId: string,
    status: PilotGoStatus,
    evaluatedAt: Date,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        WITH advisory_lock AS (
          SELECT pg_advisory_xact_lock(hashtext(${`pilot-go:${cohortId}`}))
        )
        SELECT true AS "locked"
        FROM advisory_lock
      `;
      const cohort = await transaction.pilotCohort.findUniqueOrThrow({
        where: { id: cohortId },
        select: { lastGoStatus: true },
      });
      const previousStatus = cohort.lastGoStatus;
      await transaction.pilotCohort.update({
        where: { id: cohortId },
        data: {
          lastGoStatus: status,
          goEvaluatedAt: evaluatedAt,
        },
      });

      if (previousStatus === status) {
        return;
      }

      await this.events.recordInTransaction(transaction, {
        source: PILOT_SOURCE,
        severity:
          status === PilotGoStatus.NO_GO ? Severity.WARNING : Severity.INFO,
        eventType: PILOT_EVENT.GO_STATUS_CHANGED,
        message: 'Status GO/NO-GO do piloto alterado',
        metadata: {
          cohortId,
          previousStatus,
          status,
          evaluatedAt: evaluatedAt.toISOString(),
        },
      });
    });
  }
}
