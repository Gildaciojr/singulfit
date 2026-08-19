import { Injectable } from '@nestjs/common';
import {
  COACH_PROFILE_KNOWLEDGE_STATUS,
  CoachProfileDatum,
  CoachProfileSnapshot,
} from './coach-profile-snapshot.contract';
import {
  CoachAdaptiveProfileCollectorInput,
  PROFILE_ACQUISITION_FIELD,
  PROFILE_ACQUISITION_IMPORTANCE,
  PROFILE_ACQUISITION_INTENT,
  PROFILE_ACQUISITION_MODALITY,
  PROFILE_ACQUISITION_STATE,
  ProfileAcquisitionCandidate,
  ProfileAcquisitionConfirmationPolicy,
  ProfileAcquisitionDecision,
  ProfileAcquisitionDecisionReason,
  ProfileAcquisitionDependency,
  ProfileAcquisitionDomain,
  ProfileAcquisitionField,
  ProfileAcquisitionImportance,
  ProfileAcquisitionIntent,
  ProfileAcquisitionInteraction,
  ProfileAcquisitionModality,
  ProfileAcquisitionPlan,
  ProfileAcquisitionPlanReadiness,
  ProfileAcquisitionReason,
  ProfileAcquisitionState,
} from './coach-adaptive-profile-collector.contract';

export const PROFILE_ACQUISITION_COOLDOWN = Object.freeze({
  askedTurns: 3,
  declinedTurns: 8,
});

const UNKNOWN_ACQUISITION_DATUM: CoachProfileDatum<unknown> = Object.freeze({
  status: COACH_PROFILE_KNOWLEDGE_STATUS.UNKNOWN,
  sources: Object.freeze([]),
});

interface ProfileAcquisitionFieldDefinition {
  readonly field: ProfileAcquisitionField;
  readonly domain: ProfileAcquisitionDomain;
  readonly importance: ProfileAcquisitionImportance;
  readonly confirmationPolicy: ProfileAcquisitionConfirmationPolicy;
  readonly intents: readonly ProfileAcquisitionIntent[];
  readonly blocksPlans: readonly ProfileAcquisitionPlan[];
  readonly dependencies: readonly ProfileAcquisitionDependency[];
  readonly datum: (
    snapshot: CoachProfileSnapshot,
  ) => CoachProfileDatum<unknown>;
}

const DIET_INTENTS = Object.freeze([
  PROFILE_ACQUISITION_INTENT.DIET_PLAN_REQUEST,
  PROFILE_ACQUISITION_INTENT.COMBINED_PLAN_REQUEST,
]);
const WORKOUT_INTENTS = Object.freeze([
  PROFILE_ACQUISITION_INTENT.WORKOUT_PLAN_REQUEST,
  PROFILE_ACQUISITION_INTENT.COMBINED_PLAN_REQUEST,
]);
const NUTRITION_CONTEXTS = Object.freeze([
  ...DIET_INTENTS,
  PROFILE_ACQUISITION_INTENT.NUTRITION_CONVERSATION,
]);
const TRAINING_CONTEXTS = Object.freeze([
  ...WORKOUT_INTENTS,
  PROFILE_ACQUISITION_INTENT.TRAINING_CONVERSATION,
]);
const NO_INTENTS = Object.freeze([]) as readonly ProfileAcquisitionIntent[];
const NO_DEPENDENCIES = Object.freeze(
  [],
) as readonly ProfileAcquisitionDependency[];
const NO_PLANS = Object.freeze([]) as readonly ProfileAcquisitionPlan[];
const EQUIPMENT_MODALITIES = Object.freeze([
  PROFILE_ACQUISITION_MODALITY.GYM,
  PROFILE_ACQUISITION_MODALITY.HOME,
  PROFILE_ACQUISITION_MODALITY.CROSSFIT,
  PROFILE_ACQUISITION_MODALITY.CYCLING,
]);

function modalityDependency(): ProfileAcquisitionDependency {
  return Object.freeze({
    kind: 'MODALITY_MATCH' as const,
    modalities: EQUIPMENT_MODALITIES,
  });
}

