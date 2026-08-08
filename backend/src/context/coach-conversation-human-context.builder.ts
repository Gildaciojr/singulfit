import { Injectable } from '@nestjs/common';
import {
  BehavioralCommunicationStyle,
  FitnessGoal,
  GoalProgressionState,
  LongitudinalDirection,
} from '@prisma/client';
import type {
  CoachConversationHumanContext,
  CoachConversationHumanContextBuildInput,
  CoachConversationHumanFact,
  CoachConversationHumanMemory,
  CoachConversationTurnCue,
} from './coach-conversation-human-context.contract';
import type {
  CoachProfileDataSource,
  CoachProfileDatum,
  CoachProfileFoodPreference,
  CoachProfileSnapshot,
} from './coach-profile-snapshot.contract';

const MAX_LIST_ITEMS = 5;
const MAX_MEMORIES = 2;
const MAX_MEMORY_LENGTH = 280;
const TECHNICAL_MEMORY =
  /(?:\bscore\b|\bíndice\b|\bconfidence\b|\bmomentum\b|\bretention\b|\brisk\b|\bevidência\b|\bclassificação\b|\d+\s*\/\s*100)/iu;
const CONTINUITY_CUE =
  /\b(?:continu|retom|volt|de novo|outra vez|da última vez|como falamos|isso|aquilo|anterior)\b/iu;

@Injectable()
export class CoachConversationHumanContextBuilder {
  build(
    snapshot: CoachProfileSnapshot,
    input: CoachConversationHumanContextBuildInput = {},
  ): CoachConversationHumanContext {
    const behavioral = this.value(snapshot.conversation.behavioralStyle);
    const coachStyle = this.value(snapshot.conversation.coachStyle);

    return Object.freeze({
      currentMessage: input.currentMessage?.trim().slice(0, 1_000) ?? '',
      turnCue: this.turnCue(input.currentMessage),
      preferredName: this.firstName(snapshot.identity.displayName),
      goal: this.map(snapshot.nutrition.primaryGoal, (goal) =>
        this.goalLabel(goal),
      ),
      desiredOutcome: this.text(snapshot.nutrition.desiredOutcome),
      routine: Object.freeze({
        trainingTime: this.text(snapshot.routine.trainingTime),
        mealTimes: this.list(snapshot.routine.mealTimes),
        cookingAvailability: this.text(snapshot.nutrition.cookingAvailability),
        mealsAwayFromHome: this.available(snapshot.nutrition.mealsAwayFromHome),
      }),
      training: Object.freeze({
        modality: this.text(snapshot.training.preferredModality),
        experience: this.text(snapshot.training.experienceLevel),
      }),
      nutrition: Object.freeze({
        dietaryPattern: this.text(snapshot.nutrition.dietaryPattern),
        preferredFoods: this.foodPreferences(
          snapshot.preferences.foodPreferences,
          'PREFERRED',
        ),
        rejectedFoods: this.rejectedFoods(snapshot),
      }),
      restrictions: this.constraints(snapshot),
      communication: Object.freeze({
        style: behavioral
          ? this.fact(
              this.communicationLabel(behavioral.value.communicationStyle),
              behavioral.sources,
            )
          : null,
        coachingStyle: coachStyle
          ? this.fact(
              this.humanLabel(coachStyle.value.coachingStyle),
              coachStyle.sources,
            )
          : null,
        tone: coachStyle
          ? this.fact(
              this.humanLabel(coachStyle.value.tone),
              coachStyle.sources,
            )
          : null,
        motivation: behavioral
          ? this.fact(
              this.humanLabel(behavioral.value.motivationStyle),
              behavioral.sources,
            )
          : coachStyle
            ? this.fact(
                this.humanLabel(coachStyle.value.motivationStyle),
                coachStyle.sources,
              )
            : null,
        messagePreference: this.messagePreference(
          behavioral?.value.communicationStyle,
        ),
        journeyStage: this.map(snapshot.conversation.behavioralStage, (stage) =>
          this.humanLabel(stage),
        ),
      }),
      memory: this.memories(snapshot, input),
      continuity: this.continuity(input),
      progress: this.progress(snapshot),
      currentPlans: Object.freeze({
        diet: this.map(
          snapshot.plans.currentNutritionPlan ?? snapshot.plans.currentDiet,
          (plan) => plan.title.trim(),
        ),
        workout: this.map(snapshot.plans.currentWorkout, (plan) =>
          plan.title.trim(),
        ),
      }),
    });
  }

  private firstName(
    datum: CoachProfileDatum<string>,
  ): CoachConversationHumanFact<string> | null {
    const available = this.value(datum);
    if (!available) return null;
    const name = available.value.trim().split(/\s+/u)[0];
    return name ? this.fact(name, available.sources) : null;
  }

