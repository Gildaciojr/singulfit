import { FitnessGoal, StageOfChange } from '@prisma/client';
import type { NutritionConversationContext } from './nutrition-conversation-context.interface';
import type { NutritionConversationPersonalization } from './nutrition-conversation-planning.contract';

export class NutritionConversationPersonalizationEngine {
  personalize(
    context: NutritionConversationContext,
  ): NutritionConversationPersonalization {
    const rationaleCodes = new Set<string>();
    const fatigue = context.communication.fatigue;
    const repetitionRisk =
      fatigue.repeatedThemeScore >= 60 || fatigue.repeatedPhraseScore >= 60;
    const safetySensitive =
      context.userContext.relevantRestrictions.length > 0 ||
      context.userContext.relevantAllergies.length > 0;
    const performanceOriented =
      context.userContext.goal === FitnessGoal.MUSCLE_GAIN ||
      context.communication.motivationFocus === 'PERFORMANCE' ||
      ['HIGH', 'ATHLETE'].includes(context.userContext.activityLevel ?? '');
    const continuityAvailable =
      context.userContext.memory !== undefined ||
      context.userContext.longitudinalSignal !== undefined ||
      (context.episodicMemory?.episodes.length ?? 0) > 0;
    const behavioralSupportStages = new Set<StageOfChange>([
      StageOfChange.PRE_CONTEMPLATION,
      StageOfChange.CONTEMPLATION,
      StageOfChange.PREPARATION,
    ]);
    const behavioralSupport = behavioralSupportStages.has(
      context.communication.stageOfChange,
    );
    const cognitiveLoad =
      fatigue.score >= 70 || repetitionRisk
        ? 'LOW'
        : context.dialogue?.explicitDetailRequest === true &&
            context.communication.preferredMessageLength >= 800
          ? 'HIGH'
          : 'MODERATE';
    const explanationLevel = context.dialogue?.specificQuestion
      ? 'BRIEF_REASON'
      : cognitiveLoad === 'LOW'
        ? 'ANSWER_ONLY'
        : cognitiveLoad === 'HIGH'
          ? 'DETAILED'
          : 'CONTEXTUAL';
    const formality = safetySensitive
      ? 'PROFESSIONAL_PRECISE'
      : context.communication.communicationStyle === 'ANALYTICAL'
        ? 'PROFESSIONAL_NATURAL'
        : 'NATURAL';
    const motivationalIntensity =
      cognitiveLoad === 'LOW' || safetySensitive
        ? 'DISCREET'
        : context.direction.supportingEvidence.positiveFactors.length > 0
          ? 'MODERATE'
          : 'NONE';
    const educationalFocus =
      repetitionRisk || cognitiveLoad === 'LOW'
        ? 'LOW'
        : context.dialogue?.specificQuestion ||
            context.dialogue?.explicitDetailRequest
          ? 'HIGH'
          : 'MEDIUM';
    const behavioralFocus = behavioralSupport ? 'HIGH' : 'MEDIUM';
    const objectivity =
      context.communication.prefersShortMessages ||
      context.dialogue?.specificQuestion ||
      cognitiveLoad === 'LOW'
        ? 'HIGH'
        : 'MEDIUM';
    const questionBudget =
      !safetySensitive &&
      !repetitionRisk &&
      fatigue.score < 70 &&
      (context.communication.shouldAskQuestion ||
        context.dialogue?.clarificationRequired === true ||
        context.dialogue?.interactionIntent === 'FOLLOW_UP')
        ? 1
        : 0;

    if (safetySensitive) rationaleCodes.add('SAFETY_SENSITIVE');
    if (performanceOriented) rationaleCodes.add('PERFORMANCE_ORIENTED');
    if (continuityAvailable) rationaleCodes.add('CONTINUITY_AVAILABLE');
    if (repetitionRisk) rationaleCodes.add('REPETITION_RISK');
    if (cognitiveLoad === 'LOW') rationaleCodes.add('REDUCED_COGNITIVE_LOAD');
    if (context.dialogue?.specificQuestion)
      rationaleCodes.add('SPECIFIC_QUESTION');
    if (context.dialogue?.explicitDetailRequest)
      rationaleCodes.add('EXPLICIT_DETAIL_REQUEST');
    if (behavioralSupport) rationaleCodes.add('BEHAVIORAL_SUPPORT');

    return Object.freeze({
      cognitiveLoad,
      explanationLevel,
      formality,
      motivationalIntensity,
      objectivity,
      educationalFocus,
      behavioralFocus,
      safetySensitive,
      performanceOriented,
      continuityAvailable,
      repetitionRisk,
      questionBudget,
      rationaleCodes: Object.freeze([...rationaleCodes].sort()),
    });
  }
}