const FIELD_DEFINITIONS: readonly ProfileAcquisitionFieldDefinition[] =
  Object.freeze([
    definition(
      PROFILE_ACQUISITION_FIELD.PRIMARY_GOAL,
      'GENERAL',
      PROFILE_ACQUISITION_IMPORTANCE.CRITICAL,
      'INFERENCE_ALLOWED',
      [...DIET_INTENTS, ...WORKOUT_INTENTS],
      ['DIET', 'WORKOUT'],
      (snapshot) => snapshot.nutrition.primaryGoal,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.TRAINING_MODALITY,
      'TRAINING',
      PROFILE_ACQUISITION_IMPORTANCE.CRITICAL,
      'EXPLICIT_CONFIRMATION_REQUIRED',
      WORKOUT_INTENTS,
      ['WORKOUT'],
      (snapshot) => snapshot.training.preferredModality,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.PHYSICAL_LIMITATIONS,
      'SAFETY',
      PROFILE_ACQUISITION_IMPORTANCE.CRITICAL,
      'EXPLICIT_CONFIRMATION_REQUIRED',
      WORKOUT_INTENTS,
      ['WORKOUT'],
      (snapshot) => snapshot.restrictions.physicalLimitations,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.TRAINING_EXPERIENCE,
      'TRAINING',
      PROFILE_ACQUISITION_IMPORTANCE.CRITICAL,
      'INFERENCE_ALLOWED',
      WORKOUT_INTENTS,
      ['WORKOUT'],
      (snapshot) => snapshot.training.experienceLevel,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.TRAINING_ENVIRONMENT,
      'TRAINING',
      PROFILE_ACQUISITION_IMPORTANCE.CRITICAL,
      'INFERENCE_ALLOWED',
      WORKOUT_INTENTS,
      ['WORKOUT'],
      (snapshot) => snapshot.training.environment,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.TRAINING_EQUIPMENT,
      'TRAINING',
      PROFILE_ACQUISITION_IMPORTANCE.CRITICAL,
      'EXPLICIT_CONFIRMATION_REQUIRED',
      WORKOUT_INTENTS,
      ['WORKOUT'],
      (snapshot) => snapshot.training.availableEquipment,
      [modalityDependency()],
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.TRAINING_FREQUENCY,
      'TRAINING',
      PROFILE_ACQUISITION_IMPORTANCE.CRITICAL,
      'INFERENCE_ALLOWED',
      WORKOUT_INTENTS,
      ['WORKOUT'],
      (snapshot) => snapshot.training.weeklyFrequency,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.SESSION_DURATION,
      'TRAINING',
      PROFILE_ACQUISITION_IMPORTANCE.CRITICAL,
      'INFERENCE_ALLOWED',
      WORKOUT_INTENTS,
      ['WORKOUT'],
      (snapshot) => snapshot.training.sessionDurationMinutes,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.FOOD_RESTRICTIONS,
      'SAFETY',
      PROFILE_ACQUISITION_IMPORTANCE.CRITICAL,
      'EXPLICIT_CONFIRMATION_REQUIRED',
      DIET_INTENTS,
      ['DIET'],
      (snapshot) => snapshot.restrictions.foodRestrictions,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.ALLERGIES,
      'SAFETY',
      PROFILE_ACQUISITION_IMPORTANCE.CRITICAL,
      'EXPLICIT_CONFIRMATION_REQUIRED',
      DIET_INTENTS,
      ['DIET'],
      (snapshot) => snapshot.restrictions.allergies,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.CURRENT_WEIGHT,
      'GENERAL',
      PROFILE_ACQUISITION_IMPORTANCE.CRITICAL,
      'EXPLICIT_CONFIRMATION_REQUIRED',
      DIET_INTENTS,
      ['DIET'],
      (snapshot) => snapshot.physical.currentWeightKg,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.HEIGHT,
      'GENERAL',
      PROFILE_ACQUISITION_IMPORTANCE.CRITICAL,
      'EXPLICIT_CONFIRMATION_REQUIRED',
      DIET_INTENTS,
      ['DIET'],
      (snapshot) => snapshot.physical.heightCm,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.ACTIVITY_LEVEL,
      'GENERAL',
      PROFILE_ACQUISITION_IMPORTANCE.CRITICAL,
      'INFERENCE_ALLOWED',
      [...DIET_INTENTS, ...WORKOUT_INTENTS],
      ['DIET', 'WORKOUT'],
      (snapshot) => snapshot.physical.activityLevel,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.MEAL_COUNT,
      'NUTRITION',
      PROFILE_ACQUISITION_IMPORTANCE.CRITICAL,
      'INFERENCE_ALLOWED',
      DIET_INTENTS,
      ['DIET'],
      (snapshot) => snapshot.nutrition.desiredMealCount,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.MEDICAL_CONDITIONS,
      'SAFETY',
      PROFILE_ACQUISITION_IMPORTANCE.IMPORTANT,
      'EXPLICIT_CONFIRMATION_REQUIRED',
      NUTRITION_CONTEXTS,
      NO_PLANS,
      (snapshot) => snapshot.restrictions.medicalConditions,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.FOOD_PREFERENCES,
      'NUTRITION',
      PROFILE_ACQUISITION_IMPORTANCE.IMPORTANT,
      'INFERENCE_ALLOWED',
      NUTRITION_CONTEXTS,
      NO_PLANS,
      (snapshot) => snapshot.preferences.foodPreferences,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.FOOD_INTOLERANCES,
      'SAFETY',
      PROFILE_ACQUISITION_IMPORTANCE.CRITICAL,
      'EXPLICIT_CONFIRMATION_REQUIRED',
      DIET_INTENTS,
      ['DIET'],
      (snapshot) =>
        snapshot.nutrition.foodIntolerances ?? UNKNOWN_ACQUISITION_DATUM,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.DECLARED_FOOD_PREFERENCES,
      'NUTRITION',
      PROFILE_ACQUISITION_IMPORTANCE.IMPORTANT,
      'INFERENCE_ALLOWED',
      DIET_INTENTS,
      ['DIET'],
      (snapshot) =>
        snapshot.nutrition.declaredFoodPreferences ?? UNKNOWN_ACQUISITION_DATUM,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.DECLARED_FOOD_REJECTIONS,
      'NUTRITION',
      PROFILE_ACQUISITION_IMPORTANCE.IMPORTANT,
      'INFERENCE_ALLOWED',
      DIET_INTENTS,
      ['DIET'],
      (snapshot) =>
        snapshot.nutrition.declaredFoodRejections ?? UNKNOWN_ACQUISITION_DATUM,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.DIETARY_PATTERN,
      'NUTRITION',
      PROFILE_ACQUISITION_IMPORTANCE.IMPORTANT,
      'INFERENCE_ALLOWED',
      DIET_INTENTS,
      NO_PLANS,
      (snapshot) => snapshot.nutrition.dietaryPattern,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.COOKING_AVAILABILITY,
      'NUTRITION',
      PROFILE_ACQUISITION_IMPORTANCE.IMPORTANT,
      'INFERENCE_ALLOWED',
      DIET_INTENTS,
      NO_PLANS,
      (snapshot) => snapshot.nutrition.cookingAvailability,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.MEALS_AWAY_FROM_HOME,
      'NUTRITION',
      PROFILE_ACQUISITION_IMPORTANCE.IMPORTANT,
      'INFERENCE_ALLOWED',
      DIET_INTENTS,
      NO_PLANS,
      (snapshot) => snapshot.nutrition.mealsAwayFromHome,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.EATING_OUT_FREQUENCY,
      'NUTRITION',
      PROFILE_ACQUISITION_IMPORTANCE.IMPORTANT,
      'INFERENCE_ALLOWED',
      DIET_INTENTS,
      ['DIET'],
      (snapshot) =>
        snapshot.nutrition.eatingOutFrequency ?? UNKNOWN_ACQUISITION_DATUM,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.FOOD_BUDGET,
      'NUTRITION',
      PROFILE_ACQUISITION_IMPORTANCE.IMPORTANT,
      'EXPLICIT_CONFIRMATION_REQUIRED',
      DIET_INTENTS,
      NO_PLANS,
      (snapshot) => snapshot.nutrition.foodBudget,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.MEAL_TIMES,
      'ROUTINE',
      PROFILE_ACQUISITION_IMPORTANCE.IMPORTANT,
      'INFERENCE_ALLOWED',
      DIET_INTENTS,
      NO_PLANS,
      (snapshot) => snapshot.routine.mealTimes,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.PERCEIVED_CONDITIONING,
      'TRAINING',
      PROFILE_ACQUISITION_IMPORTANCE.IMPORTANT,
      'EXPLICIT_CONFIRMATION_REQUIRED',
      TRAINING_CONTEXTS,
      NO_PLANS,
      (snapshot) => snapshot.training.perceivedConditioning,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.CARDIO_AVAILABILITY,
      'TRAINING',
      PROFILE_ACQUISITION_IMPORTANCE.IMPORTANT,
      'EXPLICIT_CONFIRMATION_REQUIRED',
      TRAINING_CONTEXTS,
      NO_PLANS,
      (snapshot) => snapshot.training.cardioAvailability,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.TRAINING_TIME,
      'ROUTINE',
      PROFILE_ACQUISITION_IMPORTANCE.IMPORTANT,
      'INFERENCE_ALLOWED',
      WORKOUT_INTENTS,
      NO_PLANS,
      (snapshot) => snapshot.routine.trainingTime,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.TARGET_WEIGHT,
      'GENERAL',
      PROFILE_ACQUISITION_IMPORTANCE.OPTIONAL,
      'EXPLICIT_CONFIRMATION_REQUIRED',
      DIET_INTENTS,
      NO_PLANS,
      (snapshot) => snapshot.physical.targetWeightKg,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.INTENSITY_PREFERENCE,
      'TRAINING',
      PROFILE_ACQUISITION_IMPORTANCE.OPTIONAL,
      'INFERENCE_ALLOWED',
      TRAINING_CONTEXTS,
      NO_PLANS,
      (snapshot) => snapshot.training.intensityPreference,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.TRAINING_FORMAT_PREFERENCE,
      'TRAINING',
      PROFILE_ACQUISITION_IMPORTANCE.OPTIONAL,
      'INFERENCE_ALLOWED',
      TRAINING_CONTEXTS,
      NO_PLANS,
      (snapshot) => snapshot.training.trainingFormatPreference,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.RETURNING_AFTER_BREAK,
      'SAFETY',
      PROFILE_ACQUISITION_IMPORTANCE.IMPORTANT,
      'EXPLICIT_CONFIRMATION_REQUIRED',
      WORKOUT_INTENTS,
      NO_PLANS,
      (snapshot) =>
        snapshot.training.returningAfterBreak ?? UNKNOWN_ACQUISITION_DATUM,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.AVAILABLE_TRAINING_DAYS,
      'ROUTINE',
      PROFILE_ACQUISITION_IMPORTANCE.IMPORTANT,
      'INFERENCE_ALLOWED',
      WORKOUT_INTENTS,
      NO_PLANS,
      (snapshot) =>
        snapshot.routine.availableTrainingDays ?? UNKNOWN_ACQUISITION_DATUM,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.DAILY_TRAINING_WINDOWS,
      'ROUTINE',
      PROFILE_ACQUISITION_IMPORTANCE.OPTIONAL,
      'INFERENCE_ALLOWED',
      WORKOUT_INTENTS,
      NO_PLANS,
      (snapshot) =>
        snapshot.routine.dailyTrainingWindows ?? UNKNOWN_ACQUISITION_DATUM,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.HYDRATION,
      'NUTRITION',
      PROFILE_ACQUISITION_IMPORTANCE.OPTIONAL,
      'INFERENCE_ALLOWED',
      NUTRITION_CONTEXTS,
      NO_PLANS,
      (snapshot) => snapshot.nutrition.hydration,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.WAKE_UP_TIME,
      'ROUTINE',
      PROFILE_ACQUISITION_IMPORTANCE.OPTIONAL,
      'INFERENCE_ALLOWED',
      [PROFILE_ACQUISITION_INTENT.COMBINED_PLAN_REQUEST],
      NO_PLANS,
      (snapshot) => snapshot.routine.wakeUpTime,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.SLEEP_TIME,
      'ROUTINE',
      PROFILE_ACQUISITION_IMPORTANCE.OPTIONAL,
      'INFERENCE_ALLOWED',
      [PROFILE_ACQUISITION_INTENT.COMBINED_PLAN_REQUEST],
      NO_PLANS,
      (snapshot) => snapshot.routine.sleepTime,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.SUPPLEMENTATION,
      'NUTRITION',
      PROFILE_ACQUISITION_IMPORTANCE.FUTURE,
      'EXPLICIT_CONFIRMATION_REQUIRED',
      NO_INTENTS,
      NO_PLANS,
      (snapshot) => snapshot.nutrition.supplementation,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.DISPLAY_NAME,
      'GENERAL',
      PROFILE_ACQUISITION_IMPORTANCE.FUTURE,
      'EXPLICIT_CONFIRMATION_REQUIRED',
      NO_INTENTS,
      NO_PLANS,
      (snapshot) => snapshot.identity.displayName,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.SEX,
      'GENERAL',
      PROFILE_ACQUISITION_IMPORTANCE.FUTURE,
      'EXPLICIT_CONFIRMATION_REQUIRED',
      NO_INTENTS,
      NO_PLANS,
      (snapshot) => snapshot.physical.sex,
    ),
    definition(
      PROFILE_ACQUISITION_FIELD.AGE,
      'GENERAL',
      PROFILE_ACQUISITION_IMPORTANCE.FUTURE,
      'INFERENCE_ALLOWED',
      NO_INTENTS,
      NO_PLANS,
      (snapshot) => snapshot.physical.ageYears,
    ),
  ]);

