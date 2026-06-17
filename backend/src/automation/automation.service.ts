import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChurnRiskLevel, Prisma, ScheduledMessageStatus } from '@prisma/client';
import { EvolutionGateway } from '../evolution/evolution.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SubscriptionAccessService } from '../subscriptions/subscription-access.service';
import {
  AUTOMATION_RULE_CODES,
  AutomationRuleCode,
} from './automation.constants';
import { CoachService } from './coach.service';
import { UpdateAutomationPreferencesDto } from './dto/update-automation-preferences.dto';
import { EventBusService } from '../event-bus/event-bus.service';
import { INTERNAL_EVENT } from '../event-bus/event-bus.constants';
import { CoachIntelligenceService } from './coach-intelligence.service';
import { BehavioralIntelligenceService } from '../behavior/behavioral-intelligence.service';

const AUTOMATION_CODES = new Set<string>(Object.values(AUTOMATION_RULE_CODES));

type ScheduledMessageWithRule = Prisma.ScheduledMessageGetPayload<{
  include: {
    automationRule: true;
  };
}>;

@Injectable()
export class AutomationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly coachService: CoachService,
    private readonly evolutionGateway: EvolutionGateway,
    private readonly subscriptionAccessService: SubscriptionAccessService,
    private readonly eventBus: EventBusService,
    private readonly coachIntelligence: CoachIntelligenceService,
    private readonly behavioralIntelligence: BehavioralIntelligenceService,
  ) {}

  async getPreferences(userId: string) {
    await this.subscriptionsService.getProfileSubscription(userId);

    return this.getOrCreatePreferences(userId);
  }

  async updatePreferences(
    userId: string,
    data: UpdateAutomationPreferencesDto,
  ) {
    await this.subscriptionsService.getProfileSubscription(userId);

    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        'Informe ao menos uma preferência de automação',
      );
    }

    const preferences = await this.prisma.userAutomationPreference.upsert({
      where: {
        userId,
      },
      update: data,
      create: {
        userId,
        ...data,
      },
    });
    const disabledCodes = this.disabledCodes(preferences);

    if (!preferences.remindersEnabled) {
      await this.prisma.scheduledMessage.updateMany({
        where: {
          userId,
          status: ScheduledMessageStatus.PENDING,
        },
        data: {
          status: ScheduledMessageStatus.CANCELED,
        },
      });
    } else if (disabledCodes.length > 0) {
      await this.prisma.scheduledMessage.updateMany({
        where: {
          userId,
          status: ScheduledMessageStatus.PENDING,
          automationRule: {
            code: {
              in: disabledCodes,
            },
          },
        },
        data: {
          status: ScheduledMessageStatus.CANCELED,
        },
      });
    }

    return preferences;
  }

  async getAutomations(userId: string) {
    await this.subscriptionsService.getProfileSubscription(userId);
    const [preferences, rules, scheduledMessages] = await Promise.all([
      this.getOrCreatePreferences(userId),
      this.prisma.automationRule.findMany({
        orderBy: {
          code: 'asc',
        },
      }),
      this.prisma.scheduledMessage.findMany({
        where: {
          userId,
        },
        include: {
          automationRule: true,
        },
        orderBy: [
          {
            scheduledFor: 'desc',
          },
          {
            id: 'desc',
          },
        ],
        take: 100,
      }),
    ]);

    return {
      preferences,
      rules: rules.map((rule) => ({
        ...rule,
        enabledForUser:
          rule.enabled &&
          this.isRuleEnabled(rule.code as AutomationRuleCode, preferences),
      })),
      scheduledMessages,
    };
  }

  async scheduleMessage(
    userId: string,
    ruleCode: AutomationRuleCode,
    scheduledFor: Date,
  ) {
    await this.subscriptionsService.getProfileSubscription(userId);

    if (
      !AUTOMATION_CODES.has(ruleCode) ||
      Number.isNaN(scheduledFor.getTime())
    ) {
      throw new BadRequestException('Regra ou horário de automação inválido');
    }

    const [preferences, rule] = await Promise.all([
      this.getOrCreatePreferences(userId),
      this.prisma.automationRule.findUnique({
        where: {
          code: ruleCode,
        },
      }),
    ]);

    if (!rule || !rule.enabled) {
      throw new NotFoundException('Regra de automação indisponível');
    }

    if (!this.isRuleEnabled(ruleCode, preferences)) {
      throw new ForbiddenException(
        'As preferências do usuário desabilitam esta automação',
      );
    }

    const content = await this.coachService.generateContent(
      userId,
      ruleCode,
      scheduledFor,
    );

    return this.prisma.$transaction(async (transaction) => {
      const scheduledMessage = await transaction.scheduledMessage.upsert({
        where: {
          userId_automationRuleId_scheduledFor: {
            userId,
            automationRuleId: rule.id,
            scheduledFor,
          },
        },
        update: {},
        create: {
          userId,
          automationRuleId: rule.id,
          scheduledFor,
          content,
        },
        include: {
          automationRule: true,
        },
      });

      await this.eventBus.publish(
        {
          eventType: INTERNAL_EVENT.AUTOMATION_TRIGGERED,
          aggregateType: 'SCHEDULED_MESSAGE',
          aggregateId: scheduledMessage.id,
          payload: {
            scheduledMessageId: scheduledMessage.id,
            userId,
            automationRuleId: rule.id,
            ruleCode,
          },
          availableAt: scheduledFor,
        },
        transaction,
      );

      return scheduledMessage;
    });
  }

  async dispatchDue(at = new Date(), limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new BadRequestException('Limite de despacho inválido');
    }

    await this.materializeRetentionMessages(at);

    const dueMessages = await this.prisma.scheduledMessage.findMany({
      where: {
        OR: [
          {
            status: ScheduledMessageStatus.PENDING,
            scheduledFor: {
              lte: at,
            },
          },
          {
            status: ScheduledMessageStatus.SENDING,
            leaseExpiresAt: {
              lte: at,
            },
          },
        ],
      },
      orderBy: [
        {
          scheduledFor: 'asc',
        },
        {
          id: 'asc',
        },
      ],
      take: limit,
      select: {
        id: true,
      },
    });
    const results: ScheduledMessageWithRule[] = [];

    for (const message of dueMessages) {
      try {
        results.push(await this.sendScheduledMessage(message.id, at));
      } catch {
        results.push(
          await this.prisma.scheduledMessage.findUniqueOrThrow({
            where: {
              id: message.id,
            },
            include: {
              automationRule: true,
            },
          }),
        );
      }
    }

    return results;
  }

  async sendScheduledMessage(
    scheduledMessageId: string,
    at = new Date(),
  ): Promise<ScheduledMessageWithRule> {
    const claimed = await this.prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          WITH advisory_lock AS (
            SELECT pg_advisory_xact_lock(hashtext(${`scheduled-message:${scheduledMessageId}`}))
          )
          SELECT true AS "locked"
          FROM advisory_lock
        `;

        const current = await transaction.scheduledMessage.findUnique({
          where: {
            id: scheduledMessageId,
          },
          include: {
            automationRule: true,
            user: {
              select: {
                phone: true,
                phoneE164: true,
              },
            },
          },
        });

        if (!current) {
          throw new NotFoundException('Mensagem agendada não encontrada');
        }

        if (
          current.status === ScheduledMessageStatus.SENT ||
          current.status === ScheduledMessageStatus.CANCELED
        ) {
          return {
            shouldSend: false as const,
            message: current,
          };
        }

        if (
          current.status === ScheduledMessageStatus.SENDING &&
          current.leaseExpiresAt &&
          current.leaseExpiresAt > at
        ) {
          return {
            shouldSend: false as const,
            message: current,
          };
        }

        if (current.scheduledFor > at) {
          throw new BadRequestException(
            'Mensagem ainda não atingiu o horário agendado',
          );
        }

        const preferences =
          await transaction.userAutomationPreference.findUnique({
            where: {
              userId: current.userId,
            },
          });

        if (
          !current.automationRule.enabled ||
          !preferences ||
          !this.isRuleEnabled(
            current.automationRule.code as AutomationRuleCode,
            preferences,
          )
        ) {
          const canceled = await transaction.scheduledMessage.update({
            where: {
              id: current.id,
            },
            data: {
              status: ScheduledMessageStatus.CANCELED,
            },
            include: {
              automationRule: true,
            },
          });

          return {
            shouldSend: false as const,
            message: canceled,
          };
        }

        try {
          await this.subscriptionAccessService.requireAccessInTransaction(
            transaction,
            current.userId,
            at,
          );
        } catch (error: unknown) {
          if (!(error instanceof ForbiddenException)) {
            throw error;
          }

          const canceled = await transaction.scheduledMessage.update({
            where: {
              id: current.id,
            },
            data: {
              status: ScheduledMessageStatus.CANCELED,
              leaseExpiresAt: null,
            },
            include: {
              automationRule: true,
            },
          });

          return {
            shouldSend: false as const,
            message: canceled,
          };
        }

        const message = await transaction.scheduledMessage.update({
          where: {
            id: current.id,
          },
          data: {
            status: ScheduledMessageStatus.SENDING,
            attempts: {
              increment: 1,
            },
            leaseExpiresAt: new Date(at.getTime() + 60_000),
          },
          include: {
            automationRule: true,
            user: {
              select: {
                phone: true,
                phoneE164: true,
              },
            },
          },
        });

        return {
          shouldSend: true as const,
          message,
        };
      },
      {
        maxWait: 5_000,
        timeout: 10_000,
      },
    );

    if (!claimed.shouldSend) {
      return claimed.message;
    }

    try {
      await this.evolutionGateway.sendText({
        number: claimed.message.user.phoneE164 ?? claimed.message.user.phone,
        text: claimed.message.content,
      });
      await this.prisma.scheduledMessage.updateMany({
        where: {
          id: claimed.message.id,
          status: ScheduledMessageStatus.SENDING,
        },
        data: {
          status: ScheduledMessageStatus.SENT,
          leaseExpiresAt: null,
        },
      });
    } catch (error: unknown) {
      await this.prisma.scheduledMessage.updateMany({
        where: {
          id: claimed.message.id,
          status: ScheduledMessageStatus.SENDING,
        },
        data: {
          status: ScheduledMessageStatus.FAILED,
          leaseExpiresAt: null,
        },
      });

      if (error instanceof Error) {
        throw error;
      }

      throw new BadGatewayException(
        'Falha não identificada no envio da automação',
      );
    }

    return this.prisma.scheduledMessage.findUniqueOrThrow({
      where: {
        id: claimed.message.id,
      },
      include: {
        automationRule: true,
      },
    });
  }

  private getOrCreatePreferences(userId: string) {
    return this.prisma.userAutomationPreference.upsert({
      where: {
        userId,
      },
      update: {},
      create: {
        userId,
      },
    });
  }

  private isRuleEnabled(
    ruleCode: AutomationRuleCode,
    preferences: {
      remindersEnabled: boolean;
      workoutReminderEnabled: boolean;
      mealReminderEnabled: boolean;
      hydrationReminderEnabled: boolean;
      progressReminderEnabled: boolean;
    },
  ): boolean {
    if (!preferences.remindersEnabled) {
      return false;
    }

    switch (ruleCode) {
      case AUTOMATION_RULE_CODES.DAILY_WORKOUT:
        return preferences.workoutReminderEnabled;
      case AUTOMATION_RULE_CODES.MEAL_REMINDER:
        return preferences.mealReminderEnabled;
      case AUTOMATION_RULE_CODES.HYDRATION_REMINDER:
        return preferences.hydrationReminderEnabled;
      case AUTOMATION_RULE_CODES.DAILY_CHECK_IN:
      case AUTOMATION_RULE_CODES.WEEKLY_SUMMARY:
      case AUTOMATION_RULE_CODES.DAILY_COACH:
      case AUTOMATION_RULE_CODES.WEEKLY_REVIEW:
      case AUTOMATION_RULE_CODES.MONTHLY_REVIEW:
      case AUTOMATION_RULE_CODES.REENGAGEMENT:
        return preferences.progressReminderEnabled;
      case AUTOMATION_RULE_CODES.GOOD_MORNING:
        return true;
    }
  }

  private disabledCodes(preferences: {
    workoutReminderEnabled: boolean;
    mealReminderEnabled: boolean;
    hydrationReminderEnabled: boolean;
    progressReminderEnabled: boolean;
  }): AutomationRuleCode[] {
    const codes: AutomationRuleCode[] = [];

    if (!preferences.workoutReminderEnabled) {
      codes.push(AUTOMATION_RULE_CODES.DAILY_WORKOUT);
    }

    if (!preferences.mealReminderEnabled) {
      codes.push(AUTOMATION_RULE_CODES.MEAL_REMINDER);
    }

    if (!preferences.hydrationReminderEnabled) {
      codes.push(AUTOMATION_RULE_CODES.HYDRATION_REMINDER);
    }

    if (!preferences.progressReminderEnabled) {
      codes.push(
        AUTOMATION_RULE_CODES.DAILY_CHECK_IN,
        AUTOMATION_RULE_CODES.WEEKLY_SUMMARY,
        AUTOMATION_RULE_CODES.DAILY_COACH,
        AUTOMATION_RULE_CODES.WEEKLY_REVIEW,
        AUTOMATION_RULE_CODES.MONTHLY_REVIEW,
        AUTOMATION_RULE_CODES.REENGAGEMENT,
      );
    }

    return codes;
  }

  private async materializeRetentionMessages(at: Date): Promise<void> {
    const batchSize = 100;
    let cursor: string | undefined;

    while (true) {
      const users = await this.prisma.user.findMany({
        where: {
          isActive: true,
          automationPreference: {
            is: {
              remindersEnabled: true,
              progressReminderEnabled: true,
            },
          },
        },
        select: {
          id: true,
        },
        orderBy: {
          id: 'asc',
        },
        take: batchSize,
        ...(cursor
          ? {
              cursor: {
                id: cursor,
              },
              skip: 1,
            }
          : {}),
      });

      if (users.length === 0) {
        return;
      }

      const snapshotDate = this.utcDay(at);

      for (const user of users) {
        try {
          const existingHabit = await this.prisma.habitSnapshot.findUnique({
            where: {
              userId_snapshotDate: {
                userId: user.id,
                snapshotDate,
              },
            },
          });

          if (!existingHabit) {
            await this.coachIntelligence.recalculateUser(user.id, at);
          }

          const risk = await this.prisma.churnRiskAssessment.findUnique({
            where: {
              userId_snapshotDate: {
                userId: user.id,
                snapshotDate,
              },
            },
          });
          const experience = await this.coachIntelligence.getExperienceSignals(
            user.id,
            at,
          );
          const preferredHour =
            experience.whatsapp.preferredHourUtc ??
            (await this.behavioralIntelligence.preferredScheduleHour(
              user.id,
              at,
            ));
          const schedules: Array<{
            code: AutomationRuleCode;
            scheduledFor: Date;
          }> = [
            ...(experience.canSendCoachMessage
              ? [
                  {
                    code: AUTOMATION_RULE_CODES.DAILY_COACH,
                    scheduledFor: this.atUtcHour(snapshotDate, preferredHour),
                  },
                ]
              : []),
            {
              code: AUTOMATION_RULE_CODES.WEEKLY_REVIEW,
              scheduledFor: this.atUtcHour(
                this.weekStart(snapshotDate),
                preferredHour,
              ),
            },
            {
              code: AUTOMATION_RULE_CODES.MONTHLY_REVIEW,
              scheduledFor: this.atUtcHour(
                new Date(
                  Date.UTC(
                    snapshotDate.getUTCFullYear(),
                    snapshotDate.getUTCMonth(),
                    1,
                  ),
                ),
                preferredHour,
              ),
            },
          ];

          if (
            risk &&
            risk.daysInactive >= 3 &&
            risk.level !== ChurnRiskLevel.LOW &&
            experience.canSendCoachMessage
          ) {
            schedules.push({
              code: AUTOMATION_RULE_CODES.REENGAGEMENT,
              scheduledFor: this.atUtcHour(snapshotDate, preferredHour),
            });
          }

          for (const schedule of schedules) {
            if (
              await this.hasScheduledInPeriod(
                user.id,
                schedule.code,
                schedule.scheduledFor,
              )
            ) {
              continue;
            }

            await this.scheduleMessage(
              user.id,
              schedule.code,
              schedule.scheduledFor,
            );
          }
        } catch {
          // Usuários sem contexto ou acesso válido são ignorados neste ciclo.
        }
      }

      if (users.length < batchSize) {
        return;
      }

      cursor = users.at(-1)?.id;
    }
  }

  private async hasScheduledInPeriod(
    userId: string,
    code: AutomationRuleCode,
    scheduledFor: Date,
  ): Promise<boolean> {
    const range = this.schedulePeriod(code, scheduledFor);
    const existing = await this.prisma.scheduledMessage.findFirst({
      where: {
        userId,
        status: {
          not: ScheduledMessageStatus.CANCELED,
        },
        automationRule: {
          code,
        },
        scheduledFor: {
          gte: range.start,
          lt: range.end,
        },
      },
      select: {
        id: true,
      },
    });

    return existing !== null;
  }

  private schedulePeriod(code: AutomationRuleCode, value: Date) {
    if (code === AUTOMATION_RULE_CODES.WEEKLY_REVIEW) {
      const start = this.weekStart(this.utcDay(value));
      return {
        start,
        end: new Date(start.getTime() + 7 * 86_400_000),
      };
    }

    if (code === AUTOMATION_RULE_CODES.MONTHLY_REVIEW) {
      const start = new Date(
        Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1),
      );
      return {
        start,
        end: new Date(
          Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1),
        ),
      };
    }

    const start = this.utcDay(value);
    return {
      start,
      end: new Date(start.getTime() + 86_400_000),
    };
  }

  private utcDay(value: Date): Date {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }

  private weekStart(value: Date): Date {
    const day = value.getUTCDay() || 7;
    return new Date(value.getTime() - (day - 1) * 86_400_000);
  }

  private atUtcHour(value: Date, hour: number): Date {
    return new Date(
      Date.UTC(
        value.getUTCFullYear(),
        value.getUTCMonth(),
        value.getUTCDate(),
        hour,
      ),
    );
  }
}
