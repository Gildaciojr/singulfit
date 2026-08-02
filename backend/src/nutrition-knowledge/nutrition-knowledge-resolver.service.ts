import { Injectable } from '@nestjs/common';
import { FoodPreferenceKind } from '@prisma/client';
import type {
  CoachProfileConstraint,
  CoachProfileDatum,
  CoachProfileSnapshot,
} from '../context/coach-profile-snapshot.contract';
import { NUTRITION_KNOWLEDGE_PACKAGES } from './nutrition-knowledge.catalog';
import {
  NUTRITION_KNOWLEDGE_CATALOG_VERSION,
  NUTRITION_KNOWLEDGE_PACKAGE_ID,
  NUTRITION_KNOWLEDGE_SCHEMA_VERSION,
  type NutritionKnowledgeApplicability,
  type NutritionKnowledgeBooleanFact,
  type NutritionKnowledgeCondition,
  type NutritionKnowledgeMatchedFact,
  type NutritionKnowledgeNumberFact,
  type NutritionKnowledgePackage,
  type NutritionKnowledgePackageId,
  type NutritionKnowledgePriority,
  type NutritionKnowledgeResolution,
  type NutritionKnowledgeStringFact,
} from './nutrition-knowledge.contract';

interface NutritionKnowledgeSignals {
  readonly primaryGoal: CoachProfileSnapshot['nutrition']['primaryGoal'];
  readonly strings: Readonly<
    Record<NutritionKnowledgeStringFact, readonly string[]>
  >;
  readonly booleans: Readonly<Record<NutritionKnowledgeBooleanFact, boolean>>;
  readonly numbers: Readonly<
    Record<NutritionKnowledgeNumberFact, number | undefined>
  >;
}

const PRIORITY_ORDER: Readonly<Record<NutritionKnowledgePriority, number>> =
  Object.freeze({
    CRITICAL: 4,
    HIGH: 3,
    STANDARD: 2,
    SUPPORTING: 1,
  });

@Injectable()
export class NutritionKnowledgeResolverService {
  private readonly packageById = new Map<
    NutritionKnowledgePackageId,
    NutritionKnowledgePackage
  >(NUTRITION_KNOWLEDGE_PACKAGES.map((item) => [item.id, item]));

  constructor() {
    this.assertCatalogIntegrity();
  }

  resolve(snapshot: CoachProfileSnapshot): NutritionKnowledgeResolution {
    const signals = this.signals(snapshot);
    const directlyApplicable = NUTRITION_KNOWLEDGE_PACKAGES.filter(
      (knowledgePackage) => this.applies(knowledgePackage, signals),
    ).sort((left, right) => this.comparePackages(left, right));

    const selected: NutritionKnowledgePackage[] = [];
    const selectedIds = new Set<NutritionKnowledgePackageId>();
    const matchedFacts = new Map<
      NutritionKnowledgePackageId,
      readonly NutritionKnowledgeMatchedFact['facts'][number][]
    >();

    for (const knowledgePackage of directlyApplicable) {
      if (this.conflictsWithSelected(knowledgePackage, selectedIds)) continue;
      selected.push(knowledgePackage);
      selectedIds.add(knowledgePackage.id);
      matchedFacts.set(
        knowledgePackage.id,
        this.matchedFactNames(knowledgePackage.whenToApply, signals),
      );
    }

    for (let index = 0; index < selected.length; index += 1) {
      const knowledgePackage = selected[index];
      for (const dependencyId of knowledgePackage.dependencyPackageIds) {
        if (selectedIds.has(dependencyId)) continue;
        const dependency = this.packageById.get(dependencyId);
        if (!dependency) {
          throw new Error(
            `Pacote nutricional dependente não encontrado: ${dependencyId}`,
          );
        }
        selected.push(dependency);
        selectedIds.add(dependency.id);
        matchedFacts.set(dependency.id, Object.freeze([]));
      }
    }

    selected.sort((left, right) => this.comparePackages(left, right));
    const frozenPackages = Object.freeze([...selected]);
    const frozenMatchedFacts = Object.freeze(
      selected.map((knowledgePackage) =>
        Object.freeze({
          packageId: knowledgePackage.id,
          facts: Object.freeze(
            [...(matchedFacts.get(knowledgePackage.id) ?? [])].sort(),
          ),
        }),
      ),
    );
    const safetyRestricted =
      selectedIds.has(
        NUTRITION_KNOWLEDGE_PACKAGE_ID.CLINICAL_SAFETY_BOUNDARY,
      ) ||
      selectedIds.has(
        NUTRITION_KNOWLEDGE_PACKAGE_ID.SPECIAL_POPULATION_BOUNDARY,
      );

    return Object.freeze({
      schemaVersion: NUTRITION_KNOWLEDGE_SCHEMA_VERSION,
      catalogVersion: NUTRITION_KNOWLEDGE_CATALOG_VERSION,
      packages: frozenPackages,
      packageIds: Object.freeze(
        frozenPackages.map((knowledgePackage) => knowledgePackage.id),
      ),
      matchedFacts: frozenMatchedFacts,
      safetyRestricted,
    });
  }

