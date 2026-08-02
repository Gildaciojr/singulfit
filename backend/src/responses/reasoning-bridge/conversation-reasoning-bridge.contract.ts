import type { ConversationGoalDecision } from '../../context/conversation-goal-planner.contract';
import type { LongitudinalCoachingDecision } from '../../longitudinal-coaching/longitudinal-coaching.contract';
import type { LongitudinalResponseContext } from '../../longitudinal/interfaces/longitudinal.interface';
import type { NutritionReasoningResult } from '../../nutrition-reasoning/nutrition-reasoning.contract';
import type { WorkoutReasoningResult } from '../../workout-reasoning/workout-reasoning.contract';
import type { CoachConversationHumanContext } from '../../context/coach-conversation-human-context.contract';

export type ConversationReasoningImportance =
  | 'essencial'
  | 'alta'
  | 'moderada'
  | 'complementar';

export type ConversationReasoningTeachingTopic =
  | 'proteína'
  | 'hidratação'
  | 'energia para o treino'
  | 'recuperação'
  | 'fibras e saciedade'
  | 'regularidade'
  | 'escolhas práticas'
  | 'técnica de treino'
  | 'progressão de treino'
  | 'consistência';

export interface ConversationReasoningBridgeInput {
  readonly planner?: ConversationGoalDecision | null;
  readonly nutrition?: NutritionReasoningResult | null;
  readonly workout?: WorkoutReasoningResult | null;
  readonly longitudinal?: LongitudinalCoachingDecision | null;
  readonly longitudinalContext?: LongitudinalResponseContext | null;
  readonly previouslyTaughtTopics?: readonly ConversationReasoningTeachingTopic[];
  readonly application?: ConversationReasoningApplication;
  readonly human?: CoachConversationHumanContext | null;
}

export interface ConversationReasoningApplication {
  readonly nutrition: ConversationReasoningApplicationState;
  readonly workout: ConversationReasoningApplicationState;
  readonly longitudinal: ConversationReasoningApplicationState;
}

export interface ConversationReasoningApplicationState {
  readonly appliedToGeneration: boolean;
  readonly observedOnly: boolean;
  readonly unavailable: boolean;
}

export interface ConversationReasoningSummary {
  readonly goal: string | null;
  readonly decision: string | null;
  readonly expectedBenefit: string | null;
}

export interface ConversationReasoningPriorityEvidence {
  readonly topic: string;
  readonly importance: ConversationReasoningImportance;
  readonly explanation: string;
}

export interface ConversationReasoningStrategyEvidence {
  readonly name: string;
  readonly purpose: string;
}

export interface ConversationReasoningRestrictionEvidence {
  readonly guidance: string;
  readonly importance: ConversationReasoningImportance;
}

export interface ConversationReasoningTradeoffEvidence {
  readonly preferred: string;
  readonly deprioritized: string;
  readonly explanation: string;
}

export interface ConversationReasoningExplanationEvidence {
  readonly point: string;
  readonly because: string;
  readonly benefit: string;
  readonly avoidedRisk: string | null;
}

export interface ConversationReasoningTeachingEvidence {
  readonly topic: ConversationReasoningTeachingTopic;
  readonly purpose: string;
}

export interface ConversationReasoningQuestionEvidence {
  readonly question: string;
  readonly purpose: string;
}

export interface ConversationReasoningSafetyEvidence {
  readonly requiresCaution: boolean;
  readonly professionalGuidanceRecommended: boolean;
  readonly guidance: readonly string[];
}

export interface ConversationReasoningLongitudinalEvidence {
  readonly continuity: string | null;
  readonly progress: string | null;
  readonly adherence: string | null;
  readonly repetitionRisk: boolean;
}

export interface ConversationReasoningHumanEvidence {
  readonly preferredName: string | null;
  readonly goal: string | null;
  readonly desiredOutcome: string | null;
  readonly trainingTime: string | null;
  readonly trainingModality: string | null;
  readonly trainingExperience: string | null;
  readonly foodPreferences: readonly string[];
  readonly rejectedFoods: readonly string[];
  readonly restrictions: readonly string[];
  readonly communicationStyle: string | null;
  readonly motivation: string | null;
  readonly messagePreference: 'SHORT' | 'BALANCED' | 'DETAILED';
  readonly memory: readonly string[];
  readonly continuity: string | null;
  readonly progress: string | null;
  readonly currentDiet: string | null;
  readonly currentWorkout: string | null;
}

export interface ConversationReasoningEvidence {
  readonly summary: ConversationReasoningSummary;
  readonly priorities: readonly ConversationReasoningPriorityEvidence[];
  readonly strategies: readonly ConversationReasoningStrategyEvidence[];
  readonly restrictions: readonly ConversationReasoningRestrictionEvidence[];
  readonly tradeoffs: readonly ConversationReasoningTradeoffEvidence[];
  readonly explanations: readonly ConversationReasoningExplanationEvidence[];
  readonly teachingOpportunities: readonly ConversationReasoningTeachingEvidence[];
  readonly suggestedQuestions: readonly ConversationReasoningQuestionEvidence[];
  readonly safety: ConversationReasoningSafetyEvidence;
  readonly longitudinal: ConversationReasoningLongitudinalEvidence;
  readonly human?: ConversationReasoningHumanEvidence | null;
  readonly application: ConversationReasoningApplication;
}

export interface ConversationReasoningSourceAvailability {
  readonly planner: boolean;
  readonly nutrition: boolean;
  readonly workout: boolean;
  readonly longitudinal: boolean;
}

export interface ConversationReasoningBridgeResult {
  readonly evidence: ConversationReasoningEvidence | null;
  readonly availability: ConversationReasoningSourceAvailability;
}
