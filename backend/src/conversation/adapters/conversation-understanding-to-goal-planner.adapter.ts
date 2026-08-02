import { Injectable } from '@nestjs/common';
import type { ConversationGoalPlannerInput } from '../../context/conversation-goal-planner.contract';
import type { ConversationUnderstandingToGoalPlannerAdapterInput } from '../contracts/conversation-goal-preparation.contract';

@Injectable()
export class ConversationUnderstandingToGoalPlannerAdapter {
  adapt(
    input: ConversationUnderstandingToGoalPlannerAdapterInput,
  ): ConversationGoalPlannerInput {
    const { preparation, targetPlan } = input;
    return Object.freeze({
      snapshot: preparation.snapshot,
      adaptiveDecision: preparation.adaptiveDecision,
      recognizedIntent: preparation.understanding.intent,
      completion: preparation.snapshot.completion,
      conversationContext: Object.freeze({
        ...(targetPlan === null ? {} : { planTarget: targetPlan }),
        progressContextAvailable: preparation.progressContextAvailable,
        confirmationRequired:
          preparation.confirmationPending ||
          preparation.understanding.ambiguity.clarificationRequired,
      }),
      recentHistory: Object.freeze({
        currentLogicalTurn: preparation.recentHistory.currentLogicalTurn,
        entries: Object.freeze(
          preparation.recentHistory.entries.map((entry) =>
            Object.freeze({ ...entry }),
          ),
        ),
      }),
    });
  }
}