  private applies(
    knowledgePackage: NutritionKnowledgePackage,
    signals: NutritionKnowledgeSignals,
  ): boolean {
    return (
      this.matches(knowledgePackage.whenToApply, signals) &&
      !this.matches(knowledgePackage.whenNotToApply, signals)
    );
  }

  private matches(
    applicability: NutritionKnowledgeApplicability,
    signals: NutritionKnowledgeSignals,
  ): boolean {
    const results = applicability.conditions.map((condition) =>
      this.matchesCondition(condition, signals),
    );
    return applicability.match === 'ALL'
      ? results.every(Boolean)
      : results.some(Boolean);
  }

  private matchesCondition(
    condition: NutritionKnowledgeCondition,
    signals: NutritionKnowledgeSignals,
  ): boolean {
    if (condition.fact === 'ALWAYS') return true;
    if (condition.fact === 'PRIMARY_GOAL') {
      return (
        'value' in signals.primaryGoal &&
        signals.primaryGoal.value === condition.value
      );
    }
    if (condition.operator === 'IS') {
      return signals.booleans[condition.fact] === condition.value;
    }
    if (condition.operator === 'CONTAINS_ANY') {
      const values = signals.strings[condition.fact];
      return values.some((actual) =>
        condition.values.some((expected) =>
          actual.includes(this.normalize(expected)),
        ),
      );
    }
    const actual = signals.numbers[condition.fact];
    if (actual === undefined) return false;
    return condition.operator === 'GREATER_THAN_OR_EQUAL'
      ? actual >= condition.value
      : actual <= condition.value;
  }

  private matchedFactNames(
    applicability: NutritionKnowledgeApplicability,
    signals: NutritionKnowledgeSignals,
  ): readonly NutritionKnowledgeMatchedFact['facts'][number][] {
    return Object.freeze(
      [
        ...new Set(
          applicability.conditions
            .filter((condition) => this.matchesCondition(condition, signals))
            .map((condition) => condition.fact),
        ),
      ].sort(),
    );
  }

