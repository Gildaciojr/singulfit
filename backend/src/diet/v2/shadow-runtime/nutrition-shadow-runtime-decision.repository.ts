import type {
  NutritionShadowRuntimeDecisionType,
  NutritionShadowRuntimeSkipReason,
} from '@prisma/client';
import type { ConversationGoal } from '../../../context/conversation-goal-planner.contract';

export const NUTRITION_SHADOW_RUNTIME_DECISION_REPOSITORY = Symbol(
  'NUTRITION_SHADOW_RUNTIME_DECISION_REPOSITORY',
);

export interface ClaimNutritionShadowRuntimeDecisionInput {
  readonly id: string;
  readonly operationKey: string;
  readonly inputFingerprint: string;
  readonly userId: string;
  readonly conversationId: string | null;
  readonly messageId: string | null;
  readonly correlationId: string;
  readonly traceId: string | null;
  readonly conversationGoal: ConversationGoal;
  readonly ownershipToken: string;
}

export interface NutritionShadowRuntimeDecisionRecord {
  readonly id: string;
  readonly inputFingerprint: string;
  readonly conversationGoal: ConversationGoal;
  readonly decision: NutritionShadowRuntimeDecisionType;
  readonly skipReason: NutritionShadowRuntimeSkipReason | null;
  readonly shadowRunId: string | null;
  readonly ownershipClaimedAt: Date | null;
  readonly ownershipExpiresAt: Date | null;
}

export interface NutritionShadowRuntimeOwnership {
  readonly token: string;
  readonly claimedAt: Date;
  readonly expiresAt: Date;
}

export type ClaimNutritionShadowRuntimeDecisionResult =
  | Readonly<{
      kind: 'OWNERSHIP_CREATED';
      decision: NutritionShadowRuntimeDecisionRecord;
      ownership: NutritionShadowRuntimeOwnership;
    }>
  | Readonly<{
      kind: 'TERMINAL_REUSED';
      decision: NutritionShadowRuntimeDecisionRecord;
    }>
  | Readonly<{
      kind: 'OWNERSHIP_ACTIVE';
      decision: NutritionShadowRuntimeDecisionRecord;
      ownershipClaimedAt: Date;
      ownershipExpiresAt: Date;
    }>
  | Readonly<{
      kind: 'OWNERSHIP_RECOVERED';
      decision: NutritionShadowRuntimeDecisionRecord;
      ownership: NutritionShadowRuntimeOwnership;
      previousOwnershipExpiresAt: Date;
    }>;

export interface NutritionShadowRuntimeDecisionRepository {
  claim(
    input: ClaimNutritionShadowRuntimeDecisionInput,
  ): Promise<ClaimNutritionShadowRuntimeDecisionResult>;
  completeStarted(
    id: string,
    ownershipToken: string,
    shadowRunId: string,
  ): Promise<NutritionShadowRuntimeDecisionRecord>;
  completeSkipped(
    id: string,
    ownershipToken: string,
    reason: NutritionShadowRuntimeSkipReason,
  ): Promise<NutritionShadowRuntimeDecisionRecord>;
}
