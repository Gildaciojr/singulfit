import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MediaType,
  MessageDirection,
  OutboundMessageStatus,
  Prisma,
  ScheduledMessageStatus,
  WhatsAppCostCategory,
} from '@prisma/client';
import { AnalyticsDateService } from './analytics-date.service';
import {
  AnalyticsDatabaseClient,
  StorageCostRow,
  UserOperationalCost,
  WhatsAppCostRow,
} from './interfaces/analytics.interface';

interface AIBreakdown {
  tokens: number;
  costUsd: Prisma.Decimal;
}

@Injectable()
export class CostAnalyticsService {
  constructor(
    private readonly config: ConfigService,
    private readonly dates: AnalyticsDateService,
  ) {}

  async calculateDaily(snapshotDate: Date, client: AnalyticsDatabaseClient) {
    const date = this.dates.utcDay(snapshotDate);
    const nextDate = this.dates.nextDay(date);
    const costs = await this.calculateUserCosts(
      date,
      nextDate,
      nextDate,
      true,
      client,
    );
    const aiByProvider = await this.aiBreakdown(
      date,
      nextDate,
      'provider',
      client,
    );
    const aiByModel = await this.aiBreakdown(date, nextDate, 'model', client);

    return {
      users: costs.users,
      whatsappRows: costs.whatsappRows,
      storageRows: costs.storageRows,
      aiByProvider: this.serializeBreakdown(aiByProvider),
      aiByModel: this.serializeBreakdown(aiByModel),
      totals: this.sumCosts(costs.users),
    };
  }

  calculateMonthlyByUser(snapshotDate: Date, client: AnalyticsDatabaseClient) {
    const date = this.dates.utcDay(snapshotDate);
    const nextDate = this.dates.nextDay(date);

    return this.calculateUserCosts(
      this.dates.addDays(nextDate, -30),
      nextDate,
      nextDate,
      false,
      client,
    );
  }

