import { AIJobType, type FitnessGoal, type Prisma } from '@prisma/client';
import type { PendingAIJobCompletion } from '../../ai/pending-ai-job-completion.contract';
import type { GeneratedDietPlan } from './generated-diet.interface';

export type LegacyDietStoredAIJobResult = Prisma.InputJsonObject & {
  readonly candidateOutput: string;
  readonly model: string;
};

export type LegacyDietAIJobCompletion = PendingAIJobCompletion<
  typeof AIJobType.DIET,
  LegacyDietStoredAIJobResult
>;

export interface LegacyDietCandidate {
  readonly status: 'PENDING_COMPLETION';
  readonly userId: string;
  readonly profileId: string;
  readonly objective: FitnessGoal;
  readonly aiJobId: string;
  readonly operationKey: string | null;
  readonly generatedAt: Date;
  readonly output: GeneratedDietPlan;
  readonly storedResult: LegacyDietStoredAIJobResult;
  readonly completion: LegacyDietAIJobCompletion;
}