function definition(
  field: ProfileAcquisitionField,
  domain: ProfileAcquisitionDomain,
  importance: ProfileAcquisitionImportance,
  confirmationPolicy: ProfileAcquisitionConfirmationPolicy,
  intents: readonly ProfileAcquisitionIntent[],
  blocksPlans: readonly ProfileAcquisitionPlan[],
  datum: (snapshot: CoachProfileSnapshot) => CoachProfileDatum<unknown>,
  dependencies: readonly ProfileAcquisitionDependency[] = NO_DEPENDENCIES,
): ProfileAcquisitionFieldDefinition {
  return Object.freeze({
    field,
    domain,
    importance,
    confirmationPolicy,
    intents: Object.freeze([...intents]),
    blocksPlans: Object.freeze([...blocksPlans]),
    dependencies: Object.freeze([...dependencies]),
    datum,
  });
}

@Injectable()
export class CoachAdaptiveProfileCollectorService {
  decide(
    input: CoachAdaptiveProfileCollectorInput,
  ): ProfileAcquisitionDecision {
    this.validateHistory(input);
    const interactions = this.latestInteractions(input);
    const modality = this.resolveModality(
      input.snapshot,
      input.conversationContext.modality,
    );
    const candidates = FIELD_DEFINITIONS.map((field) =>
      this.candidate(field, input, interactions, modality),
    );
    const orderedCandidates = Object.freeze(
      candidates.sort((left, right) => this.compare(left, right, input.intent)),
    );
    const readiness = Object.freeze([
      this.readiness('DIET', input, interactions, modality),
      this.readiness('WORKOUT', input, interactions, modality),
    ]);
    const selectedCandidate =
      orderedCandidates.find(
        (candidate) =>
          candidate.blocksPlans.length > 0 &&
          (candidate.state === PROFILE_ACQUISITION_STATE.READY_TO_ASK ||
            candidate.state === PROFILE_ACQUISITION_STATE.WAITING_CONFIRMATION),
      ) ?? null;

    return Object.freeze({
      intent: input.intent,
      shouldAsk: selectedCandidate !== null,
      selectedCandidate,
      orderedCandidates,
      readiness,
      reason: this.decisionReason(
        input.intent,
        orderedCandidates,
        selectedCandidate,
      ),
    });
  }

