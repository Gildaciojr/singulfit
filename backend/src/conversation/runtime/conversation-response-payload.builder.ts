import { Injectable } from '@nestjs/common';
import type { ConversationExecutionRoute } from '../contracts/conversation-execution-route.contract';
import type {
  CoachConversationHumanContext,
  CoachConversationTurnCue,
} from '../../context/coach-conversation-human-context.contract';

export type ConversationResponsePayload =
  | Readonly<{
      kind: 'CONTEXTUAL_RESPONSE';
      cue: CoachConversationTurnCue;
      preferredName: string | null;
      goal: string | null;
      continuity: string | null;
      trainingTime: string | null;
      currentDiet: string | null;
      currentWorkout: string | null;
    }>
  | Readonly<{
      kind: 'CONFIRMATION_REQUEST';
      targetPlan: 'DIET' | 'WORKOUT' | 'BOTH' | null;
      preferredName?: string | null;
    }>
  | Readonly<{
      kind: 'SAFETY_GUIDANCE';
      action: 'CAUTION_GUIDANCE' | 'PROFESSIONAL_GUIDANCE' | 'URGENT_GUIDANCE';
    }>;

export interface ConversationRealizedResponse {
  readonly message: string;
  readonly requiresFollowUp: boolean;
  readonly followUpQuestion: string | null;
}

@Injectable()
export class ConversationResponsePayloadBuilder {
  build(
    route: ConversationExecutionRoute,
    context: CoachConversationHumanContext | null,
  ): ConversationResponsePayload | null {
    if (route.kind === 'ANSWER_MESSAGE') {
      return Object.freeze({
        kind: 'CONTEXTUAL_RESPONSE',
        cue: context?.turnCue ?? 'COMMON',
        preferredName: context?.preferredName?.value ?? null,
        goal: context?.goal?.value ?? null,
        continuity: context?.continuity?.value ?? null,
        trainingTime: context?.routine.trainingTime?.value ?? null,
        currentDiet: context?.currentPlans.diet?.value ?? null,
        currentWorkout: context?.currentPlans.workout?.value ?? null,
      });
    }
    if (route.kind === 'CONFIRMATION') {
      return Object.freeze({
        kind: 'CONFIRMATION_REQUEST',
        targetPlan: route.targetPlan,
        preferredName: context?.preferredName?.value ?? null,
      });
    }
    if (route.kind === 'SAFETY_RESPONSE') {
      return Object.freeze({ kind: 'SAFETY_GUIDANCE', action: route.action });
    }
    return null;
  }
}
