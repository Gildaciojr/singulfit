import { AIJobType, Prisma } from '@prisma/client';
import type { PendingAIJobCompletion } from '../../ai/pending-ai-job-completion.contract';
import type { CoachProfileSnapshot } from '../../context/coach-profile-snapshot.contract';
import type { ConversationGoalDecision } from '../../context/conversation-goal-planner.contract';
import type {
  NutritionArtifactResolution,
  NutritionArtifactType,
  OperationalNutritionPlanArtifactType,
  NutritionPlanningReadiness,
} from './nutrition-planning-artifact.contract';
import type {
  NutritionEvidenceSummary,
  NutritionPlanningContext,
} from './nutrition-planning-context.contract';
import type { NutritionPlanV2 } from './nutrition-plan-v2.contract';
import type { NutritionPlanningStrategy } from './nutrition-planning-strategy.contract';
import type {
  NutritionConversationalArtifactType,
  NutritionConversationalArtifactV1,
} from './nutrition-conversational-artifact.contract';

export type NutritionSafetyGateOutcome =
  | 'ALLOWED'
  | 'LIMITED_GUIDANCE'
  | 'REQUIRES_CONFIRMATION'
  | 'PROFESSIONAL_REVIEW_RECOMMENDED'
  | 'BLOCKED';

export interface NutritionSafetyGateResult {
  readonly outcome: NutritionSafetyGateOutcome;
  readonly reasonCodes: readonly (
    | 'NO_SAFETY_RESTRICTION'
    | 'MEDICAL_CONTEXT_PRESENT'
    | 'UNCONFIRMED_CONSTRAINT'
    | 'PROFILE_CONFLICT'
    | 'READINESS_BLOCKED'
    | 'POST_GENERATION_VALIDATION_FAILED'
  )[];
}

export interface GenerateNutritionPlanV2Input {
  readonly userId: string;
  readonly decision: ConversationGoalDecision;
  readonly snapshot: CoachProfileSnapshot;
  readonly referenceDate: Date;
  readonly explicitArtifactType?: NutritionArtifactType;
  readonly nutritionEvidence?: readonly NutritionEvidenceSummary[];
  readonly previousPlan?: NutritionPlanV2;
  readonly reviewedPlan?: {
    readonly id: string;
    readonly plan: NutritionPlanV2;
  };
  readonly requestedChangeReason?: NutritionPlanningContext['requestedChangeReason'];
}

export interface NutritionExecutionContextV2 {
  readonly correlationId: string;
  readonly traceId?: string;
}

export interface PreparedNutritionPlanningV2 {
  readonly resolution: NutritionArtifactResolution;
  readonly readiness: NutritionPlanningReadiness | null;
  readonly context: NutritionPlanningContext | null;
  readonly strategy: NutritionPlanningStrategy | null;
  readonly safety: NutritionSafetyGateResult | null;
}

export type NutritionPlanningStoredAIJobResult = Prisma.InputJsonObject & {
  readonly candidateOutput: string;
  readonly model: string;
};

export type NutritionPlanningAIJobCompletion = PendingAIJobCompletion<
  typeof AIJobType.DIET,
  NutritionPlanningStoredAIJobResult
>;

export type NutritionGenerationOutputV2 =
  | {
      readonly kind: 'PLAN';
      readonly artifactType: OperationalNutritionPlanArtifactType;
      readonly plan: NutritionPlanV2;
    }
  | {
      readonly kind: 'CONVERSATIONAL_ARTIFACT';
      readonly artifactType: NutritionConversationalArtifactType;
      readonly artifact: NutritionConversationalArtifactV1;
    }
  | {
      readonly kind: 'CURRENT_PLAN_PRESENTATION';
      readonly artifactType: 'CURRENT_PLAN_PRESENTATION';
    };

interface NutritionPlanningGenerationResultBase {
  readonly output: Exclude<
    NutritionGenerationOutputV2,
    { readonly kind: 'CURRENT_PLAN_PRESENTATION' }
  >;
  readonly aiJobId: string;
  readonly operationKey: string;
  readonly storedResult: NutritionPlanningStoredAIJobResult;
}

export interface PendingNutritionPlanningGenerationResult extends NutritionPlanningGenerationResultBase {
  readonly status: 'PENDING_COMPLETION';
  readonly reused: false;
  readonly completion: NutritionPlanningAIJobCompletion;
}

export interface CompletedNutritionPlanningGenerationResult extends NutritionPlanningGenerationResultBase {
  readonly status: 'ALREADY_COMPLETED';
  readonly reused: true;
  readonly completion: null;
}

export type NutritionPlanningGenerationResult =
  | PendingNutritionPlanningGenerationResult
  | CompletedNutritionPlanningGenerationResult
  | {
      readonly status: 'NO_GENERATION';
      readonly output: Extract<
        NutritionGenerationOutputV2,
        { readonly kind: 'CURRENT_PLAN_PRESENTATION' }
      >;
    };

export type PendingNutritionPlanGenerationResult =
  PendingNutritionPlanningGenerationResult & {
    readonly output: Extract<
      NutritionGenerationOutputV2,
      { readonly kind: 'PLAN' }
    >;
  };
export type PendingNutritionConversationalGenerationResult =
  PendingNutritionPlanningGenerationResult & {
    readonly output: Extract<
      NutritionGenerationOutputV2,
      { readonly kind: 'CONVERSATIONAL_ARTIFACT' }
    >;
  };
export type CompletedNutritionPlanGenerationResult =
  CompletedNutritionPlanningGenerationResult & {
    readonly output: Extract<
      NutritionGenerationOutputV2,
      { readonly kind: 'PLAN' }
    >;
  };
export type CompletedNutritionConversationalGenerationResult =
  CompletedNutritionPlanningGenerationResult & {
    readonly output: Extract<
      NutritionGenerationOutputV2,
      { readonly kind: 'CONVERSATIONAL_ARTIFACT' }
    >;
  };
