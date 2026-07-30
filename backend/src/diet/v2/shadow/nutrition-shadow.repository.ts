import type { NutritionShadowErrorCategory } from '@prisma/client';
import type { ConversationGoal } from '../../../context/conversation-goal-planner.contract';
import type {
  NutritionShadowCompletion,
  NutritionShadowRunRecord,
} from './nutrition-shadow.contract';

export const NUTRITION_SHADOW_REPOSITORY = Symbol(
  'NUTRITION_SHADOW_REPOSITORY',
);

export interface StartNutritionShadowRunInput {
  readonly operationKey: string;
  readonly inputFingerprint: string;
  readonly correlationId: string;
  readonly traceId?: string;
  readonly userId: string;
  readonly conversationGoal: ConversationGoal;
  readonly conversationId?: string;
  readonly messageId?: string;
}

export interface NutritionShadowRepository {
  start(input: StartNutritionShadowRunInput): Promise<{
    readonly run: NutritionShadowRunRecord;
    readonly reused: boolean;
  }>;
  succeed(
    id: string,
    completion: NutritionShadowCompletion,
  ): Promise<NutritionShadowRunRecord>;
  fail(
    id: string,
    input: {
      readonly category: NutritionShadowErrorCategory;
      readonly code: string | null;
      readonly message: string;
      readonly totalDurationMs: number;
      readonly builderDurationMs: number;
      readonly strategyDurationMs: number;
    },
  ): Promise<NutritionShadowRunRecord>;
}
