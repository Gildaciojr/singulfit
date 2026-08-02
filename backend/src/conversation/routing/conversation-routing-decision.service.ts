import { Injectable } from '@nestjs/common';
import { ConversationGoalPlannerService } from '../../context/conversation-goal-planner.service';
import {
  CONVERSATION_EXECUTION_ROUTER_VERSION,
  CONVERSATION_ROUTING_DECISION_VERSION,
  type ConversationRoutingDecision,
} from '../contracts/conversation-execution-route.contract';
import {
  CONVERSATION_GOAL_PREPARATION_VERSION,
  type ConversationGoalPreparationInput,
} from '../contracts/conversation-goal-preparation.contract';
import { ConversationGoalPreparationService } from '../understanding/conversation-goal-preparation.service';
import { ConversationExecutionRouterService } from './conversation-execution-router.service';

@Injectable()
export class ConversationRoutingDecisionService {
  constructor(
    private readonly preparation: ConversationGoalPreparationService,
    private readonly planner: ConversationGoalPlannerService,
    private readonly router: ConversationExecutionRouterService,
  ) {}

  decide(input: ConversationGoalPreparationInput): ConversationRoutingDecision {
    const plannerInput = this.preparation.prepare(input);
    const goalDecision = this.planner.plan(plannerInput);
    const executionRoute = this.router.route({
      understanding: input.understanding,
      goalDecision,
    });

    return Object.freeze({
      decisionVersion: CONVERSATION_ROUTING_DECISION_VERSION,
      understanding: input.understanding,
      plannerSummary: Object.freeze({
        recognizedIntent: plannerInput.recognizedIntent,
        targetPlan: plannerInput.conversationContext.planTarget ?? null,
        profileCompletionState: plannerInput.completion.overall,
        progressContextAvailable:
          plannerInput.conversationContext.progressContextAvailable,
        confirmationRequired:
          plannerInput.conversationContext.confirmationRequired,
        currentLogicalTurn: plannerInput.recentHistory.currentLogicalTurn,
      }),
      goalDecision,
      executionRoute,
      versions: Object.freeze({
        preparation: CONVERSATION_GOAL_PREPARATION_VERSION,
        router: CONVERSATION_EXECUTION_ROUTER_VERSION,
        decision: CONVERSATION_ROUTING_DECISION_VERSION,
      }),
    });
  }
}
