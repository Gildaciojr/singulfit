import { AIJobType, Prisma } from '@prisma/client';
import type { PendingAIJobCompletion } from '../../ai/pending-ai-job-completion.contract';
import type { CoachProfileSnapshot } from '../../context/coach-profile-snapshot.contract';
import type { ConversationGoalDecision } from '../../context/conversation-goal-planner.contract';
import type {
  WorkoutArtifactResolution,
  WorkoutPlanningReadiness,
} from './workout-planning-artifact.contract';
import type {
  WorkoutPlanningContext,
  WorkoutProgressEvidence,
  WorkoutRecognizedContext,
} from './workout-planning-context.contract';
import type { WorkoutPlanV2 } from './workout-plan-v2.contract';
import type { WorkoutPlanningStrategy } from './workout-planning-strategy.contract';

export interface WorkoutSafetyGateResult {
  readonly outcome:
    | 'ALLOWED'
    | 'LIMITED'
    | 'REQUIRES_CONFIRMATION'
    | 'BLOCKED'
    | 'PROFESSIONAL_REVIEW_RECOMMENDED';
  readonly reasonCodes: readonly string[];
}

export interface GenerateWorkoutPlanV2Input {
  readonly userId: string;
  readonly decision: ConversationGoalDecision;
  readonly snapshot: CoachProfileSnapshot;
  readonly recognizedContext: WorkoutRecognizedContext;
  readonly referenceDate: Date;
  readonly progressEvidence?: readonly WorkoutProgressEvidence[];
  readonly previousPlan?: WorkoutPlanV2;
}

export interface PreparedWorkoutPlanningV2 {
  readonly resolution: WorkoutArtifactResolution;
  readonly readiness: WorkoutPlanningReadiness | null;
  readonly context: WorkoutPlanningContext | null;
  readonly strategy: WorkoutPlanningStrategy | null;
  readonly safety: WorkoutSafetyGateResult | null;
}

export type WorkoutPlanningStoredAIJobResult = Prisma.InputJsonObject & {
  readonly candidateOutput: string;
  readonly model: string;
};

export type WorkoutPlanningAIJobCompletion = PendingAIJobCompletion<
  typeof AIJobType.WORKOUT,
  WorkoutPlanningStoredAIJobResult
>;

interface WorkoutPlanningGenerationResultBase {
  readonly output: WorkoutPlanV2;
  readonly aiJobId: string;
  readonly operationKey: string;
  readonly storedResult: WorkoutPlanningStoredAIJobResult;
}

export interface PendingWorkoutPlanningGenerationResult extends WorkoutPlanningGenerationResultBase {
  readonly status: 'PENDING_COMPLETION';
  readonly reused: false;
  readonly completion: WorkoutPlanningAIJobCompletion;
}

export interface CompletedWorkoutPlanningGenerationResult extends WorkoutPlanningGenerationResultBase {
  readonly status: 'ALREADY_COMPLETED';
  readonly reused: true;
  readonly completion: null;
}

export type WorkoutPlanningGenerationResult =
  | PendingWorkoutPlanningGenerationResult
  | CompletedWorkoutPlanningGenerationResult;
