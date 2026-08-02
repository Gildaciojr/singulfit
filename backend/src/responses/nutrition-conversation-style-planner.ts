import type { CompositionPlan } from './conversation-composition.contract';
import type { NutritionConversationContext } from './nutrition-conversation-context.interface';
import { NutritionConversationPersonalizationEngine } from './nutrition-conversation-personalization.engine';
import type {
  NutritionConversationPersonalization,
  NutritionConversationStylePlan,
} from './nutrition-conversation-planning.contract';
import type { SanitizedConversationDecision } from './sanitized-conversation-payload.contract';

export class NutritionConversationStylePlanner {
  private readonly personalizationEngine =
    new NutritionConversationPersonalizationEngine();

  plan(
    context: NutritionConversationContext,
    composition: CompositionPlan,
    selectedDecisions: readonly SanitizedConversationDecision[],
    personalization: NutritionConversationPersonalization = this.personalizationEngine.personalize(
      context,
    ),
  ): NutritionConversationStylePlan {
    const recognition = new Set<string>(
      (context.recognition?.signals ?? []).map((signal) => signal.kind),
    );
    const emotional = new Set<string>(
      (context.emotional?.signals ?? []).map((signal) => signal.kind),
    );
    const episodes = context.episodicMemory?.episodes ?? [];
    const victory =
      composition.centralIntent === 'CELEBRATE' ||
      ['BIG_WIN', 'SMALL_WIN', 'IMPROVEMENT', 'RECOVERY'].some((kind) =>
        recognition.has(kind),
      );
    const plateau = recognition.has('PLATEAU');
    const recovery =
      composition.centralIntent === 'RECOVER' ||
      ['SETBACK', 'RECURRENCE', 'BAD_STRATEGY'].some((kind) =>
        recognition.has(kind),
      );
    const emotionallySensitive = ['FRUSTRATION', 'OVERWHELM', 'FATIGUE'].some(
      (kind) => emotional.has(kind),
    );
    const correction = selectedDecisions.some((decision) =>
      ['PROVIDE_RECOMMENDATION', 'CORRECT_LIMITING_FACTOR'].includes(decision),
    );
    const toneStrategy = plateau
      ? ('PLATEAU_REASSURANCE' as const)
      : recovery || personalization.cognitiveLoad === 'LOW'
        ? ('CALM_RECOVERY' as const)
        : victory
          ? recognition.has('BIG_WIN') || recognition.has('IMPROVEMENT')
            ? ('PROGRESS_REINFORCEMENT' as const)
            : ('DISCREET_CELEBRATION' as const)
          : composition.centralIntent === 'TEACH'
            ? ('CURIOUS_EXPLANATION' as const)
            : correction
              ? ('SUPPORTIVE_CORRECTION' as const)
              : ('CALM_OBJECTIVE' as const);
    const openingStrategy =
      personalization.continuityAvailable &&
      (episodes.length > 0 || composition.centralIntent === 'FOLLOW_UP')
        ? ('CONTINUITY' as const)
        : emotionallySensitive || recovery
          ? ('VALIDATING' as const)
          : victory
            ? ('CELEBRATORY' as const)
            : context.dialogue?.specificQuestion ||
                composition.depth === 'MINIMAL'
              ? ('DIRECT' as const)
              : ('CONTEXTUAL' as const);
    const closingStrategy =
      composition.closingRequirement === 'PROHIBITED'
        ? ('NONE' as const)
        : composition.centralIntent === 'FOLLOW_UP'
          ? ('REFLECTIVE' as const)
          : recovery || emotionallySensitive
            ? ('GROUNDING' as const)
            : victory
              ? ('CONTINUITY' as const)
              : ('AUTONOMY' as const);
    const pacing =
      personalization.cognitiveLoad === 'LOW' || composition.depth === 'MINIMAL'
        ? ('COMPACT' as const)
        : context.dialogue?.specificQuestion
          ? ('DIRECT' as const)
          : emotionallySensitive || recovery
            ? ('SUPPORTIVE' as const)
            : personalization.explanationLevel === 'DETAILED'
              ? ('EXPLANATORY' as const)
              : ('BALANCED' as const);
    const transitionStyle =
      composition.paragraphCount <= 1
        ? ('SEAMLESS' as const)
        : composition.rhythm === 'WARM'
          ? ('GENTLE' as const)
          : composition.rhythm === 'EXPLANATORY'
            ? ('LOGICAL' as const)
            : ('CONTINUITY' as const);
    const sensitiveMemory = episodes.some(
      (episode) => episode.sensitivity === 'SENSITIVE',
    );
    const humor =
      !emotionallySensitive &&
      !recovery &&
      !sensitiveMemory &&
      !personalization.safetySensitive &&
      context.communication.fatigue.score < 40 &&
      ['CELEBRATE', 'RECOGNIZE'].includes(composition.centralIntent)
        ? ('SUBTLE_LIGHTNESS_ALLOWED' as const)
        : ('PROHIBITED' as const);
    const lexicalVariant = this.variant([
      composition.dialogueProfile,
      toneStrategy,
      context.communication.communicationStyle,
      context.communication.stageOfChange,
      context.userContext.goal ?? 'NO_GOAL',
      this.fatigueBand(context.communication.fatigue.score),
      this.fatigueBand(context.communication.fatigue.repeatedThemeScore),
      this.fatigueBand(context.communication.fatigue.repeatedPhraseScore),
      context.communication.prefersShortMessages ? 'SHORT' : 'STANDARD',
      [...recognition].sort().join(','),
      [...emotional].sort().join(','),
      episodes
        .map((episode) => episode.category)
        .sort()
        .join(','),
      composition.depth,
      personalization.formality,
      personalization.explanationLevel,
    ]);
    const rationaleCodes = new Set(personalization.rationaleCodes);
    rationaleCodes.add(`TONE_${toneStrategy}`);
    rationaleCodes.add(`OPENING_${openingStrategy}`);
    rationaleCodes.add(`PACING_${pacing}`);

    return Object.freeze({
      toneStrategy,
      openingStrategy,
      closingStrategy,
      pacing,
      transitionStyle,
      lexicalVariant,
      humor,
      explanationLevel: personalization.explanationLevel,
      formality: personalization.formality,
      motivationalIntensity: personalization.motivationalIntensity,
      objectivity: personalization.objectivity,
      educationalFocus: personalization.educationalFocus,
      behavioralFocus: personalization.behavioralFocus,
      maximumQuestions: Math.min(
        personalization.questionBudget,
        composition.profileBudgets.maximumQuestions,
      ) as 0 | 1,
      rationaleCodes: Object.freeze([...rationaleCodes].sort()),
    });
  }

  private variant(parts: readonly string[]): 'A' | 'B' | 'C' | 'D' {
    const value = parts.join('|');
    let hash = 17;
    for (const character of value) {
      hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 104729;
    }
    return (['A', 'B', 'C', 'D'] as const)[hash % 4];
  }

  private fatigueBand(score: number): string {
    return score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
  }
}