  private candidate(
    definition: ProfileAcquisitionFieldDefinition,
    input: CoachAdaptiveProfileCollectorInput,
    interactions: ReadonlyMap<
      ProfileAcquisitionField,
      ProfileAcquisitionInteraction
    >,
    modality: ProfileAcquisitionModality | null,
  ): ProfileAcquisitionCandidate {
    const datum = definition.datum(input.snapshot);
    const contextualValue = this.contextualValue(
      definition.field,
      input.conversationContext,
    );
    const active = definition.intents.includes(input.intent);
    const interaction = interactions.get(definition.field);
    const dependencies = definition.dependencies;
    const dependencyNotApplicable = dependencies.some(
      (dependency) =>
        dependency.kind === 'MODALITY_MATCH' &&
        modality !== null &&
        !dependency.modalities.includes(modality),
    );
    const unmetDependencies = dependencyNotApplicable
      ? NO_DEPENDENCIES
      : Object.freeze(
          dependencies.filter(
            (dependency) =>
              !this.dependencySatisfied(
                dependency,
                input,
                interactions,
                modality,
              ),
          ),
        );
    const result = this.state({
      active: active && !dependencyNotApplicable,
      contextualValue,
      datum,
      definition,
      interaction,
      currentLogicalTurn: input.recentHistory.currentLogicalTurn,
      unmetDependencies,
    });

    return Object.freeze({
      field: definition.field,
      domain: definition.domain,
      importance: definition.importance,
      state: result.state,
      knowledgeStatus: datum.status,
      confirmationPolicy: definition.confirmationPolicy,
      dependencies,
      unmetDependencies,
      blocksPlans: this.blocksPlans(definition, input),
      reason: result.reason,
    });
  }