  private constraints(
    snapshot: CoachProfileSnapshot,
  ): CoachConversationHumanFact<readonly string[]> | null {
    const data = [
      snapshot.restrictions.foodRestrictions,
      snapshot.restrictions.allergies,
      snapshot.restrictions.medicalConditions,
      snapshot.restrictions.physicalLimitations,
    ].flatMap((datum) => {
      const available = this.value(datum);
      return available
        ? available.value.map((item) => ({
            description: item.description,
            sources: available.sources,
          }))
        : [];
    });
    const values = this.unique(
      data.map((item) => item.description),
      MAX_LIST_ITEMS,
    );
    const sources = [...new Set(data.flatMap((item) => item.sources))];
    return values.length > 0 ? this.fact(values, sources) : null;
  }

  private rejectedFoods(
    snapshot: CoachProfileSnapshot,
  ): CoachConversationHumanFact<readonly string[]> | null {
    const declared = snapshot.nutrition.declaredFoodRejections
      ? this.value(snapshot.nutrition.declaredFoodRejections)
      : undefined;
    const learned = this.value(snapshot.preferences.foodPreferences);
    const foods = this.unique(
      [
        ...(declared?.value ?? []),
        ...(learned?.value
          .filter((item) => this.preferenceKind(item) === 'REJECTED')
          .map((item) => item.foodName) ?? []),
      ],
      MAX_LIST_ITEMS,
    );
    const sources = [...(declared?.sources ?? []), ...(learned?.sources ?? [])];
    return foods.length > 0 ? this.fact(foods, sources) : null;
  }

  private foodPreferences(
    datum: CoachProfileDatum<readonly CoachProfileFoodPreference[]>,
    kind: 'PREFERRED' | 'REJECTED',
  ): CoachConversationHumanFact<readonly string[]> | null {
    const available = this.value(datum);
    if (!available) return null;
    const values = this.unique(
      available.value
        .filter((item) => this.preferenceKind(item) === kind)
        .map((item) => item.foodName),
      MAX_LIST_ITEMS,
    );
    return values.length > 0 ? this.fact(values, available.sources) : null;
  }

  private preferenceKind(
    preference: CoachProfileFoodPreference,
  ): 'PREFERRED' | 'REJECTED' {
    return /REJECT|DISLIKE|AVOID/iu.test(preference.kind)
      ? 'REJECTED'
      : 'PREFERRED';
  }

  private memories(
    snapshot: CoachProfileSnapshot,
    input: CoachConversationHumanContextBuildInput,
  ): readonly CoachConversationHumanMemory[] {
    const current = input.currentMessage?.trim() ?? '';
    const terms = this.terms(current);
    const profile = this.value(snapshot.conversation.memorySummaries);
    const profileMemories = (profile?.value ?? [])
      .map((summary) => summary.trim())
      .filter(
        (summary) =>
          summary &&
          summary.length <= MAX_MEMORY_LENGTH &&
          !TECHNICAL_MEMORY.test(summary) &&
          (terms.size === 0 ||
            CONTINUITY_CUE.test(current) ||
            [...this.terms(summary)].some((term) => terms.has(term))),
      )
      .map((summary) =>
        Object.freeze({
          summary,
          relation: 'PROFILE_MEMORY' as const,
        }),
      );
    const recent = this.recentConversationMemory(input);
    return Object.freeze(
      [...(recent ? [recent] : []), ...profileMemories].slice(0, MAX_MEMORIES),
    );
  }

  private recentConversationMemory(
    input: CoachConversationHumanContextBuildInput,
  ): CoachConversationHumanMemory | null {
    const current = input.currentMessage?.trim() ?? '';
    if (!CONTINUITY_CUE.test(current)) return null;
    const previous = [...(input.recentHistory ?? [])]
      .reverse()
      .find(
        (entry) =>
          entry.direction === 'INBOUND' &&
          entry.text.trim() &&
          !TECHNICAL_MEMORY.test(entry.text),
      );
    if (!previous) return null;
    return Object.freeze({
      summary: previous.text.trim().slice(0, MAX_MEMORY_LENGTH),
      relation: 'RECENT_CONVERSATION',
    });
  }

  private continuity(
    input: CoachConversationHumanContextBuildInput,
  ): CoachConversationHumanFact<string> | null {
    const memory = this.recentConversationMemory(input);
    return memory ? this.fact(memory.summary, ['CONVERSATION_MEMORY']) : null;
  }

  private progress(
    snapshot: CoachProfileSnapshot,
  ): CoachConversationHumanFact<string> | null {
    const goal = this.value(snapshot.longitudinal.goalProgression);
    if (goal) {
      const labels: Record<GoalProgressionState, string> = {
        [GoalProgressionState.IMPROVING]:
          'há sinais recentes de avanço no objetivo',
        [GoalProgressionState.STABLE]: 'o progresso recente está estável',
        [GoalProgressionState.DECLINING]:
          'o ritmo recente caiu e pede um próximo passo mais simples',
      };
      return this.fact(labels[goal.value.state], goal.sources);
    }
    const nutrition = this.value(snapshot.longitudinal.nutritionEvolution);
    if (!nutrition) return null;
    const labels: Record<LongitudinalDirection, string> = {
      [LongitudinalDirection.IMPROVING]:
        'as escolhas alimentares recentes estão evoluindo',
      [LongitudinalDirection.STABLE]:
        'as escolhas alimentares recentes estão estáveis',
      [LongitudinalDirection.DECLINING]:
        'as escolhas alimentares oscilaram nos últimos dias',
    };
    return this.fact(labels[nutrition.value.direction], nutrition.sources);
  }