  private async calculateUserCosts(
    from: Date,
    to: Date,
    storageAsOf: Date,
    prorateStorageDaily: boolean,
    client: AnalyticsDatabaseClient,
  ) {
    const [usage, inbound, responses, automations, media] = await Promise.all([
      client.aIUsage.findMany({
        where: {
          usageDate: {
            gte: from,
            lt: to,
          },
        },
        select: {
          userId: true,
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          estimatedCost: true,
        },
      }),
      client.message.findMany({
        where: {
          direction: MessageDirection.INBOUND,
          timestamp: {
            gte: from,
            lt: to,
          },
        },
        select: {
          conversation: {
            select: {
              userId: true,
            },
          },
        },
      }),
      client.outboundMessage.findMany({
        where: {
          status: {
            in: [OutboundMessageStatus.SENT, OutboundMessageStatus.DELIVERED],
          },
          sentAt: {
            gte: from,
            lt: to,
          },
        },
        select: {
          userId: true,
        },
      }),
      client.scheduledMessage.findMany({
        where: {
          status: ScheduledMessageStatus.SENT,
          scheduledFor: {
            gte: from,
            lt: to,
          },
        },
        select: {
          userId: true,
        },
      }),
      client.mediaFile.findMany({
        where: {
          createdAt: {
            lt: storageAsOf,
          },
        },
        select: {
          userId: true,
          mediaType: true,
          fileSize: true,
        },
      }),
    ]);
    const users = new Map<string, UserOperationalCost>();
    const ensure = (userId: string) => {
      const current = users.get(userId);

      if (current) {
        return current;
      }

      const created: UserOperationalCost = {
        userId,
        aiInputTokens: 0,
        aiOutputTokens: 0,
        aiTotalTokens: 0,
        aiCostUsd: new Prisma.Decimal(0),
        aiCostBrl: new Prisma.Decimal(0),
        whatsappSent: 0,
        whatsappReceived: 0,
        whatsappCostBrl: new Prisma.Decimal(0),
        storageImages: 0,
        storageUploads: 0,
        storageTotalBytes: 0n,
        storageCostBrl: new Prisma.Decimal(0),
      };
      users.set(userId, created);

      return created;
    };
    const usdToBrl = this.rate('ANALYTICS_USD_TO_BRL_RATE', '5');

    for (const item of usage) {
      const user = ensure(item.userId);
      user.aiInputTokens += item.promptTokens;
      user.aiOutputTokens += item.completionTokens;
      user.aiTotalTokens += item.totalTokens;
      user.aiCostUsd = user.aiCostUsd.add(item.estimatedCost);
      user.aiCostBrl = user.aiCostUsd.mul(usdToBrl).toDecimalPlaces(8);
    }

    for (const item of inbound) {
      ensure(item.conversation.userId).whatsappReceived += 1;
    }

    for (const item of responses) {
      ensure(item.userId).whatsappSent += 1;
    }

    for (const item of automations) {
      ensure(item.userId).whatsappSent += 1;
    }

    for (const item of media) {
      const user = ensure(item.userId);
      user.storageUploads += 1;
      user.storageImages += item.mediaType === MediaType.IMAGE ? 1 : 0;
      user.storageTotalBytes += BigInt(item.fileSize);
    }

    const inboundRate = this.rate('ANALYTICS_WHATSAPP_INBOUND_COST_BRL', '0');
    const responseRate = this.rate(
      'ANALYTICS_WHATSAPP_RESPONSE_COST_BRL',
      '0.05',
    );
    const automationRate = this.rate(
      'ANALYTICS_WHATSAPP_AUTOMATION_COST_BRL',
      '0.08',
    );
    const responseCounts = this.countByUser(responses);
    const automationCounts = this.countByUser(automations);
    const inboundCounts = this.countInboundByUser(inbound);
    const whatsappRows: WhatsAppCostRow[] = [];
    const storageRows: StorageCostRow[] = [];

    for (const user of users.values()) {
      const inboundCount = inboundCounts.get(user.userId) ?? 0;
      const responseCount = responseCounts.get(user.userId) ?? 0;
      const automationCount = automationCounts.get(user.userId) ?? 0;
      const inboundCost = inboundRate.mul(inboundCount).toDecimalPlaces(8);
      const responseCost = responseRate.mul(responseCount).toDecimalPlaces(8);
      const automationCost = automationRate
        .mul(automationCount)
        .toDecimalPlaces(8);
      user.whatsappCostBrl = inboundCost
        .add(responseCost)
        .add(automationCost)
        .toDecimalPlaces(8);

      this.pushWhatsAppRow(
        whatsappRows,
        user.userId,
        WhatsAppCostCategory.INBOUND,
        0,
        inboundCount,
        inboundCost,
      );
      this.pushWhatsAppRow(
        whatsappRows,
        user.userId,
        WhatsAppCostCategory.RESPONSE,
        responseCount,
        0,
        responseCost,
      );
      this.pushWhatsAppRow(
        whatsappRows,
        user.userId,
        WhatsAppCostCategory.AUTOMATION,
        automationCount,
        0,
        automationCost,
      );

      const monthlyStorageCost = new Prisma.Decimal(
        user.storageTotalBytes.toString(),
      )
        .div(1024 ** 3)
        .mul(this.rate('ANALYTICS_STORAGE_GB_MONTH_COST_BRL', '0.12'));
      user.storageCostBrl = (
        prorateStorageDaily ? monthlyStorageCost.div(30) : monthlyStorageCost
      ).toDecimalPlaces(8);
      storageRows.push({
        userId: user.userId,
        imageCount: user.storageImages,
        uploadCount: user.storageUploads,
        totalBytes: user.storageTotalBytes,
        estimatedCost: user.storageCostBrl,
      });
    }

    return {
      users: [...users.values()],
      whatsappRows,
      storageRows,
    };
  }