  private state(input: {
    readonly active: boolean;
    readonly contextualValue?: {
      readonly evidence: 'EXPLICIT' | 'INFERRED';
    };
    readonly datum: CoachProfileDatum<unknown>;
    readonly definition: ProfileAcquisitionFieldDefinition;
    readonly interaction?: ProfileAcquisitionInteraction;
    readonly currentLogicalTurn: number;
    readonly unmetDependencies: readonly ProfileAcquisitionDependency[];
  }): {
    readonly state: ProfileAcquisitionState;
    readonly reason: ProfileAcquisitionReason;
  } {
    if (input.contextualValue?.evidence === 'EXPLICIT') {
      return this.stateResult('ALREADY_KNOWN', 'CONTEXT_EXPLICIT_VALUE');
    }

    if (input.interaction?.outcome === 'ANSWERED') {
      return this.stateResult('ALREADY_KNOWN', 'ANSWERED_IN_HISTORY');
    }

    if (
      input.datum.status === COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN ||
      input.datum.status === COACH_PROFILE_KNOWLEDGE_STATUS.NOT_APPLICABLE
    ) {
      return this.stateResult('ALREADY_KNOWN', 'KNOWN_VALUE');
    }

    if (
      input.datum.status === COACH_PROFILE_KNOWLEDGE_STATUS.INFERRED &&
      input.definition.confirmationPolicy === 'INFERENCE_ALLOWED'
    ) {
      return this.stateResult('ALREADY_KNOWN', 'INFERRED_VALUE_ACCEPTED');
    }

    if (!input.active) {
      return this.stateResult('NOT_NEEDED', 'CONTEXT_NOT_RELEVANT');
    }

    if (
      input.interaction?.outcome === 'ASKED' &&
      input.currentLogicalTurn - input.interaction.logicalTurn <
        PROFILE_ACQUISITION_COOLDOWN.askedTurns
    ) {
      return this.stateResult('RECENTLY_ASKED', 'RECENTLY_ASKED_COOLDOWN');
    }

    if (
      input.interaction?.outcome === 'DECLINED' &&
      input.currentLogicalTurn - input.interaction.logicalTurn <
        PROFILE_ACQUISITION_COOLDOWN.declinedTurns
    ) {
      return this.stateResult('BLOCKED', 'RECENTLY_DECLINED_COOLDOWN');
    }

    if (input.unmetDependencies.length > 0) {
      return this.stateResult('WAITING_DEPENDENCY', 'DEPENDENCY_NOT_MET');
    }

    if (input.contextualValue?.evidence === 'INFERRED') {
      return this.stateResult(
        'WAITING_CONFIRMATION',
        'INFERRED_VALUE_REQUIRES_CONFIRMATION',
      );
    }

    if (
      input.datum.status === COACH_PROFILE_KNOWLEDGE_STATUS.INFERRED ||
      input.datum.status ===
        COACH_PROFILE_KNOWLEDGE_STATUS.REQUIRES_CONFIRMATION
    ) {
      return this.stateResult(
        'WAITING_CONFIRMATION',
        input.datum.status === COACH_PROFILE_KNOWLEDGE_STATUS.INFERRED
          ? 'INFERRED_VALUE_REQUIRES_CONFIRMATION'
          : 'CONFLICT_REQUIRES_CONFIRMATION',
      );
    }

    return this.stateResult('READY_TO_ASK', 'MISSING_CONTEXTUAL_FIELD');
  }

