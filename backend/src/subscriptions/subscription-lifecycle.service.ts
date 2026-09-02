import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import dayjs from 'dayjs';
import { AutomationService } from '../automation/automation.service';
import { BillingService } from '../billing/billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionAccessService } from './subscription-access.service';

@Injectable()
export class SubscriptionLifecycleService {
  private readonly logger = new Logger(SubscriptionLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly automation: AutomationService,
    private readonly access: SubscriptionAccessService,
  ) {}

  async authorizeOrNotify(
    userId: string,
    referenceKey: string,
    at = new Date(),
  ): Promise<boolean> {
    try {
      await this.access.requireAccess(userId, at);
      return true;
    } catch (error: unknown) {
      if (!(error instanceof ForbiddenException)) {
        throw error;
      }

      void referenceKey;
      return false;
    }
  }

  async processDue(at = new Date(), limit = 500) {
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE],
        },
        currentPeriodEnd: { not: null },
      },
      include: {
        user: { select: { name: true } },
      },
      orderBy: { currentPeriodEnd: 'asc' },
      take: limit,
    });
    let processed = 0;

    for (const subscription of subscriptions) {
      const periodEnd = subscription.currentPeriodEnd;
      if (!periodEnd) {
        continue;
      }

      try {
        const period = dayjs(periodEnd);
        const name = this.firstName(subscription.user.name);

        if (!dayjs(at).isBefore(period.subtract(7, 'day'))) {
          await this.billing.getOrCreatePayableInvoice(subscription.userId, at);
        }

        if (
          !subscription.cancelAtPeriodEnd &&
          (dayjs(at).isBefore(periodEnd) || dayjs(at).isSame(periodEnd))
        ) {
          await this.schedulePreDueNotices(
            subscription.userId,
            subscription.id,
            name,
            period,
            at,
          );
        }

        if (!dayjs(at).isBefore(periodEnd)) {
          try {
            await this.access.requireAccess(subscription.userId, at);
          } catch (error: unknown) {
            if (!(error instanceof ForbiddenException)) {
              throw error;
            }
          }

          if (!subscription.cancelAtPeriodEnd) {
            await this.scheduleDueNotice(
              subscription.userId,
              subscription.id,
              name,
              period,
              at,
            );
          }
        }
        processed += 1;
      } catch (error: unknown) {
        this.logger.error(
          `Falha ao reconciliar assinatura ${subscription.id}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    return { scanned: subscriptions.length, processed };
  }

  async notifyActivated(
    userId: string,
    cycleNumber: number,
    reactivated: boolean,
    at = new Date(),
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    if (!user) {
      return null;
    }

    if (cycleNumber === 1 && !reactivated) {
      return null;
    }

    const name = this.firstName(user.name);
    const content = reactivated
      ? `Bem-vindo de volta, ${name}. Mantive todo o seu histórico. Vamos continuar exatamente de onde paramos.`
      : `${name}, sua assinatura foi renovada. Seu acompanhamento continua normalmente e todo o seu histórico permanece disponível.`;

    return this.automation.scheduleSubscriptionNotice({
      userId,
      noticeKey: `activated:cycle-${cycleNumber}`,
      content,
      scheduledFor: at,
      availableAt: at,
    });
  }

  private async schedulePreDueNotices(
    userId: string,
    subscriptionId: string,
    name: string,
    periodEnd: dayjs.Dayjs,
    at: Date,
  ): Promise<void> {
    for (const days of [3, 2, 1] as const) {
      const scheduledFor = periodEnd.subtract(days, 'day');
      if (
        dayjs(at).isBefore(scheduledFor) ||
        !dayjs(at).isBefore(scheduledFor.add(1, 'day'))
      ) {
        continue;
      }
      await this.automation.scheduleSubscriptionNotice({
        userId,
        noticeKey: `${subscriptionId}:${periodEnd.toISOString()}:before-${days}`,
        content: `${name}, seu plano termina em ${days} ${days === 1 ? 'dia' : 'dias'}. Quero garantir que você continue evoluindo sem perder seu acompanhamento. Quando quiser, posso ajudar com a renovação.`,
        scheduledFor: scheduledFor.toDate(),
        availableAt: scheduledFor.toDate(),
      });
    }
  }

  private async scheduleDueNotice(
    userId: string,
    subscriptionId: string,
    name: string,
    periodEnd: dayjs.Dayjs,
    at: Date,
  ): Promise<void> {
    if (
      dayjs(at).isBefore(periodEnd) ||
      !dayjs(at).isBefore(periodEnd.add(1, 'day'))
    ) {
      return;
    }
    await this.automation.scheduleSubscriptionNotice({
      userId,
      noticeKey: `${subscriptionId}:${periodEnd.toISOString()}:due`,
      content: `${name}, seu ciclo termina hoje. Seu histórico está seguro e você ainda pode renovar para manter o acompanhamento sem interrupções.`,
      scheduledFor: periodEnd.toDate(),
      availableAt: periodEnd.toDate(),
    });
  }

  private firstName(name: string | null): string {
    return name?.trim().split(/\s+/u)[0] || 'Olá';
  }
}