  private signals(snapshot: CoachProfileSnapshot): NutritionKnowledgeSignals {
    const foodConstraints = this.constraints(snapshot);
    const medicalConditions = this.datumValues(
      snapshot.restrictions.medicalConditions,
    );
    const normalizedFoodConstraints = foodConstraints
      .flatMap((constraint) => [constraint.type ?? '', constraint.description])
      .map((value) => this.normalize(value))
      .filter(Boolean);
    const normalizedMedicalConditions = medicalConditions
      .flatMap((condition) => [condition.type ?? '', condition.description])
      .map((value) => this.normalize(value))
      .filter(Boolean);
    const allSafetyText = [
      ...normalizedFoodConstraints,
      ...normalizedMedicalConditions,
    ];
    const age = this.datumValue(snapshot.physical.ageYears);
    const isAdolescent = typeof age === 'number' && age < 18;
    const isOlderAdult = typeof age === 'number' && age >= 65;
    const isPregnant = this.containsAny(normalizedMedicalConditions, [
      'GESTANTE',
      'GESTACAO',
      'GRAVIDEZ',
      'PREGNANCY',
    ]);
    const specialPopulation = isAdolescent || isOlderAdult || isPregnant;
    const preferences = this.datumValues(snapshot.preferences.foodPreferences);
    const dietaryPattern = this.datumValue(snapshot.nutrition.dietaryPattern);
    const patternIsRestrictive =
      typeof dietaryPattern === 'string' &&
      !['', 'OMNIVORE', 'ONIVORO', 'ONIVORA'].includes(
        this.normalize(dietaryPattern),
      );
    const experience = this.normalizedDatum(snapshot.training.experienceLevel);
    const adherence = this.datumValue(snapshot.longitudinal.adherenceScore);
    const cookingAvailability = this.normalizedDatum(
      snapshot.nutrition.cookingAvailability,
    );
    const eatingOutFrequency = this.normalizedOptionalDatum(
      snapshot.nutrition.eatingOutFrequency,
    );
    const budget = this.normalizedDatum(snapshot.nutrition.foodBudget);
    const hydration = this.normalizedDatum(snapshot.nutrition.hydration);
    const restrictionCount = foodConstraints.length;

    return Object.freeze({
      primaryGoal: snapshot.nutrition.primaryGoal,
      strings: Object.freeze({
        TRAINING_MODALITY: this.normalizedDatum(
          snapshot.training.preferredModality,
        ),
        DIETARY_PATTERN: this.normalizedDatum(
          snapshot.nutrition.dietaryPattern,
        ),
        FOOD_CONSTRAINT: Object.freeze(allSafetyText),
        FOOD_BUDGET: budget,
        COOKING_AVAILABILITY: cookingAvailability,
        EATING_OUT_FREQUENCY: eatingOutFrequency,
        HYDRATION: hydration,
        EXPERIENCE_LEVEL: experience,
        DESIRED_OUTCOME: this.normalizedDatum(
          snapshot.nutrition.desiredOutcome,
        ),
        TRAINING_TIME: this.normalizedDatum(snapshot.routine.trainingTime),
        MEAL_TIMING_PATTERN: Object.freeze(
          this.datumValues(snapshot.routine.mealTimes).map((value) =>
            this.normalize(value),
          ),
        ),
        ACTIVITY_LEVEL: this.normalizedValue(
          this.datumValue(snapshot.physical.activityLevel),
        ),
        MEDICAL_CONTEXT: Object.freeze(normalizedMedicalConditions),
        TRAINING_INTENSITY: this.normalizedDatum(
          snapshot.training.intensityPreference,
        ),
      }),
      booleans: Object.freeze({
        HAS_FOOD_CONSTRAINTS:
          foodConstraints.length > 0 || patternIsRestrictive,
        HAS_FOOD_PREFERENCES: preferences.some(
          (preference) =>
            preference.kind === FoodPreferenceKind.ACCEPTED ||
            preference.kind === FoodPreferenceKind.FREQUENT,
        ),
        HAS_FOOD_REJECTIONS: preferences.some(
          (preference) =>
            preference.kind === FoodPreferenceKind.AVOIDED ||
            preference.kind === FoodPreferenceKind.REJECTED,
        ),
        HAS_MEAL_TIMES: this.datumValues(snapshot.routine.mealTimes).length > 0,
        HAS_TRAINING_TIME:
          typeof this.datumValue(snapshot.routine.trainingTime) === 'string',
        MEALS_AWAY_FROM_HOME:
          this.datumValue(snapshot.nutrition.mealsAwayFromHome) === true,
        HAS_ADHERENCE_CONTEXT:
          this.datumValue(snapshot.longitudinal.adherenceScore) !== undefined ||
          this.datumValue(snapshot.conversation.behavioralStage) !== undefined,
        HAS_MEDICAL_CONTEXT: medicalConditions.length > 0,
        IS_SPECIAL_POPULATION: specialPopulation,
        HAS_MULTIPLE_RESTRICTIONS: restrictionCount >= 2,
        IS_BEGINNER: this.containsAny(experience, [
          'BEGINNER',
          'INICIANTE',
          'NOVATO',
        ]),
        IS_INTERMEDIATE: this.containsAny(experience, [
          'INTERMEDIATE',
          'INTERMEDIARIO',
          'INTERMEDIARIA',
        ]),
        IS_ADVANCED: this.containsAny(experience, [
          'ADVANCED',
          'AVANCADO',
          'AVANCADA',
        ]),
        IS_ADOLESCENT: isAdolescent,
        IS_OLDER_ADULT: isOlderAdult,
        IS_PREGNANT: isPregnant,
        HAS_DIABETES_CONTEXT: this.containsAny(normalizedMedicalConditions, [
          'DIABETES',
          'DIABETICO',
          'DIABETICA',
        ]),
        HAS_HYPERTENSION_CONTEXT: this.containsAny(
          normalizedMedicalConditions,
          ['HIPERTENSAO', 'HIPERTENSO', 'HIPERTENSA', 'HIGH BLOOD PRESSURE'],
        ),
        HAS_RENAL_CONTEXT: this.containsAny(normalizedMedicalConditions, [
          'RENAL',
          'RIM',
          'RINS',
          'KIDNEY',
        ]),
        HAS_HEPATIC_CONTEXT: this.containsAny(normalizedMedicalConditions, [
          'HEPATIC',
          'FIGADO',
          'LIVER',
        ]),
        HAS_SEVERE_OBESITY_CONTEXT: this.containsAny(
          normalizedMedicalConditions,
          [
            'OBESIDADE GRAVE',
            'OBESIDADE SEVERA',
            'OBESIDADE MORBIDA',
            'SEVERE OBESITY',
            'MORBID OBESITY',
          ],
        ),
        HAS_LOW_ADHERENCE: typeof adherence === 'number' && adherence < 60,
        HAS_HIGH_ADHERENCE: typeof adherence === 'number' && adherence >= 80,
        HAS_LIMITED_COOKING_TIME: this.containsAny(cookingAvailability, [
          'LOW',
          'LIMITED',
          'POUCO',
          'BAIXA',
          'SEM TEMPO',
        ]),
        EATS_OUT_FREQUENTLY:
          this.datumValue(snapshot.nutrition.mealsAwayFromHome) === true ||
          this.containsAny(eatingOutFrequency, [
            'FREQUENT',
            'FREQUENTE',
            'OFTEN',
            'ALTA',
          ]),
        HAS_LOW_BUDGET: this.containsAny(budget, ['LOW', 'BAIXO', 'BAIXA']),
        HAS_INADEQUATE_HYDRATION: this.containsAny(hydration, [
          'LOW',
          'BAIXA',
          'INADEQUATE',
          'INADEQUADA',
          'INSUFFICIENT',
          'INSUFICIENTE',
        ]),
        HAS_ADEQUATE_HYDRATION: this.containsAny(hydration, [
          'ADEQUATE',
          'ADEQUADA',
          'GOOD',
          'BOA',
        ]),
      }),
      numbers: Object.freeze({
        SESSION_DURATION_MINUTES: this.datumValue(
          snapshot.training.sessionDurationMinutes,
        ),
      }),
    });
  }