  private readiness(
    plan: ProfileAcquisitionPlan,
    input: CoachAdaptiveProfileCollectorInput,
    interactions: ReadonlyMap<
      ProfileAcquisitionField,
      ProfileAcquisitionInteraction
    >,
    modality: ProfileAcquisitionModality | null,
  ): ProfileAcquisitionPlanReadiness {
    const blockingFields = FIELD_DEFINITIONS.filter((definition) =>
      this.blocksPlans(definition, input).includes(plan),
    )
      .filter((definition) =>
        this.isApplicableForReadiness(definition, modality),
      )
      .filter(
        (definition) => !this.fieldAvailable(definition, input, interactions),
      )
      .map((definition) => definition.field);

    return Object.freeze({
      plan,
      ready: blockingFields.length === 0,
      blockingFields: Object.freeze(blockingFields),
    });
  }

  private fieldAvailable(
    definition: ProfileAcquisitionFieldDefinition,
    input: CoachAdaptiveProfileCollectorInput,
    interactions: ReadonlyMap<
      ProfileAcquisitionField,
      ProfileAcquisitionInteraction
    >,
  ): boolean {
    if (
      this.contextualValue(definition.field, input.conversationContext)
        ?.evidence === 'EXPLICIT'
    ) {
      return true;
    }

    if (interactions.get(definition.field)?.outcome === 'ANSWERED') return true;
    const datum = definition.datum(input.snapshot);

    return (
      datum.status === COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN ||
      datum.status === COACH_PROFILE_KNOWLEDGE_STATUS.NOT_APPLICABLE ||
      (datum.status === COACH_PROFILE_KNOWLEDGE_STATUS.INFERRED &&
        definition.confirmationPolicy === 'INFERENCE_ALLOWED')
    );
  }

  private blocksPlans(
    definition: ProfileAcquisitionFieldDefinition,
    input: CoachAdaptiveProfileCollectorInput,
  ): readonly ProfileAcquisitionPlan[] {
    if (
      definition.field === PROFILE_ACQUISITION_FIELD.AVAILABLE_TRAINING_DAYS &&
      input.conversationContext.requiresWorkoutCalendar
    ) {
      return Object.freeze(['WORKOUT']);
    }
    return definition.blocksPlans;
  }

