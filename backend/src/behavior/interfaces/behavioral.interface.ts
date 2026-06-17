import {
  BehavioralAdherenceStyle,
  BehavioralCommunicationStyle,
  BehavioralInsightType,
  BehavioralMotivationStyle,
  BehavioralPersonalityPattern,
  MotivationTriggerType,
  StageOfChange,
} from '@prisma/client';

export interface BehavioralMessageSignal {
  content: string;
  timestamp: Date;
}

export interface BehavioralEngineInput {
  messages: BehavioralMessageSignal[];
  memorySummaries: string[];
  goal: string | null;
  activeDays: number;
  consecutiveDays: number;
  mealFrequency: number;
  regularityScore: number;
  consistencyScore: number;
  engagementScore: number;
  contextAdherenceScore: number | null;
  trendAdherenceScore: number | null;
  analysesLast30Days: number;
  responsesSent: number;
  responsesFollowedByInteraction: number;
  progressRecords: number;
  improvingTrend: boolean;
  previousStage: StageOfChange | null;
}

export interface WeightedBehavioralSignal<T extends string> {
  type: T;
  weight: number;
  evidence: string[];
}

export interface BehavioralInsightCandidate {
  type: BehavioralInsightType;
  summary: string;
  evidence: Record<string, string | number | boolean>;
}

export interface BehavioralEvaluation {
  communicationStyle: BehavioralCommunicationStyle;
  motivations: Array<WeightedBehavioralSignal<BehavioralMotivationStyle>>;
  dominantMotivation: BehavioralMotivationStyle;
  adherenceStyle: BehavioralAdherenceStyle;
  personalityPattern: BehavioralPersonalityPattern;
  confidenceScore: number;
  preferredEngagementHour: number | null;
  stage: StageOfChange;
  stageConfidence: number;
  stageEvidence: Record<string, string | number | boolean>;
  adherence: {
    score: number;
    frequencyScore: number;
    consistencyScore: number;
    habitScore: number;
    contextScore: number;
    responseScore: number;
  };
  triggers: Array<WeightedBehavioralSignal<MotivationTriggerType>>;
  insights: BehavioralInsightCandidate[];
  evidence: Record<string, string | number | boolean>;
}

export interface BehavioralSignals {
  communicationStyle: BehavioralCommunicationStyle;
  motivationStyle: BehavioralMotivationStyle;
  adherenceStyle: BehavioralAdherenceStyle;
  personalityPattern: BehavioralPersonalityPattern;
  stage: StageOfChange;
  adherenceScore: number;
  engagementScore: number;
  preferredEngagementHour: number | null;
  confidenceScore: number;
  motivations: Array<{
    type: BehavioralMotivationStyle;
    weight: number;
  }>;
  triggers: Array<{
    type: MotivationTriggerType;
    weight: number;
  }>;
  insights: BehavioralInsightType[];
  useShortMessages: boolean;
  motivationLine: string;
}
