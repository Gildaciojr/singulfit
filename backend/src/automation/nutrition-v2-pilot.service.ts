import { Injectable } from '@nestjs/common';
import type { ConversationGoalDecision } from '../context/conversation-goal-planner.contract';
import { CONVERSATION_GOAL } from '../context/conversation-goal-planner.contract';
import type { GenerateNutritionPlanV2Input } from '../diet/v2/nutrition-planning-generation.contract';
import { NutritionV2PilotConfigService } from './nutrition-v2-pilot-config.service';

export type NutritionV2PilotEligibilityStatus =
  | 'ELIGIBLE'
  | 'DISABLED'
  | 'INVALID_CONFIG'
  | 'NOT_AUTHORIZED'
  | 'INELIGIBLE_OPERATION'
  | 'MISSING_OWNERSHIP';

export interface NutritionV2PilotEligibilityInput {
  readonly userId: string;
  readonly profileId: string | null;
  readonly decision: ConversationGoalDecision;
  readonly generationInput: GenerateNutritionPlanV2Input | null;
}

export interface NutritionV2PilotEligibility {
  readonly status: NutritionV2PilotEligibilityStatus;
  readonly eligible: boolean;
}

@Injectable()
export class NutritionV2PilotService {
  constructor(private readonly config: NutritionV2PilotConfigService) {}

  evaluate(
    input: NutritionV2PilotEligibilityInput,
  ): NutritionV2PilotEligibility {
    const authorization = this.config.authorize(input.userId);
    if (authorization.status !== 'AUTHORIZED') {
      return Object.freeze({
        status: authorization.status,
        eligible: false,
      });
    }
    if (
      input.decision.goal !== CONVERSATION_GOAL.GENERATE_DIET_PLAN ||
      input.generationInput?.explicitArtifactType !== 'DAILY_STRUCTURE'
    ) {
      return Object.freeze({
        status: 'INELIGIBLE_OPERATION',
        eligible: false,
      });
    }
    if (!input.profileId?.trim()) {
      return Object.freeze({
        status: 'MISSING_OWNERSHIP',
        eligible: false,
      });
    }
    return Object.freeze({ status: 'ELIGIBLE', eligible: true });
  }
}
