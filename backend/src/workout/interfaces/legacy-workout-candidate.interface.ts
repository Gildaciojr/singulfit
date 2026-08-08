import { AIJobType, type FitnessGoal, type Prisma } from '@prisma/client';
import type { PendingAIJobCompletion } from '../../ai/pending-ai-job-completion.contract';
import type { GeneratedWorkoutPlan } from './generated-workout.interface';

export type LegacyWorkoutStoredAIJobResult = Prisma.InputJsonObject & {
  readonly candidateOutput: string;
  readonly model: string;
};

export type LegacyWorkoutAIJobCompletion = PendingAIJobCompletion<
  typeof AIJobType.WORKOUT,
  LegacyWorkoutStoredAIJobResult
>;

export interface LegacyWorkoutCandidate {
  readonly status: 'PENDING_COMPLETION';
  readonly userId: string;
  readonly profileId: string;
  readonly objective: FitnessGoal;
  readonly aiJobId: string;
  readonly operationKey: string | null;
  readonly generatedAt: Date;
  readonly output: GeneratedWorkoutPlan;
  readonly storedResult: LegacyWorkoutStoredAIJobResult;
  readonly completion: LegacyWorkoutAIJobCompletion;
}
