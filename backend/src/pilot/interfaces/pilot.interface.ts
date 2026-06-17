import {
  PilotGoStatus,
  PilotManualCheckStatus,
  PilotManualCheckType,
} from '@prisma/client';

export interface PilotMetricSummary {
  invitedUsers: number;
  registeredUsers: number;
  paidUsers: number;
  activatedUsers: number;
  firstMealUsers: number;
  firstAnalysisUsers: number;
  firstRecommendationUsers: number;
  firstCoachUsers: number;
  initialChurnUsers: number;
  activationRate: number;
  initialChurnRate: number;
  retentionRate: number;
  averageAIQuality: number | null;
  averageAISafety: number | null;
  aiEvaluations: number;
  blockedAIResponses: number;
  fallbackAIResponses: number;
  averageDailyUsage: number;
  receivedMessages: number;
  sentMessages: number;
  costs: {
    aiUsd: string;
    whatsappBrl: string;
    storageBrl: string;
    aiUsdPerUser: string;
    operationalBrlPerUser: string;
  };
  period: {
    from: string;
    to: string;
  };
}

export interface PilotGoCheck {
  code: string;
  status: PilotGoStatus;
  message: string;
  evidence?: Record<string, unknown>;
}

export interface PilotGoAssessment {
  status: PilotGoStatus;
  evaluatedAt: string;
  checks: PilotGoCheck[];
  manualChecks: Array<{
    checkType: PilotManualCheckType;
    status: PilotManualCheckStatus | 'MISSING';
    notes: string | null;
    checkedAt: string | null;
  }>;
}
