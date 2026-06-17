import { PlanType, Prisma, WhatsAppCostCategory } from '@prisma/client';

export type AnalyticsDatabaseClient =
  | Prisma.TransactionClient
  | {
      subscription: Prisma.TransactionClient['subscription'];
      invoice: Prisma.TransactionClient['invoice'];
      user: Prisma.TransactionClient['user'];
      message: Prisma.TransactionClient['message'];
      meal: Prisma.TransactionClient['meal'];
      aIUsage: Prisma.TransactionClient['aIUsage'];
      outboundMessage: Prisma.TransactionClient['outboundMessage'];
      scheduledMessage: Prisma.TransactionClient['scheduledMessage'];
      mediaFile: Prisma.TransactionClient['mediaFile'];
    };

export interface AnalyticsSubscription {
  id: string;
  userId: string;
  amount: Prisma.Decimal;
  startedAt: Date | null;
  canceledAt: Date | null;
  endedAt: Date | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  billingPeriodEnd: Date | null;
  plan: {
    type: PlanType;
    billingIntervalCount: number;
  };
}

export interface RevenueMetricResult {
  mrr: Prisma.Decimal;
  arr: Prisma.Decimal;
  arpu: Prisma.Decimal;
  recognizedRevenue: Prisma.Decimal;
  payingUsers: number;
  activeSubscriptions: number;
  premiumUsers: number;
  basicUsers: number;
  subscriptions: AnalyticsSubscription[];
}

export interface ChurnWindowResult {
  startingUsers: number;
  churnedUsers: number;
  userChurnRate: Prisma.Decimal;
  startingMrr: Prisma.Decimal;
  churnedMrr: Prisma.Decimal;
  revenueChurnRate: Prisma.Decimal;
}

export interface RetentionMetric {
  cohortSize: number;
  retained: number;
  rate: Prisma.Decimal;
}

export interface WhatsAppCostRow {
  userId: string;
  category: WhatsAppCostCategory;
  sentMessages: number;
  receivedMessages: number;
  estimatedCost: Prisma.Decimal;
}

export interface StorageCostRow {
  userId: string;
  imageCount: number;
  uploadCount: number;
  totalBytes: bigint;
  estimatedCost: Prisma.Decimal;
}

export interface UserOperationalCost {
  userId: string;
  aiInputTokens: number;
  aiOutputTokens: number;
  aiTotalTokens: number;
  aiCostUsd: Prisma.Decimal;
  aiCostBrl: Prisma.Decimal;
  whatsappSent: number;
  whatsappReceived: number;
  whatsappCostBrl: Prisma.Decimal;
  storageImages: number;
  storageUploads: number;
  storageTotalBytes: bigint;
  storageCostBrl: Prisma.Decimal;
}

export interface UserProfitabilityMetric {
  userId: string;
  planType: PlanType;
  monthlyRevenue: Prisma.Decimal;
  aiCost: Prisma.Decimal;
  whatsappCost: Prisma.Decimal;
  storageCost: Prisma.Decimal;
  estimatedProfit: Prisma.Decimal;
  marginPercent: Prisma.Decimal;
}

export interface PlanPerformanceMetric {
  planType: PlanType;
  payingUsers: number;
  retentionRate: Prisma.Decimal;
  churnRate: Prisma.Decimal;
  monthlyRevenue: Prisma.Decimal;
  estimatedProfit: Prisma.Decimal;
  marginPercent: Prisma.Decimal;
  aiTokens: number;
  aiCost: Prisma.Decimal;
  whatsappMessages: number;
  whatsappCost: Prisma.Decimal;
}