  private dependencySatisfied(
    dependency: ProfileAcquisitionDependency,
    input: CoachAdaptiveProfileCollectorInput,
    interactions: ReadonlyMap<
      ProfileAcquisitionField,
      ProfileAcquisitionInteraction
    >,
    modality: ProfileAcquisitionModality | null,
  ): boolean {
    if (dependency.kind === 'MODALITY_MATCH') {
      return modality !== null && dependency.modalities.includes(modality);
    }

    const definition = FIELD_DEFINITIONS.find(
      (candidate) => candidate.field === dependency.field,
    );

    return definition
      ? this.fieldAvailable(definition, input, interactions)
      : false;
  }

  private isApplicableForReadiness(
    definition: ProfileAcquisitionFieldDefinition,
    modality: ProfileAcquisitionModality | null,
  ): boolean {
    const modalityRequirement = definition.dependencies.find(
      (dependency) => dependency.kind === 'MODALITY_MATCH',
    );

    return !modalityRequirement || modality === null
      ? !modalityRequirement
      : modalityRequirement.modalities.includes(modality);
  }

  private resolveModality(
    snapshot: CoachProfileSnapshot,
    contextual?: {
      readonly value: ProfileAcquisitionModality;
      readonly evidence: 'EXPLICIT' | 'INFERRED';
    },
  ): ProfileAcquisitionModality | null {
    if (contextual) return contextual.value;
    const datum = snapshot.training.preferredModality;

    if (!('value' in datum)) {
      return null;
    }

    const normalized = datum.value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '');

    if (/corrida|running/.test(normalized))
      return PROFILE_ACQUISITION_MODALITY.RUNNING;
    if (/crossfit/.test(normalized))
      return PROFILE_ACQUISITION_MODALITY.CROSSFIT;
    if (/bike|bicicleta|ciclismo|cycling/.test(normalized)) {
      return PROFILE_ACQUISITION_MODALITY.CYCLING;
    }
    if (/casa|home/.test(normalized)) return PROFILE_ACQUISITION_MODALITY.HOME;
    if (/academia|gym|musculacao/.test(normalized)) {
      return PROFILE_ACQUISITION_MODALITY.GYM;
    }

