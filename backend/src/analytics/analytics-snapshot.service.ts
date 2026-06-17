import { Injectable } from '@nestjs/common';
import { Currency, Prisma, Severity } from '@prisma/client';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsDateService } from './analytics-date.service';
import { ChurnAnalyticsService } from './churn-analytics.service';
import { CostAnalyticsService } from './cost-analytics.service';
import { GrowthAnalyticsService } from './growth-analytics.service';
import { PlanPerformanceService } from './plan-performance.service';
import { RetentionAnalyticsService } from './retention-analytics.service';
import { RevenueMetricsService } from './revenue-metrics.service';
import { UserProfitabilityService } from './user-profitability.service';

const ANALYTICS_SOURCE = 'SAAS_ANALYTICS';

@Injectable()
export class AnalyticsSnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dates: AnalyticsDateService,
    private readonly revenue: RevenueMetricsService,
    private readonly churn: ChurnAnalyticsService,
    private readonly retention: RetentionAnalyticsService,
    private readonly costs: CostAnalyticsService,
    private readonly profitability: UserProfitabilityService,
    private readonly plans: PlanPerformanceService,
    private readonly growth: GrowthAnalyticsService,
    private readonly events: EventService,
  ) {}

  async ensureDaily(value = new Date()) {
    const snapshotDate = this.dates.utcDay(value);
    const existing = await this.prisma.revenueSnapshot.findUnique({
      where: {
        snapshotDate,
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      return {
        snapshotDate,
        generated: false,
      };
    }

    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          WITH advisory_lock AS (
            SELECT pg_advisory_xact_lock(
              hashtext(${`saas-analytics:${snapshotDate.toISOString().slice(0, 10)}`})
            )
          )
          SELECT true AS "locked"
          FROM advisory_lock
        `;

        const concurrent = await transaction.revenueSnapshot.findUnique({
          where: {
            snapshotDate,
          },
          select: {
            id: true,
          },
        });

        if (concurrent) {
          return {
            snapshotDate,
            generated: false,
          };
        }

        const generatedAt = new Date();
        const revenue = await this.revenue.calculate(snapshotDate, transaction);
        const [churn, retention, dailyCosts, monthlyCosts, growth] =
          await Promise.all([
            this.churn.calculate(snapshotDate, transaction),
            this.retention.calculate(snapshotDate, transaction),
            this.costs.calculateDaily(snapshotDate, transaction),
            this.costs.calculateMonthlyByUser(snapshotDate, transaction),
            this.growth.calculate(
              snapshotDate,
              revenue.payingUsers,
              transaction,
            ),
          ]);
        const profitability = this.profitability.calculate(
          revenue.subscriptions,
          monthlyCosts.users,
        );
        const plans = await this.plans.calculate(
          snapshotDate,
          revenue.subscriptions,
          monthlyCosts.users,
          profitability,
          transaction,
        );
        const totalOperationalCost = dailyCosts.totals.aiCostBrl
          .add(dailyCosts.totals.whatsappCostBrl)
          .add(dailyCosts.totals.storageCostBrl)
          .toDecimalPlaces(8);

        await transaction.revenueSnapshot.create({
          data: {
            snapshotDate,
            currency: Currency.BRL,
            mrr: revenue.mrr,
            arr: revenue.arr,
            arpu: revenue.arpu,
            recognizedRevenue: revenue.recognizedRevenue,
            payingUsers: revenue.payingUsers,
            activeSubscriptions: revenue.activeSubscriptions,
            premiumUsers: revenue.premiumUsers,
            basicUsers: revenue.basicUsers,
            generatedAt,
          },
        });
        await transaction.churnSnapshot.create({
          data: {
            snapshotDate,
            monthlyStartingUsers: churn.monthly.startingUsers,
            monthlyChurnedUsers: churn.monthly.churnedUsers,
            monthlyUserChurnRate: churn.monthly.userChurnRate,
            monthlyStartingMrr: churn.monthly.startingMrr,
            monthlyChurnedMrr: churn.monthly.churnedMrr,
            monthlyRevenueChurnRate: churn.monthly.revenueChurnRate,
            quarterlyStartingUsers: churn.quarterly.startingUsers,
            quarterlyChurnedUsers: churn.quarterly.churnedUsers,
            quarterlyUserChurnRate: churn.quarterly.userChurnRate,
            quarterlyStartingMrr: churn.quarterly.startingMrr,
            quarterlyChurnedMrr: churn.quarterly.churnedMrr,
            quarterlyRevenueChurnRate: churn.quarterly.revenueChurnRate,
            generatedAt,
          },
        });
        await transaction.retentionSnapshot.create({
          data: {
            snapshotDate,
            d1CohortSize: retention.d1.cohortSize,
            d1Retained: retention.d1.retained,
            d1Rate: retention.d1.rate,
            d7CohortSize: retention.d7.cohortSize,
            d7Retained: retention.d7.retained,
            d7Rate: retention.d7.rate,
            d30CohortSize: retention.d30.cohortSize,
            d30Retained: retention.d30.retained,
            d30Rate: retention.d30.rate,
            retentionRate: retention.retentionRate,
            generatedAt,
          },
        });
        await transaction.costSnapshot.create({
          data: {
            snapshotDate,
            aiInputTokens: dailyCosts.totals.aiInputTokens,
            aiOutputTokens: dailyCosts.totals.aiOutputTokens,
            aiTotalTokens: dailyCosts.totals.aiTotalTokens,
            aiCostUsd: dailyCosts.totals.aiCostUsd,
            aiCostBrl: dailyCosts.totals.aiCostBrl,
            aiByProvider: dailyCosts.aiByProvider,
            aiByModel: dailyCosts.aiByModel,
            whatsappSent: dailyCosts.totals.whatsappSent,
            whatsappReceived: dailyCosts.totals.whatsappReceived,
            whatsappCostBrl: dailyCosts.totals.whatsappCostBrl,
            storageImages: dailyCosts.totals.storageImages,
            storageUploads: dailyCosts.totals.storageUploads,
            storageTotalBytes: dailyCosts.totals.storageTotalBytes,
            storageCostBrl: dailyCosts.totals.storageCostBrl,
            totalOperationalCost,
            generatedAt,
          },
        });

        if (dailyCosts.whatsappRows.length > 0) {
          await transaction.whatsAppCostSnapshot.createMany({
            data: dailyCosts.whatsappRows.map((row) => ({
              ...row,
              snapshotDate,
              currency: Currency.BRL,
              generatedAt,
            })),
          });
        }

        if (dailyCosts.storageRows.length > 0) {
          await transaction.storageCostSnapshot.createMany({
            data: dailyCosts.storageRows.map((row) => ({
              ...row,
              snapshotDate,
              currency: Currency.BRL,
              generatedAt,
            })),
          });
        }

        if (profitability.length > 0) {
          await transaction.userProfitabilitySnapshot.createMany({
            data: profitability.map((metric) => ({
              ...metric,
              snapshotDate,
              currency: Currency.BRL,
              generatedAt,
            })),
          });
        }

        await transaction.planPerformanceSnapshot.createMany({
          data: plans.map((plan) => ({
            ...plan,
            snapshotDate,
            generatedAt,
          })),
        });
        await transaction.growthSnapshot.create({
          data: {
            snapshotDate,
            ...growth,
            generatedAt,
          },
        });
        await this.recordEvents(transaction, {
          snapshotDate,
          generatedAt,
          mrr: revenue.mrr,
          payingUsers: revenue.payingUsers,
          monthlyChurnRate: churn.monthly.userChurnRate,
          retentionRate: retention.retentionRate,
          profitability,
        });

        return {
          snapshotDate,
          generated: true,
        };
      },
      {
        maxWait: 10_000,
        timeout: 60_000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  private async recordEvents(
    transaction: Prisma.TransactionClient,
    input: {
      snapshotDate: Date;
      generatedAt: Date;
      mrr: Prisma.Decimal;
      payingUsers: number;
      monthlyChurnRate: Prisma.Decimal;
      retentionRate: Prisma.Decimal;
      profitability: Array<{ estimatedProfit: Prisma.Decimal }>;
    },
  ): Promise<void> {
    const date = input.snapshotDate.toISOString().slice(0, 10);
    const totalProfit = input.profitability
      .reduce(
        (total, item) => total.add(item.estimatedProfit),
        new Prisma.Decimal(0),
      )
      .toDecimalPlaces(8);
    const records = [
      {
        eventType: 'ANALYTICS_METRICS_GENERATED',
        message: `Métricas SaaS geradas para ${date}`,
        metadata: {
          snapshotDate: date,
          generatedAt: input.generatedAt.toISOString(),
        },
      },
      {
        eventType: 'ANALYTICS_REVENUE_SNAPSHOT_CREATED',
        message: `Snapshot de receita criado para ${date}`,
        metadata: {
          snapshotDate: date,
          mrr: input.mrr.toFixed(2),
          payingUsers: input.payingUsers,
        },
      },
      {
        eventType: 'ANALYTICS_CHURN_RECALCULATED',
        message: `Churn recalculado para ${date}`,
        metadata: {
          snapshotDate: date,
          monthlyChurnRate: input.monthlyChurnRate.toFixed(4),
        },
      },
      {
        eventType: 'ANALYTICS_RETENTION_RECALCULATED',
        message: `Retenção recalculada para ${date}`,
        metadata: {
          snapshotDate: date,
          retentionRate: input.retentionRate.toFixed(4),
        },
      },
      {
        eventType: 'ANALYTICS_PROFITABILITY_RECALCULATED',
        message: `Lucratividade recalculada para ${date}`,
        metadata: {
          snapshotDate: date,
          users: input.profitability.length,
          estimatedProfit: totalProfit.toFixed(8),
        },
      },
    ];

    for (const record of records) {
      await this.events.recordInTransaction(transaction, {
        source: ANALYTICS_SOURCE,
        severity: Severity.INFO,
        ...record,
      });
    }
  }
}