  private goalLabel(goal: FitnessGoal): string {
    const labels: Record<FitnessGoal, string> = {
      [FitnessGoal.WEIGHT_LOSS]: 'emagrecimento',
      [FitnessGoal.MUSCLE_GAIN]: 'ganho de massa muscular',
      [FitnessGoal.MAINTENANCE]: 'manutenção e evolução física',
    };
    return labels[goal];
  }

  private communicationLabel(style: BehavioralCommunicationStyle): string {
    const labels: Record<BehavioralCommunicationStyle, string> = {
      [BehavioralCommunicationStyle.DIRECT]: 'direta e objetiva',
      [BehavioralCommunicationStyle.FRIENDLY]: 'próxima e acolhedora',
      [BehavioralCommunicationStyle.ANALYTICAL]: 'detalhada e analítica',
      [BehavioralCommunicationStyle.COACH]: 'orientadora',
      [BehavioralCommunicationStyle.MOTIVATIONAL]: 'motivadora e prática',
    };
    return labels[style];
  }

  private messagePreference(
    style: BehavioralCommunicationStyle | undefined,
  ): 'SHORT' | 'BALANCED' | 'DETAILED' {
    if (style === BehavioralCommunicationStyle.DIRECT) return 'SHORT';
    if (style === BehavioralCommunicationStyle.ANALYTICAL) return 'DETAILED';
    return 'BALANCED';
  }

  private humanLabel(value: string): string {
    return value.replaceAll('_', ' ').toLocaleLowerCase('pt-BR');
  }

  private text(
    datum: CoachProfileDatum<string>,
  ): CoachConversationHumanFact<string> | null {
    return this.map(datum, (value) => value.trim());
  }

  private list(
    datum: CoachProfileDatum<readonly string[]>,
  ): CoachConversationHumanFact<readonly string[]> | null {
    return this.map(datum, (value) => this.unique(value, MAX_LIST_ITEMS));
  }

  private available<T>(
    datum: CoachProfileDatum<T>,
  ): CoachConversationHumanFact<T> | null {
    const available = this.value(datum);
    return available ? this.fact(available.value, available.sources) : null;
  }

  private map<T, R>(
    datum: CoachProfileDatum<T>,
    mapper: (value: T) => R,
  ): CoachConversationHumanFact<R> | null {
    const available = this.value(datum);
    if (!available) return null;
    const value = mapper(available.value);
    if (typeof value === 'string' && !value) return null;
    if (Array.isArray(value) && value.length === 0) return null;
    return this.fact(value, available.sources);
  }

  private value<T>(datum: CoachProfileDatum<T>):
    | {
        readonly value: T;
        readonly sources: readonly CoachProfileDataSource[];
      }
    | undefined {
    return 'value' in datum
      ? { value: datum.value, sources: datum.sources }
      : undefined;
  }

  private fact<T>(
    value: T,
    sources: readonly CoachProfileDataSource[],
  ): CoachConversationHumanFact<T> {
    return Object.freeze({ value, sources: Object.freeze([...sources]) });
  }

  private unique(values: readonly string[], limit: number): readonly string[] {
    return Object.freeze(
      [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(
        0,
        limit,
      ),
    );
  }

  private terms(value: string): Set<string> {
    return new Set(
      value
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLocaleLowerCase('pt-BR')
        .split(/[^a-z0-9]+/u)
        .filter((term) => term.length >= 4),
    );
  }

  private turnCue(message: string | undefined): CoachConversationTurnCue {
    const value = (message ?? '')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('pt-BR')
      .trim();
    if (/^(?:oi|ola|bom dia|boa tarde|boa noite|e ai|opa)\b/u.test(value))
      return 'GREETING';
    if (/\b(?:obrigad|valeu|agradeco|gratid)\b/u.test(value)) return 'THANKS';
    if (/^(?:sim|certo|isso|exato|confirmo|pode ser|perfeito)\b/u.test(value))
      return 'AFFIRMATION';
    if (/^(?:nao|negativo|cancela|deixa)\b/u.test(value)) return 'NEGATION';
    if (/\b(?:tchau|ate mais|ate logo|boa noite|falou)\b/u.test(value))
      return 'FAREWELL';
    if (
      /\b(?:me ajuda|preciso de ajuda|o que voce faz|como pode ajudar)\b/u.test(
        value,
      )
    )
      return 'HELP_REQUEST';
    if (CONTINUITY_CUE.test(value)) return 'CONTINUITY';
    return 'COMMON';
  }
}