  private constraints(
    snapshot: CoachProfileSnapshot,
  ): readonly CoachProfileConstraint[] {
    return Object.freeze([
      ...this.datumValues(snapshot.restrictions.foodRestrictions),
      ...this.datumValues(snapshot.restrictions.allergies),
      ...this.datumValues(snapshot.nutrition.foodIntolerances),
    ]);
  }

  private normalizedDatum(datum: CoachProfileDatum<string>): readonly string[] {
    const value = this.datumValue(datum);
    return typeof value === 'string' && value.trim()
      ? Object.freeze([this.normalize(value)])
      : Object.freeze([]);
  }

  private normalizedOptionalDatum(
    datum: CoachProfileDatum<string> | undefined,
  ): readonly string[] {
    return datum ? this.normalizedDatum(datum) : Object.freeze([]);
  }

  private normalizedValue(value: string | undefined): readonly string[] {
    return typeof value === 'string' && value.trim()
      ? Object.freeze([this.normalize(value)])
      : Object.freeze([]);
  }

  private containsAny(
    values: readonly string[],
    tokens: readonly string[],
  ): boolean {
    return values.some((value) =>
      tokens.some((token) => value.includes(this.normalize(token))),
    );
  }

  private datumValue<T>(datum: CoachProfileDatum<T>): T | undefined {
    return 'value' in datum ? datum.value : undefined;
  }

  private datumValues<T>(
    datum: CoachProfileDatum<readonly T[]> | undefined,
  ): readonly T[] {
    return datum && 'value' in datum ? datum.value : Object.freeze([]);
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, ' ')
      .trim()
      .toUpperCase();
  }

  private conflictsWithSelected(
    knowledgePackage: NutritionKnowledgePackage,
    selectedIds: ReadonlySet<NutritionKnowledgePackageId>,
  ): boolean {
    return knowledgePackage.conflictingPackageIds.some((id) =>
      selectedIds.has(id),
    );
  }

  private comparePackages(
    left: NutritionKnowledgePackage,
    right: NutritionKnowledgePackage,
  ): number {
    return (
      PRIORITY_ORDER[right.priority] - PRIORITY_ORDER[left.priority] ||
      left.id.localeCompare(right.id)
    );
  }

  private assertCatalogIntegrity(): void {
    if (this.packageById.size !== NUTRITION_KNOWLEDGE_PACKAGES.length) {
      throw new Error('Catálogo nutricional possui IDs duplicados');
    }
    for (const knowledgePackage of NUTRITION_KNOWLEDGE_PACKAGES) {
      for (const referenceId of [
        ...knowledgePackage.dependencyPackageIds,
        ...knowledgePackage.conflictingPackageIds,
      ]) {
        if (!this.packageById.has(referenceId)) {
          throw new Error(
            `Referência inválida no pacote ${knowledgePackage.id}: ${referenceId}`,
          );
        }
      }
      if (knowledgePackage.dependencyPackageIds.includes(knowledgePackage.id)) {
        throw new Error(
          `Pacote nutricional depende de si mesmo: ${knowledgePackage.id}`,
        );
      }
    }
  }
}