    return PROFILE_ACQUISITION_MODALITY.OTHER;
  }

  private contextualValue(
    field: ProfileAcquisitionField,
    context: CoachAdaptiveProfileCollectorInput['conversationContext'],
  ):
    | {
        readonly evidence: 'EXPLICIT' | 'INFERRED';
      }
    | undefined {
    switch (field) {
      case PROFILE_ACQUISITION_FIELD.TRAINING_MODALITY:
        return context.modality;
      case PROFILE_ACQUISITION_FIELD.TRAINING_EXPERIENCE:
        return context.experience;
      case PROFILE_ACQUISITION_FIELD.TRAINING_ENVIRONMENT:
        return context.environment;
      case PROFILE_ACQUISITION_FIELD.TRAINING_EQUIPMENT:
        return context.equipment;
      case PROFILE_ACQUISITION_FIELD.TRAINING_FREQUENCY:
        return context.weeklyFrequency;
      case PROFILE_ACQUISITION_FIELD.SESSION_DURATION:
        return context.sessionDurationMinutes;
      default:
        return undefined;
    }
  }

  private latestInteractions(
    input: CoachAdaptiveProfileCollectorInput,
  ): ReadonlyMap<ProfileAcquisitionField, ProfileAcquisitionInteraction> {
    const latest = new Map<
      ProfileAcquisitionField,
      ProfileAcquisitionInteraction
    >();

    for (const interaction of [
      ...input.memory.interactions,
      ...input.recentHistory.interactions,
    ]) {
      const current = latest.get(interaction.field);

      if (
        !current ||
        interaction.logicalTurn > current.logicalTurn ||
        (interaction.logicalTurn === current.logicalTurn &&
          this.outcomeOrder(interaction.outcome) >
            this.outcomeOrder(current.outcome))
      ) {
        latest.set(interaction.field, interaction);
      }
    }

    return latest;
  }

  private validateHistory(input: CoachAdaptiveProfileCollectorInput): void {
    if (
      !Number.isInteger(input.recentHistory.currentLogicalTurn) ||
      input.recentHistory.currentLogicalTurn < 0
    ) {
      throw new Error('Turno lógico de aquisição de perfil inválido');
    }

    for (const interaction of [
      ...input.memory.interactions,
      ...input.recentHistory.interactions,
    ]) {
      if (
        !Number.isInteger(interaction.logicalTurn) ||
        interaction.logicalTurn < 0 ||
        interaction.logicalTurn > input.recentHistory.currentLogicalTurn
      ) {
        throw new Error('Histórico lógico de aquisição de perfil inválido');
      }
    }
  }

  private compare(
    left: ProfileAcquisitionCandidate,
    right: ProfileAcquisitionCandidate,
    intent: ProfileAcquisitionIntent,
  ): number {
    const importance =
      this.importanceOrder(left.importance) -
      this.importanceOrder(right.importance);
    if (importance !== 0) return importance;

    const contextual =
      this.contextOrder(left.field, intent) -
      this.contextOrder(right.field, intent);
    if (contextual !== 0) return contextual;

    return left.field.localeCompare(right.field, 'en');
  }

  private contextOrder(
    field: ProfileAcquisitionField,
    intent: ProfileAcquisitionIntent,
  ): number {
    const diet = [
      PROFILE_ACQUISITION_FIELD.PRIMARY_GOAL,
      PROFILE_ACQUISITION_FIELD.FOOD_RESTRICTIONS,
      PROFILE_ACQUISITION_FIELD.ALLERGIES,
      PROFILE_ACQUISITION_FIELD.CURRENT_WEIGHT,
      PROFILE_ACQUISITION_FIELD.HEIGHT,
      PROFILE_ACQUISITION_FIELD.ACTIVITY_LEVEL,
      PROFILE_ACQUISITION_FIELD.MEAL_COUNT,
    ];
    const workout = [
      PROFILE_ACQUISITION_FIELD.PRIMARY_GOAL,
      PROFILE_ACQUISITION_FIELD.TRAINING_MODALITY,
      PROFILE_ACQUISITION_FIELD.PHYSICAL_LIMITATIONS,
      PROFILE_ACQUISITION_FIELD.TRAINING_EXPERIENCE,
      PROFILE_ACQUISITION_FIELD.TRAINING_ENVIRONMENT,
      PROFILE_ACQUISITION_FIELD.TRAINING_EQUIPMENT,
      PROFILE_ACQUISITION_FIELD.TRAINING_FREQUENCY,
      PROFILE_ACQUISITION_FIELD.SESSION_DURATION,
      PROFILE_ACQUISITION_FIELD.ACTIVITY_LEVEL,
    ];
    const order: readonly ProfileAcquisitionField[] =
      intent === PROFILE_ACQUISITION_INTENT.DIET_PLAN_REQUEST ? diet : workout;
    const index = order.indexOf(field);

    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  }

  private importanceOrder(importance: ProfileAcquisitionImportance): number {
    switch (importance) {
      case PROFILE_ACQUISITION_IMPORTANCE.CRITICAL:
        return 0;
      case PROFILE_ACQUISITION_IMPORTANCE.IMPORTANT:
        return 1;
      case PROFILE_ACQUISITION_IMPORTANCE.OPTIONAL:
        return 2;
      default:
        return 3;
    }
  }

  private outcomeOrder(
    outcome: ProfileAcquisitionInteraction['outcome'],
  ): number {
    switch (outcome) {
      case 'ANSWERED':
        return 3;
      case 'DECLINED':
        return 2;
      default:
        return 1;
    }
  }

  private decisionReason(
    intent: ProfileAcquisitionIntent,
    candidates: readonly ProfileAcquisitionCandidate[],
    selected: ProfileAcquisitionCandidate | null,
  ): ProfileAcquisitionDecisionReason {
    if (selected) return 'FIELD_SELECTED';
    if (
      intent !== PROFILE_ACQUISITION_INTENT.DIET_PLAN_REQUEST &&
      intent !== PROFILE_ACQUISITION_INTENT.WORKOUT_PLAN_REQUEST &&
      intent !== PROFILE_ACQUISITION_INTENT.COMBINED_PLAN_REQUEST
    ) {
      return 'NO_CONTEXTUAL_ACQUISITION';
    }
    if (
      candidates.some(
        (candidate) =>
          candidate.state === PROFILE_ACQUISITION_STATE.RECENTLY_ASKED ||
          candidate.state === PROFILE_ACQUISITION_STATE.BLOCKED,
      )
    ) {
      return 'COOLDOWN_ACTIVE';
    }
    if (
      candidates.some(
        (candidate) =>
          candidate.state === PROFILE_ACQUISITION_STATE.WAITING_DEPENDENCY,
      )
    ) {
      return 'DEPENDENCIES_PENDING';
    }

    return 'PROFILE_READY';
  }

  private stateResult(
    state: ProfileAcquisitionState,
    reason: ProfileAcquisitionReason,
  ): {
    readonly state: ProfileAcquisitionState;
    readonly reason: ProfileAcquisitionReason;
  } {
    return Object.freeze({ state, reason });
  }
}
