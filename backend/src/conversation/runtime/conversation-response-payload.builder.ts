import { Injectable } from '@nestjs/common';
import type { ConversationExecutionRoute } from '../contracts/conversation-execution-route.contract';
import type {
  CoachConversationHumanContext,
  CoachConversationTurnCue,
} from '../../context/coach-conversation-human-context.contract';

export type ConversationResponsePayload =
  | Readonly<{
      kind: 'CONTEXTUAL_RESPONSE';
      routeKind: 'ANSWER_MESSAGE' | 'NUTRITION_GUIDANCE' | 'PROGRESS_REVIEW';
      cue: CoachConversationTurnCue;
      currentMessage: string;
      preferredName: string | null;
      goal: string | null;
      desiredOutcome: string | null;
      continuity: string | null;
      trainingTime: string | null;
      mealTimes: readonly string[];
      cookingAvailability: string | null;
      mealsAwayFromHome: boolean | null;
      trainingModality: string | null;
      trainingExperience: string | null;
      dietaryPattern: string | null;
      preferredFoods: readonly string[];
      rejectedFoods: readonly string[];
      restrictions: readonly string[];
      communicationStyle: string | null;
      motivation: string | null;
      messagePreference: 'SHORT' | 'BALANCED' | 'DETAILED';
      journeyStage: string | null;
      memories: readonly string[];
      progress: string | null;
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
    if (
      route.kind === 'ANSWER_MESSAGE' ||
      route.kind === 'NUTRITION_GUIDANCE' ||
      route.kind === 'PROGRESS_REVIEW'
    ) {
      return Object.freeze({
        kind: 'CONTEXTUAL_RESPONSE',
        routeKind: route.kind,
        cue: context?.turnCue ?? 'COMMON',
        currentMessage: context?.currentMessage ?? '',
        preferredName: context?.preferredName?.value ?? null,
        goal: context?.goal?.value ?? null,
        desiredOutcome: context?.desiredOutcome?.value ?? null,
        continuity: context?.continuity?.value ?? null,
        trainingTime: context?.routine.trainingTime?.value ?? null,
        mealTimes: context?.routine.mealTimes?.value ?? Object.freeze([]),
        cookingAvailability:
          context?.routine.cookingAvailability?.value ?? null,
        mealsAwayFromHome: context?.routine.mealsAwayFromHome?.value ?? null,
        trainingModality: context?.training.modality?.value ?? null,
        trainingExperience: context?.training.experience?.value ?? null,
        dietaryPattern: context?.nutrition.dietaryPattern?.value ?? null,
        preferredFoods:
          context?.nutrition.preferredFoods?.value ?? Object.freeze([]),
        rejectedFoods:
          context?.nutrition.rejectedFoods?.value ?? Object.freeze([]),
        restrictions: context?.restrictions?.value ?? Object.freeze([]),
        communicationStyle: context?.communication.style?.value ?? null,
        motivation: context?.communication.motivation?.value ?? null,
        messagePreference:
          context?.communication.messagePreference ?? 'BALANCED',
        journeyStage: context?.communication.journeyStage?.value ?? null,
        memories: Object.freeze(
          (context?.memory ?? []).map((memory) => memory.summary),
        ),
        progress: context?.progress?.value ?? null,
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