  private async aiBreakdown(
    from: Date,
    to: Date,
    key: 'provider' | 'model',
    client: AnalyticsDatabaseClient,
  ): Promise<Map<string, AIBreakdown>> {
    const usage = await client.aIUsage.findMany({
      where: {
        usageDate: {
          gte: from,
          lt: to,
        },
      },
      select: {
        provider: true,
        model: true,
        totalTokens: true,
        estimatedCost: true,
      },
    });
    const result = new Map<string, AIBreakdown>();

    for (const item of usage) {
      const value = item[key];
      const current = result.get(value) ?? {
        tokens: 0,
        costUsd: new Prisma.Decimal(0),
      };
      current.tokens += item.totalTokens;
      current.costUsd = current.costUsd.add(item.estimatedCost);
      result.set(value, current);
    }

    return result;
  }

  private serializeBreakdown(
    breakdown: Map<string, AIBreakdown>,
  ): Prisma.InputJsonObject {
    return Object.fromEntries(
      [...breakdown.entries()].map(([key, value]) => [
        key,
        {
          tokens: value.tokens,
          costUsd: value.costUsd.toFixed(8),
        },
      ]),
    );
  }

  private sumCosts(users: UserOperationalCost[]) {
    return users.reduce(
      (total, user) => ({
        aiInputTokens: total.aiInputTokens + user.aiInputTokens,
        aiOutputTokens: total.aiOutputTokens + user.aiOutputTokens,
        aiTotalTokens: total.aiTotalTokens + user.aiTotalTokens,
        aiCostUsd: total.aiCostUsd.add(user.aiCostUsd),
        aiCostBrl: total.aiCostBrl.add(user.aiCostBrl),
        whatsappSent: total.whatsappSent + user.whatsappSent,
        whatsappReceived: total.whatsappReceived + user.whatsappReceived,
        whatsappCostBrl: total.whatsappCostBrl.add(user.whatsappCostBrl),
        storageImages: total.storageImages + user.storageImages,
        storageUploads: total.storageUploads + user.storageUploads,
        storageTotalBytes: total.storageTotalBytes + user.storageTotalBytes,
        storageCostBrl: total.storageCostBrl.add(user.storageCostBrl),
      }),
      {
        aiInputTokens: 0,
        aiOutputTokens: 0,
        aiTotalTokens: 0,
        aiCostUsd: new Prisma.Decimal(0),
        aiCostBrl: new Prisma.Decimal(0),
        whatsappSent: 0,
        whatsappReceived: 0,
        whatsappCostBrl: new Prisma.Decimal(0),
        storageImages: 0,
        storageUploads: 0,
        storageTotalBytes: 0n,
        storageCostBrl: new Prisma.Decimal(0),
      },
    );
  }

  private countByUser(items: Array<{ userId: string }>): Map<string, number> {
    const counts = new Map<string, number>();

    for (const item of items) {
      counts.set(item.userId, (counts.get(item.userId) ?? 0) + 1);
    }

    return counts;
  }

  private countInboundByUser(
    items: Array<{ conversation: { userId: string } }>,
  ): Map<string, number> {
    return this.countByUser(
      items.map((item) => ({ userId: item.conversation.userId })),
    );
  }

  private pushWhatsAppRow(
    rows: WhatsAppCostRow[],
    userId: string,
    category: WhatsAppCostCategory,
    sentMessages: number,
    receivedMessages: number,
    estimatedCost: Prisma.Decimal,
  ): void {
    if (sentMessages === 0 && receivedMessages === 0) {
      return;
    }

    rows.push({
      userId,
      category,
      sentMessages,
      receivedMessages,
      estimatedCost,
    });
  }

  private rate(key: string, fallback: string): Prisma.Decimal {
    const configured = this.config.get<string>(key, fallback).trim();

    try {
      const rate = new Prisma.Decimal(configured);

      if (rate.isNegative()) {
        throw new Error('negative rate');
      }

      return rate;
    } catch {
      throw new ServiceUnavailableException(
        `Configuração analítica inválida: ${key}`,
      );
    }
  }
}
