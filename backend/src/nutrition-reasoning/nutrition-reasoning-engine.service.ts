import { Injectable } from '@nestjs/common';
import { CONVERSATION_GOAL } from '../context/conversation-goal-planner.contract';
import { NUTRITION_ARTIFACT_TYPE } from '../diet/v2/nutrition-planning-artifact.contract';
import { NUTRITION_KNOWLEDGE_PACKAGES } from '../nutrition-knowledge/nutrition-knowledge.catalog';
import {
  NUTRITION_KNOWLEDGE_DOMAIN,
  NUTRITION_KNOWLEDGE_PACKAGE_ID,
  type NutritionKnowledgePackage,
  type NutritionKnowledgePackageId,
  type NutritionKnowledgePriority,
} from '../nutrition-knowledge/nutrition-knowledge.contract';
import {
  NUTRITION_REASONING_CONFLICT,
  NUTRITION_REASONING_OBJECTIVE,
  NUTRITION_REASONING_PRIORITY,
  NUTRITION_REASONING_SCHEMA_VERSION,
  NUTRITION_REASONING_STRATEGY,
  NUTRITION_REASONING_STRATEGY_VERSION,
  type NutritionAppliedRestriction,
  type NutritionDiscardedFactor,
  type NutritionKnowledgePackageDecision,
  type NutritionPersonalizationLevel,
  type NutritionPrioritizedObjective,
  type NutritionProhibitedStrategy,
  type NutritionReasoningConflict,
  type NutritionReasoningFactorDecision,
  type NutritionReasoningInput,
  type NutritionReasoningObjective,
  type NutritionReasoningPriority,
  type NutritionReasoningPriorityProfile,
  type NutritionReasoningReasonCode,
  type NutritionReasoningResult,
  type NutritionReasoningStrategy,
  type NutritionRecommendedComplexity,
  type NutritionResolvedConflict,
  type NutritionSelectedStrategy,
} from './nutrition-reasoning.contract';

interface ReasoningContext {
  readonly packageIds: ReadonlySet<NutritionKnowledgePackageId>;
  readonly lowAdherence: boolean;
  readonly highAdherence: boolean;
  readonly lowBudget: boolean;
  readonly highBudget: boolean;
  readonly limitedCookingTime: boolean;
  readonly mealsAwayFromHome: boolean;
  readonly inadequateHydration: boolean;
  readonly sportsContext: boolean;
  readonly manyRestrictions: boolean;
  readonly restrictionCount: number;
  readonly generalGuidance: boolean;
  readonly safetyRestricted: boolean;
  readonly detailedArtifact: boolean;
  readonly profileSignalCount: number;
}

interface FactorStrategyPolicy {
  readonly factorCodes: ReadonlySet<string>;
  readonly strategy: NutritionReasoningStrategy;
  readonly polarity: 'POSITIVE' | 'NEGATIVE';
}

interface StrategyObjectivePolicy {
  readonly strategies: ReadonlySet<NutritionReasoningStrategy>;
  readonly objective: NutritionReasoningObjective;
}

interface StrategyAccumulator {
  readonly strategy: NutritionReasoningStrategy;
  priority: Exclude<NutritionReasoningPriority, 'IGNORED'>;
  readonly sourcePackageIds: Set<NutritionKnowledgePackageId>;
  readonly reasonCodes: Set<NutritionReasoningReasonCode>;
}

interface ObjectiveAccumulator {
  readonly objective: NutritionReasoningObjective;
  priority: Exclude<NutritionReasoningPriority, 'IGNORED'>;
  readonly sourcePackageIds: Set<NutritionKnowledgePackageId>;
  readonly reasonCodes: Set<NutritionReasoningReasonCode>;
}

interface PackagePriorityOverride {
  readonly priority: Exclude<NutritionReasoningPriority, 'IGNORED'>;
  readonly disposition: Extract<
    NutritionKnowledgePackageDecision['disposition'],
    'ELEVATED' | 'REDUCED'
  >;
  readonly reasonCodes: readonly NutritionReasoningReasonCode[];
}

const P = NUTRITION_KNOWLEDGE_PACKAGE_ID;
const S = NUTRITION_REASONING_STRATEGY;
const O = NUTRITION_REASONING_OBJECTIVE;
const R = NUTRITION_REASONING_PRIORITY;

const KNOWLEDGE_PRIORITY: Readonly<
  Record<NutritionKnowledgePriority, NutritionReasoningPriority>
> = Object.freeze({
  CRITICAL: R.CRITICAL,
  HIGH: R.HIGH,
  STANDARD: R.MEDIUM,
  SUPPORTING: R.LOW,
});

const PRIORITY_ORDER: Readonly<Record<NutritionReasoningPriority, number>> =
  Object.freeze({
    CRITICAL: 5,
    HIGH: 4,
    MEDIUM: 3,
    LOW: 2,
    IGNORED: 1,
  });

const OBJECTIVE_ORDER: Readonly<Record<NutritionReasoningObjective, number>> =
  Object.freeze({
    SAFETY: 1,
    WEIGHT_REDUCTION: 2,
    MUSCLE_DEVELOPMENT: 2,
    WEIGHT_MAINTENANCE: 2,
    ADHERENCE: 3,
    PERFORMANCE: 4,
    RECOVERY: 5,
    SATIETY: 6,
    PRACTICALITY: 7,
    ECONOMY: 8,
    NUTRITION_EDUCATION: 9,
  });

const BASE_PACKAGES = new Set<NutritionKnowledgePackageId>([
  P.HEALTHY_EATING_FOUNDATION,
  P.NUTRITION_EDUCATION_FOUNDATION,
  P.HYDRATION,
  P.MEAL_TIMING,
  P.PRE_WORKOUT_NUTRITION,
  P.POST_WORKOUT_RECOVERY,
  P.PROTEIN_DISTRIBUTION_EDUCATION,
]);

const LEGACY_POLICY_PACKAGE_IDS = new Set<NutritionKnowledgePackageId>([
  P.HEALTHY_EATING_FOUNDATION,
  P.NUTRITION_EDUCATION_FOUNDATION,
  P.WEIGHT_LOSS,
  P.HYPERTROPHY,
  P.MAINTENANCE,
  P.SPORTS_NUTRITION_FOUNDATION,
  P.RUNNING,
  P.CROSSFIT,
  P.CYCLING,
  P.VEGETARIAN,
  P.VEGAN,
  P.LACTOSE_INTOLERANCE,
  P.GLUTEN_RESTRICTION,
  P.FOOD_RESTRICTION_SAFETY,
  P.FOOD_SUBSTITUTION,
  P.BUDGET_LOW,
  P.BUDGET_MEDIUM,
  P.BUDGET_HIGH,
  P.LIMITED_COOKING_TIME,
  P.MEALS_AWAY_FROM_HOME,
  P.MEAL_TIMING,
  P.HYDRATION,
  P.FOOD_PREFERENCES,
  P.FOOD_REJECTIONS,
  P.BEHAVIOR_ADHERENCE,
  P.CLINICAL_SAFETY_BOUNDARY,
  P.SPECIAL_POPULATION_BOUNDARY,
]);

const FACTOR_STRATEGY_POLICIES: readonly FactorStrategyPolicy[] = Object.freeze(
  [
    {
      factorCodes: new Set([
        'ENERGY_DEFICIT',
        'ADEQUATE_ENERGY',
        'ENERGY_BALANCE',
      ]),
      strategy: S.ENERGY_BALANCE,
      polarity: 'POSITIVE',
    },
    {
      factorCodes: new Set(['PROTEIN_DISTRIBUTION', 'PLANT_PROTEIN_VARIETY']),
      strategy: S.PROTEIN_DISTRIBUTION,
      polarity: 'POSITIVE',
    },
    {
      factorCodes: new Set([
        'RECOVERY',
        'RECOVERY_WINDOW',
        'POST_RUN_RECOVERY',
        'POST_RIDE_RECOVERY',
      ]),
      strategy: S.RECOVERY_SUPPORT,
      polarity: 'POSITIVE',
    },
    {
      factorCodes: new Set([
        'TRAINING_ALIGNMENT',
        'TRAINING_DEMAND',
        'CARBOHYDRATE_AVAILABILITY',
        'DURATION_AWARE_ENERGY',
      ]),
      strategy: S.SPORTS_FUELING,
      polarity: 'POSITIVE',
    },
    {
      factorCodes: new Set([
        'HYDRATION',
        'REGULAR_ACCESS',
        'EXERCISE_CONTEXT',
        'ENVIRONMENTAL_HYDRATION',
        'FLUID_ACCESS_PLAN',
      ]),
      strategy: S.HYDRATION_SUPPORT,
      polarity: 'POSITIVE',
    },
    {
      factorCodes: new Set([
        'FUNCTIONAL_EQUIVALENCE',
        'ACCEPTABLE_ALTERNATIVES',
        'SAFE_ALTERNATIVES',
      ]),
      strategy: S.FOOD_SUBSTITUTION,
      polarity: 'POSITIVE',
    },
    {
      factorCodes: new Set(['ROUTINE_ALIGNMENT', 'ROUTINE_STABILITY']),
      strategy: S.ROUTINE_ALIGNMENT,
      polarity: 'POSITIVE',
    },
    {
      factorCodes: new Set(['SMALL_REPEATABLE_ACTIONS', 'FLEXIBLE_ADHERENCE']),
      strategy: S.BEHAVIOR_ADHERENCE,
      polarity: 'POSITIVE',
    },
    {
      factorCodes: new Set(['CONFIRMED_CONSTRAINTS']),
      strategy: S.CONSTRAINT_PRESERVATION,
      polarity: 'POSITIVE',
    },
    {
      factorCodes: new Set(['AGGRESSIVE_RESTRICTION']),
      strategy: S.AGGRESSIVE_RESTRICTION,
      polarity: 'NEGATIVE',
    },
    {
      factorCodes: new Set(['COMPLEX_DAILY_RECIPES']),
      strategy: S.SOPHISTICATED_RECIPES,
      polarity: 'NEGATIVE',
    },
    {
      factorCodes: new Set(['EXPENSIVE_DEFAULTS']),
      strategy: S.HIGH_COST_DEFAULTS,
      polarity: 'NEGATIVE',
    },
    {
      factorCodes: new Set(['CLINICAL_PROTOCOL']),
      strategy: S.CLINICAL_PROTOCOL,
      polarity: 'NEGATIVE',
    },
  ],
);

const STRATEGY_OBJECTIVE_POLICIES: readonly StrategyObjectivePolicy[] =
  Object.freeze([
    { strategies: new Set([S.RECOVERY_SUPPORT]), objective: O.RECOVERY },
    { strategies: new Set([S.SPORTS_FUELING]), objective: O.PERFORMANCE },
    { strategies: new Set([S.SATIETY_SUPPORT]), objective: O.SATIETY },
    {
      strategies: new Set([
        S.PRACTICAL_MEALS,
        S.QUICK_MEALS,
        S.ROUTINE_ALIGNMENT,
        S.EATING_OUT_NAVIGATION,
      ]),
      objective: O.PRACTICALITY,
    },
    { strategies: new Set([S.ECONOMIC_SELECTION]), objective: O.ECONOMY },
    {
      strategies: new Set([S.NUTRITION_EDUCATION]),
      objective: O.NUTRITION_EDUCATION,
    },
    { strategies: new Set([S.BEHAVIOR_ADHERENCE]), objective: O.ADHERENCE },
    {
      strategies: new Set([S.CONSTRAINT_PRESERVATION]),
      objective: O.SAFETY,
    },
  ]);

@Injectable()
export class NutritionReasoningEngineService {
  private readonly canonicalPackages = new Map<
    NutritionKnowledgePackageId,
    NutritionKnowledgePackage
  >(NUTRITION_KNOWLEDGE_PACKAGES.map((item) => [item.id, item]));

  reason(input: NutritionReasoningInput): NutritionReasoningResult {
    const packages = this.canonicalInputPackages(input.knowledgePackages);
    const packageResolution = this.resolvePackageConflicts(packages);
    const context = this.context(input, packageResolution.selected);
    const packageDecisions = this.packageDecisions(
      packageResolution.selected,
      packageResolution.discarded,
      context,
    );
    const strategies = new Map<
      NutritionReasoningStrategy,
      StrategyAccumulator
    >();
    const prohibited = new Map<
      NutritionReasoningStrategy,
      StrategyAccumulator
    >();
    const conflicts: NutritionResolvedConflict[] = [];

    this.mapPackagesToStrategies(
      packageResolution.selected,
      packageDecisions,
      context,
      strategies,
      prohibited,
    );
    this.resolveContextConflicts(context, strategies, prohibited, conflicts);

    for (const strategyId of prohibited.keys()) strategies.delete(strategyId);

    const selectedStrategies = this.freezeStrategies(strategies);
    const prohibitedStrategies = this.freezeProhibitedStrategies(prohibited);
    const priorities = this.priorityProfile(context);
    const objectives = this.objectives(
      context,
      selectedStrategies,
      packageResolution.selected,
    );
    const activeFactors = this.activeFactors(
      packageResolution.selected,
      packageDecisions,
    );
    const discardedFactors = this.discardedFactors(packageResolution.discarded);
    const restrictions = this.restrictions(packageResolution.selected);
    const personalizationLevel = this.personalizationLevel(
      packageResolution.selected,
      context,
    );

    return deepFreeze({
      prioritizedObjectives: objectives,
      packageDecisions,
      activeFactors,
      discardedFactors,
      resolvedConflicts: conflicts,
      appliedRestrictions: restrictions,
      selectedStrategies,
      prohibitedStrategies,
      interventionIntensity: this.interventionIntensity(input, context),
      personalizationLevel,
      recommendedComplexity: this.recommendedComplexity(input, context),
      priorities,
      metadata: {
        schemaVersion: NUTRITION_REASONING_SCHEMA_VERSION,
        strategyVersion: NUTRITION_REASONING_STRATEGY_VERSION,
        knowledgeCatalogVersion:
          packageResolution.selected[0]?.catalogVersion ?? 'EMPTY',
        sourcePackageIds: packageResolution.selected
          .map((item) => item.id)
          .sort(),
        conversationGoal: input.conversationGoal.goal,
        artifactType: input.artifactType,
        deterministic: true,
        safetyRestricted: context.safetyRestricted,
      },
    });
  }

  private canonicalInputPackages(
    inputPackages: readonly NutritionKnowledgePackage[],
  ): readonly NutritionKnowledgePackage[] {
    const seen = new Set<NutritionKnowledgePackageId>();
    const packages = inputPackages.map((inputPackage) => {
      if (seen.has(inputPackage.id)) {
        throw new Error(`Pacote nutricional duplicado: ${inputPackage.id}`);
      }
      seen.add(inputPackage.id);
      const canonical = this.canonicalPackages.get(inputPackage.id);
      if (
        !canonical ||
        canonical.schemaVersion !== inputPackage.schemaVersion ||
        canonical.catalogVersion !== inputPackage.catalogVersion ||
        canonical.packageVersion !== inputPackage.packageVersion
      ) {
        throw new Error(
          `Pacote nutricional não autorizado: ${inputPackage.id}`,
        );
      }
      return canonical;
    });
    for (const knowledgePackage of packages) {
      for (const dependencyId of knowledgePackage.dependencyPackageIds) {
        if (!seen.has(dependencyId)) {
          throw new Error(
            `Dependência nutricional ausente: ${knowledgePackage.id}/${dependencyId}`,
          );
        }
      }
    }
    return Object.freeze(
      packages.sort((left, right) =>
        this.compareKnowledgePackages(left, right),
      ),
    );
  }

  private resolvePackageConflicts(
    packages: readonly NutritionKnowledgePackage[],
  ): {
    readonly selected: readonly NutritionKnowledgePackage[];
    readonly discarded: readonly NutritionKnowledgePackage[];
  } {
    const selected: NutritionKnowledgePackage[] = [];
    const discarded: NutritionKnowledgePackage[] = [];
    for (const candidate of packages) {
      const conflict = selected.some(
        (current) =>
          candidate.conflictingPackageIds.includes(current.id) ||
          current.conflictingPackageIds.includes(candidate.id),
      );
      if (conflict) discarded.push(candidate);
      else selected.push(candidate);
    }
    return Object.freeze({
      selected: Object.freeze(selected),
      discarded: Object.freeze(discarded),
    });
  }

  private context(
    input: NutritionReasoningInput,
    packages: readonly NutritionKnowledgePackage[],
  ): ReasoningContext {
    const packageIds = new Set(packages.map((item) => item.id));
    const adherence = this.datumValue(
      input.snapshot.longitudinal.adherenceScore,
    );
    const hydration = this.normalize(
      this.datumValue(input.snapshot.nutrition.hydration) ?? '',
    );
    const restrictionCount =
      this.datumValues(input.snapshot.restrictions.foodRestrictions).length +
      this.datumValues(input.snapshot.restrictions.allergies).length +
      this.datumValues(input.snapshot.nutrition.foodIntolerances).length;
    const sportsContext = packages.some(
      (knowledgePackage) =>
        knowledgePackage.domain ===
          NUTRITION_KNOWLEDGE_DOMAIN.SPORTS_NUTRITION &&
        knowledgePackage.id !== P.SPORTS_NUTRITION_FOUNDATION,
    );
    const safetyRestricted = this.hasSafetyBoundary(packages);

    return Object.freeze({
      packageIds,
      lowAdherence: typeof adherence === 'number' && adherence < 60,
      highAdherence: typeof adherence === 'number' && adherence >= 80,
      lowBudget: packageIds.has(P.BUDGET_LOW),
      highBudget: packageIds.has(P.BUDGET_HIGH),
      limitedCookingTime: packageIds.has(P.LIMITED_COOKING_TIME),
      mealsAwayFromHome: packageIds.has(P.MEALS_AWAY_FROM_HOME),
      inadequateHydration: [
        'LOW',
        'BAIXA',
        'INADEQUATE',
        'INADEQUADA',
        'INSUFFICIENT',
        'INSUFICIENTE',
      ].some((token) => hydration.includes(token)),
      sportsContext,
      manyRestrictions: restrictionCount >= 3,
      restrictionCount,
      generalGuidance:
        input.conversationGoal.goal === CONVERSATION_GOAL.GENERAL_GUIDANCE,
      safetyRestricted,
      detailedArtifact:
        input.artifactType === NUTRITION_ARTIFACT_TYPE.WEEKLY_PLAN,
      profileSignalCount: this.profileSignalCount(input),
    });
  }

  private hasSafetyBoundary(
    packages: readonly NutritionKnowledgePackage[],
  ): boolean {
    const boundaryCodes = new Set([
      'NO_CLINICAL_PROTOCOL',
      'NO_SPECIAL_POPULATION_PROTOCOL',
      'REQUIRE_PROFESSIONAL_FOLLOW_UP',
    ]);
    return packages.some((knowledgePackage) =>
      knowledgePackage.limits.some((limit) => boundaryCodes.has(limit.code)),
    );
  }

  private profileSignalCount(input: NutritionReasoningInput): number {
    const signals = [
      this.datumValue(input.snapshot.training.experienceLevel),
      this.datumValue(input.snapshot.training.intensityPreference),
      this.datumValue(input.snapshot.training.weeklyFrequency),
      this.datumValue(input.snapshot.training.sessionDurationMinutes),
      this.datumValue(input.snapshot.longitudinal.goalProgression),
      this.datumValue(input.snapshot.longitudinal.nutritionEvolution),
      this.datumValue(input.snapshot.longitudinal.coachAdaptation),
      this.datumValue(input.snapshot.plans.currentDiet),
      this.datumValue(input.snapshot.plans.currentWorkout),
    ];
    return signals.filter((value) => value !== undefined).length;
  }

  private packageDecisions(
    selected: readonly NutritionKnowledgePackage[],
    discarded: readonly NutritionKnowledgePackage[],
    context: ReasoningContext,
  ): readonly NutritionKnowledgePackageDecision[] {
    const decisions: NutritionKnowledgePackageDecision[] = selected.map(
      (knowledgePackage) => {
        const basePriority = KNOWLEDGE_PRIORITY[knowledgePackage.priority];
        const reasons = new Set<NutritionReasoningReasonCode>([
          'KNOWLEDGE_PRIORITY',
        ]);
        const baseDisposition: NutritionKnowledgePackageDecision['disposition'] =
          knowledgePackage.priority === 'CRITICAL' ? 'REQUIRED' : 'KEPT';

        if (knowledgePackage.priority === 'CRITICAL') {
          reasons.add('SAFETY_MANDATORY');
        }
        const override = this.packagePriorityOverride(
          knowledgePackage,
          context,
        );
        for (const reason of override?.reasonCodes ?? []) reasons.add(reason);

        return Object.freeze({
          packageId: knowledgePackage.id,
          originalPriority: knowledgePackage.priority,
          resolvedPriority: override?.priority ?? basePriority,
          disposition: override?.disposition ?? baseDisposition,
          reasonCodes: Object.freeze([...reasons].sort()),
        });
      },
    );

    decisions.push(
      ...discarded.map((knowledgePackage) =>
        Object.freeze({
          packageId: knowledgePackage.id,
          originalPriority: knowledgePackage.priority,
          resolvedPriority: R.IGNORED,
          disposition: 'DISCARDED' as const,
          reasonCodes: Object.freeze([
            'PACKAGE_CONFLICT' as NutritionReasoningReasonCode,
          ]),
        }),
      ),
    );
    return Object.freeze(
      decisions.sort((left, right) =>
        left.packageId.localeCompare(right.packageId),
      ),
    );
  }

  private packagePriorityOverride(
    knowledgePackage: NutritionKnowledgePackage,
    context: ReasoningContext,
  ): PackagePriorityOverride | null {
    return (
      this.criticalPriorityOverride(knowledgePackage, context) ??
      this.elevatedPriorityOverride(knowledgePackage, context) ??
      this.reducedPriorityOverride(knowledgePackage, context)
    );
  }

  private criticalPriorityOverride(
    knowledgePackage: NutritionKnowledgePackage,
    context: ReasoningContext,
  ): PackagePriorityOverride | null {
    if (knowledgePackage.id === P.BEHAVIOR_ADHERENCE && context.lowAdherence)
      return this.priorityOverride(R.CRITICAL, 'ELEVATED', ['LOW_ADHERENCE']);
    if (
      knowledgePackage.id === P.HYDRATION &&
      context.inadequateHydration &&
      context.sportsContext
    )
      return this.priorityOverride(R.CRITICAL, 'ELEVATED', [
        'INADEQUATE_HYDRATION',
      ]);
    return null;
  }

  private elevatedPriorityOverride(
    knowledgePackage: NutritionKnowledgePackage,
    context: ReasoningContext,
  ): PackagePriorityOverride | null {
    const elevated =
      knowledgePackage.id === P.BUDGET_LOW ||
      knowledgePackage.id === P.LIMITED_COOKING_TIME ||
      (knowledgePackage.id === P.MEALS_AWAY_FROM_HOME &&
        context.packageIds.has(P.WEIGHT_LOSS)) ||
      (knowledgePackage.id === P.FOOD_SUBSTITUTION &&
        (context.lowBudget ||
          context.restrictionCount > 0 ||
          context.packageIds.has(P.FOOD_REJECTIONS))) ||
      (knowledgePackage.id === P.NUTRITION_EDUCATION_FOUNDATION &&
        (context.lowAdherence || context.generalGuidance));
    if (!elevated) return null;
    return this.priorityOverride(
      R.HIGH,
      'ELEVATED',
      this.contextualPriorityReasons(context),
    );
  }

  private reducedPriorityOverride(
    knowledgePackage: NutritionKnowledgePackage,
    context: ReasoningContext,
  ): PackagePriorityOverride | null {
    if (knowledgePackage.id === P.BEHAVIOR_ADHERENCE && context.highAdherence)
      return this.priorityOverride(R.LOW, 'REDUCED', ['HIGH_ADHERENCE']);
    if (knowledgePackage.id === P.BUDGET_HIGH)
      return this.priorityOverride(R.LOW, 'REDUCED', ['HIGH_BUDGET']);
    return null;
  }

  private contextualPriorityReasons(
    context: ReasoningContext,
  ): readonly NutritionReasoningReasonCode[] {
    return Object.freeze([
      ...(context.lowBudget ? (['LOW_BUDGET'] as const) : []),
      ...(context.limitedCookingTime
        ? (['LIMITED_COOKING_TIME'] as const)
        : []),
      ...(context.mealsAwayFromHome ? (['MEALS_AWAY_FROM_HOME'] as const) : []),
      ...(context.lowAdherence ? (['LOW_ADHERENCE'] as const) : []),
      ...(context.generalGuidance ? (['GENERAL_GUIDANCE'] as const) : []),
    ]);
  }

  private priorityOverride(
    priority: PackagePriorityOverride['priority'],
    disposition: PackagePriorityOverride['disposition'],
    reasonCodes: PackagePriorityOverride['reasonCodes'],
  ): PackagePriorityOverride {
    return Object.freeze({ priority, disposition, reasonCodes });
  }

  private mapPackagesToStrategies(
    packages: readonly NutritionKnowledgePackage[],
    packageDecisions: readonly NutritionKnowledgePackageDecision[],
    context: ReasoningContext,
    strategies: Map<NutritionReasoningStrategy, StrategyAccumulator>,
    prohibited: Map<NutritionReasoningStrategy, StrategyAccumulator>,
  ): void {
    this.applyFoundationStrategies(packageDecisions, context, strategies);
    this.applyGoalStrategies(context, strategies, prohibited);
    this.applySportsStrategies(context, strategies);
    this.applyDietaryPatternStrategies(context, strategies);
    this.applyConstraintStrategies(packageDecisions, context, strategies);
    this.applyBudgetStrategies(context, strategies, prohibited);
    this.applyRoutineStrategies(context, strategies, prohibited);
    this.applyBehaviorStrategies(context, strategies);
    this.applySafetyStrategies(context, prohibited);
    this.applyArtifactStrategies(context, strategies);
    this.applyExtensibleFactorStrategies(
      packages,
      packageDecisions,
      strategies,
      prohibited,
    );
  }

  private applyFoundationStrategies(
    packageDecisions: readonly NutritionKnowledgePackageDecision[],
    context: ReasoningContext,
    strategies: Map<NutritionReasoningStrategy, StrategyAccumulator>,
  ): void {
    const priority = (id: NutritionKnowledgePackageId) =>
      this.decisionPriority(packageDecisions, id);
    const has = (id: NutritionKnowledgePackageId) => context.packageIds.has(id);

    if (has(P.HEALTHY_EATING_FOUNDATION))
      this.addStrategy(
        strategies,
        S.CONTROLLED_VARIETY,
        R.MEDIUM,
        P.HEALTHY_EATING_FOUNDATION,
        'KNOWLEDGE_PRIORITY',
      );
    if (has(P.HYDRATION))
      this.addStrategy(
        strategies,
        S.HYDRATION_SUPPORT,
        priority(P.HYDRATION),
        P.HYDRATION,
        context.inadequateHydration
          ? 'INADEQUATE_HYDRATION'
          : 'ADEQUATE_HYDRATION',
      );
    if (has(P.NUTRITION_EDUCATION_FOUNDATION))
      this.addStrategy(
        strategies,
        S.NUTRITION_EDUCATION,
        priority(P.NUTRITION_EDUCATION_FOUNDATION),
        P.NUTRITION_EDUCATION_FOUNDATION,
        context.generalGuidance ? 'GENERAL_GUIDANCE' : 'KNOWLEDGE_PRIORITY',
      );
  }

  private applyGoalStrategies(
    context: ReasoningContext,
    strategies: Map<NutritionReasoningStrategy, StrategyAccumulator>,
    prohibited: Map<NutritionReasoningStrategy, StrategyAccumulator>,
  ): void {
    const has = (id: NutritionKnowledgePackageId) => context.packageIds.has(id);
    if (has(P.WEIGHT_LOSS)) {
      this.addStrategy(
        strategies,
        S.ENERGY_BALANCE,
        R.HIGH,
        P.WEIGHT_LOSS,
        'GOAL_ALIGNMENT',
      );
      this.addStrategy(
        strategies,
        S.ENERGY_DENSITY,
        R.HIGH,
        P.WEIGHT_LOSS,
        'GOAL_ALIGNMENT',
      );
      this.addStrategy(
        strategies,
        S.SATIETY_SUPPORT,
        R.HIGH,
        P.WEIGHT_LOSS,
        'GOAL_ALIGNMENT',
      );
      this.addProhibited(
        prohibited,
        S.AGGRESSIVE_RESTRICTION,
        P.WEIGHT_LOSS,
        'KNOWLEDGE_PRIORITY',
      );
    }
    if (has(P.HYPERTROPHY)) {
      this.addStrategy(
        strategies,
        S.PROTEIN_PRIORITY,
        R.HIGH,
        P.HYPERTROPHY,
        'GOAL_ALIGNMENT',
      );
      this.addStrategy(
        strategies,
        S.PROTEIN_DISTRIBUTION,
        R.HIGH,
        P.HYPERTROPHY,
        'GOAL_ALIGNMENT',
      );
      this.addStrategy(
        strategies,
        S.RECOVERY_SUPPORT,
        R.HIGH,
        P.HYPERTROPHY,
        'GOAL_ALIGNMENT',
      );
    }
    if (has(P.MAINTENANCE)) {
      this.addStrategy(
        strategies,
        S.ENERGY_BALANCE,
        R.HIGH,
        P.MAINTENANCE,
        'GOAL_ALIGNMENT',
      );
      this.addStrategy(
        strategies,
        S.ROUTINE_ALIGNMENT,
        R.HIGH,
        P.MAINTENANCE,
        'GOAL_ALIGNMENT',
      );
    }
  }

  private applySportsStrategies(
    context: ReasoningContext,
    strategies: Map<NutritionReasoningStrategy, StrategyAccumulator>,
  ): void {
    for (const sportId of [P.RUNNING, P.CYCLING, P.CROSSFIT] as const) {
      if (!context.packageIds.has(sportId)) continue;
      this.addStrategy(
        strategies,
        S.SPORTS_FUELING,
        R.HIGH,
        sportId,
        'SPORTS_CONTEXT',
      );
      this.addStrategy(
        strategies,
        S.RECOVERY_SUPPORT,
        R.HIGH,
        sportId,
        'SPORTS_CONTEXT',
      );
      this.addStrategy(
        strategies,
        S.HYDRATION_SUPPORT,
        context.inadequateHydration ? R.CRITICAL : R.HIGH,
        sportId,
        context.inadequateHydration ? 'INADEQUATE_HYDRATION' : 'SPORTS_CONTEXT',
      );
    }
  }

  private applyDietaryPatternStrategies(
    context: ReasoningContext,
    strategies: Map<NutritionReasoningStrategy, StrategyAccumulator>,
  ): void {
    for (const patternId of [P.VEGETARIAN, P.VEGAN] as const) {
      if (!context.packageIds.has(patternId)) continue;
      this.addStrategy(
        strategies,
        S.PROTEIN_PRIORITY,
        patternId === P.VEGAN ? R.HIGH : R.MEDIUM,
        patternId,
        patternId === P.VEGAN ? 'VEGAN_PATTERN' : 'KNOWLEDGE_PRIORITY',
      );
      this.addStrategy(
        strategies,
        S.FOOD_SUBSTITUTION,
        R.HIGH,
        patternId,
        'FOOD_RESTRICTIONS',
      );
    }
  }

  private applyConstraintStrategies(
    packageDecisions: readonly NutritionKnowledgePackageDecision[],
    context: ReasoningContext,
    strategies: Map<NutritionReasoningStrategy, StrategyAccumulator>,
  ): void {
    if (context.packageIds.has(P.FOOD_SUBSTITUTION)) {
      this.addStrategy(
        strategies,
        S.FOOD_SUBSTITUTION,
        this.decisionPriority(packageDecisions, P.FOOD_SUBSTITUTION),
        P.FOOD_SUBSTITUTION,
        context.lowBudget ? 'LOW_BUDGET' : 'FOOD_RESTRICTIONS',
      );
    }
    if (context.packageIds.has(P.FOOD_RESTRICTION_SAFETY)) {
      this.addStrategy(
        strategies,
        S.CONSTRAINT_PRESERVATION,
        R.CRITICAL,
        P.FOOD_RESTRICTION_SAFETY,
        'SAFETY_MANDATORY',
      );
    }
    if (context.packageIds.has(P.FOOD_REJECTIONS)) {
      this.addStrategy(
        strategies,
        S.FOOD_SUBSTITUTION,
        R.HIGH,
        P.FOOD_REJECTIONS,
        'FOOD_REJECTIONS',
      );
    }
  }

  private applyBudgetStrategies(
    context: ReasoningContext,
    strategies: Map<NutritionReasoningStrategy, StrategyAccumulator>,
    prohibited: Map<NutritionReasoningStrategy, StrategyAccumulator>,
  ): void {
    if (context.packageIds.has(P.BUDGET_LOW)) {
      this.addStrategy(
        strategies,
        S.ECONOMIC_SELECTION,
        R.HIGH,
        P.BUDGET_LOW,
        'LOW_BUDGET',
      );
      this.addStrategy(
        strategies,
        S.PRACTICAL_MEALS,
        R.HIGH,
        P.BUDGET_LOW,
        'LOW_BUDGET',
      );
      this.addProhibited(
        prohibited,
        S.HIGH_COST_DEFAULTS,
        P.BUDGET_LOW,
        'LOW_BUDGET',
      );
    } else if (context.packageIds.has(P.BUDGET_HIGH)) {
      this.addStrategy(
        strategies,
        S.ECONOMIC_SELECTION,
        R.LOW,
        P.BUDGET_HIGH,
        'HIGH_BUDGET',
      );
      this.addStrategy(
        strategies,
        S.CONTROLLED_VARIETY,
        R.HIGH,
        P.BUDGET_HIGH,
        'HIGH_BUDGET',
      );
    } else if (context.packageIds.has(P.BUDGET_MEDIUM)) {
      this.addStrategy(
        strategies,
        S.ECONOMIC_SELECTION,
        R.MEDIUM,
        P.BUDGET_MEDIUM,
        'KNOWLEDGE_PRIORITY',
      );
    }
  }

  private applyRoutineStrategies(
    context: ReasoningContext,
    strategies: Map<NutritionReasoningStrategy, StrategyAccumulator>,
    prohibited: Map<NutritionReasoningStrategy, StrategyAccumulator>,
  ): void {
    if (context.packageIds.has(P.LIMITED_COOKING_TIME)) {
      this.addStrategy(
        strategies,
        S.QUICK_MEALS,
        R.HIGH,
        P.LIMITED_COOKING_TIME,
        'LIMITED_COOKING_TIME',
      );
      this.addStrategy(
        strategies,
        S.PRACTICAL_MEALS,
        R.HIGH,
        P.LIMITED_COOKING_TIME,
        'LIMITED_COOKING_TIME',
      );
      this.addProhibited(
        prohibited,
        S.SOPHISTICATED_RECIPES,
        P.LIMITED_COOKING_TIME,
        'LIMITED_COOKING_TIME',
      );
    }
    if (context.packageIds.has(P.MEALS_AWAY_FROM_HOME)) {
      this.addStrategy(
        strategies,
        S.EATING_OUT_NAVIGATION,
        R.HIGH,
        P.MEALS_AWAY_FROM_HOME,
        'MEALS_AWAY_FROM_HOME',
      );
      this.addStrategy(
        strategies,
        S.PRACTICAL_MEALS,
        R.HIGH,
        P.MEALS_AWAY_FROM_HOME,
        'MEALS_AWAY_FROM_HOME',
      );
    }
    if (context.packageIds.has(P.MEAL_TIMING)) {
      this.addStrategy(
        strategies,
        S.ROUTINE_ALIGNMENT,
        R.MEDIUM,
        P.MEAL_TIMING,
        'KNOWLEDGE_PRIORITY',
      );
    }
  }

  private applyBehaviorStrategies(
    context: ReasoningContext,
    strategies: Map<NutritionReasoningStrategy, StrategyAccumulator>,
  ): void {
    if (context.packageIds.has(P.BEHAVIOR_ADHERENCE)) {
      this.addStrategy(
        strategies,
        S.BEHAVIOR_ADHERENCE,
        context.lowAdherence
          ? R.CRITICAL
          : context.highAdherence
            ? R.LOW
            : R.MEDIUM,
        P.BEHAVIOR_ADHERENCE,
        context.lowAdherence
          ? 'LOW_ADHERENCE'
          : context.highAdherence
            ? 'HIGH_ADHERENCE'
            : 'KNOWLEDGE_PRIORITY',
      );
    }
  }

  private applySafetyStrategies(
    context: ReasoningContext,
    prohibited: Map<NutritionReasoningStrategy, StrategyAccumulator>,
  ): void {
    if (context.safetyRestricted) {
      const source = context.packageIds.has(P.CLINICAL_SAFETY_BOUNDARY)
        ? P.CLINICAL_SAFETY_BOUNDARY
        : P.SPECIAL_POPULATION_BOUNDARY;
      this.addProhibited(
        prohibited,
        S.CLINICAL_PROTOCOL,
        source,
        'CLINICAL_BOUNDARY',
      );
    }
  }

  private applyArtifactStrategies(
    context: ReasoningContext,
    strategies: Map<NutritionReasoningStrategy, StrategyAccumulator>,
  ): void {
    if (
      context.detailedArtifact &&
      !context.lowBudget &&
      !context.limitedCookingTime &&
      !context.lowAdherence &&
      !context.manyRestrictions
    ) {
      this.addStrategy(
        strategies,
        S.EXTENSIVE_VARIETY,
        R.MEDIUM,
        P.HEALTHY_EATING_FOUNDATION,
        'ARTIFACT_ALIGNMENT',
      );
    }
  }

  private applyExtensibleFactorStrategies(
    packages: readonly NutritionKnowledgePackage[],
    packageDecisions: readonly NutritionKnowledgePackageDecision[],
    strategies: Map<NutritionReasoningStrategy, StrategyAccumulator>,
    prohibited: Map<NutritionReasoningStrategy, StrategyAccumulator>,
  ): void {
    for (const knowledgePackage of packages) {
      if (LEGACY_POLICY_PACKAGE_IDS.has(knowledgePackage.id)) continue;
      for (const policy of FACTOR_STRATEGY_POLICIES) {
        if (!this.packageMatchesFactorPolicy(knowledgePackage, policy))
          continue;
        if (policy.polarity === 'NEGATIVE') {
          this.addProhibited(
            prohibited,
            policy.strategy,
            knowledgePackage.id,
            'KNOWLEDGE_PRIORITY',
          );
          continue;
        }
        this.addStrategy(
          strategies,
          policy.strategy,
          this.decisionPriority(packageDecisions, knowledgePackage.id),
          knowledgePackage.id,
          'KNOWLEDGE_PRIORITY',
        );
      }
    }
  }

  private packageMatchesFactorPolicy(
    knowledgePackage: NutritionKnowledgePackage,
    policy: FactorStrategyPolicy,
  ): boolean {
    const factors =
      policy.polarity === 'POSITIVE'
        ? knowledgePackage.positiveFactors
        : knowledgePackage.negativeFactors;
    return factors.some((factor) => policy.factorCodes.has(factor.code));
  }

  private resolveContextConflicts(
    context: ReasoningContext,
    strategies: Map<NutritionReasoningStrategy, StrategyAccumulator>,
    prohibited: Map<NutritionReasoningStrategy, StrategyAccumulator>,
    conflicts: NutritionResolvedConflict[],
  ): void {
    this.resolveHypertrophyBudgetConflict(
      context,
      strategies,
      prohibited,
      conflicts,
    );
    this.resolveWeightLossAdherenceConflict(context, strategies, conflicts);
    this.resolveCrossfitRoutineConflict(context, conflicts);
    this.resolveRunningHydrationConflict(context, strategies, conflicts);
    this.resolveVeganProteinConflict(context, conflicts);
    this.resolveRejectionBudgetConflict(context, conflicts);
    this.resolvePracticalityVarietyConflict(
      context,
      strategies,
      prohibited,
      conflicts,
    );
  }

  private resolveHypertrophyBudgetConflict(
    context: ReasoningContext,
    strategies: Map<NutritionReasoningStrategy, StrategyAccumulator>,
    prohibited: Map<NutritionReasoningStrategy, StrategyAccumulator>,
    conflicts: NutritionResolvedConflict[],
  ): void {
    if (!context.packageIds.has(P.HYPERTROPHY) || !context.lowBudget) return;
    this.addStrategy(
      strategies,
      S.PROTEIN_PRIORITY,
      R.HIGH,
      P.HYPERTROPHY,
      'CONFLICT_RESOLUTION',
    );
    this.addStrategy(
      strategies,
      S.ECONOMIC_SELECTION,
      R.HIGH,
      P.BUDGET_LOW,
      'CONFLICT_RESOLUTION',
    );
    this.addStrategy(
      strategies,
      S.FOOD_SUBSTITUTION,
      R.HIGH,
      P.BUDGET_LOW,
      'CONFLICT_RESOLUTION',
    );
    this.addProhibited(
      prohibited,
      S.SOPHISTICATED_RECIPES,
      P.BUDGET_LOW,
      'CONFLICT_RESOLUTION',
    );
    this.conflict(
      conflicts,
      NUTRITION_REASONING_CONFLICT.HYPERTROPHY_LOW_BUDGET,
      [P.HYPERTROPHY, P.BUDGET_LOW],
      [S.PROTEIN_PRIORITY, S.ECONOMIC_SELECTION, S.FOOD_SUBSTITUTION],
      [S.EXTENSIVE_VARIETY],
      [S.SOPHISTICATED_RECIPES],
    );
  }

  private resolveWeightLossAdherenceConflict(
    context: ReasoningContext,
    strategies: Map<NutritionReasoningStrategy, StrategyAccumulator>,
    conflicts: NutritionResolvedConflict[],
  ): void {
    if (
      !context.packageIds.has(P.WEIGHT_LOSS) ||
      !context.mealsAwayFromHome ||
      !context.lowAdherence
    )
      return;
    this.addStrategy(
      strategies,
      S.BEHAVIOR_ADHERENCE,
      R.CRITICAL,
      P.BEHAVIOR_ADHERENCE,
      'CONFLICT_RESOLUTION',
    );
    this.addStrategy(
      strategies,
      S.SATIETY_SUPPORT,
      R.HIGH,
      P.WEIGHT_LOSS,
      'CONFLICT_RESOLUTION',
    );
    this.addStrategy(
      strategies,
      S.NUTRITION_EDUCATION,
      R.HIGH,
      P.NUTRITION_EDUCATION_FOUNDATION,
      'CONFLICT_RESOLUTION',
    );
    this.conflict(
      conflicts,
      NUTRITION_REASONING_CONFLICT.WEIGHT_LOSS_EATING_OUT_LOW_ADHERENCE,
      [P.WEIGHT_LOSS, P.MEALS_AWAY_FROM_HOME, P.BEHAVIOR_ADHERENCE],
      [
        S.BEHAVIOR_ADHERENCE,
        S.SATIETY_SUPPORT,
        S.PRACTICAL_MEALS,
        S.NUTRITION_EDUCATION,
      ],
      [S.EXTENSIVE_VARIETY],
      [],
    );
  }

  private resolveCrossfitRoutineConflict(
    context: ReasoningContext,
    conflicts: NutritionResolvedConflict[],
  ): void {
    if (!context.packageIds.has(P.CROSSFIT) || !context.limitedCookingTime)
      return;
    this.conflict(
      conflicts,
      NUTRITION_REASONING_CONFLICT.CROSSFIT_LIMITED_TIME,
      [P.CROSSFIT, P.LIMITED_COOKING_TIME],
      [S.SPORTS_FUELING, S.RECOVERY_SUPPORT, S.QUICK_MEALS],
      [S.EXTENSIVE_VARIETY],
      [S.SOPHISTICATED_RECIPES],
    );
  }

  private resolveRunningHydrationConflict(
    context: ReasoningContext,
    strategies: Map<NutritionReasoningStrategy, StrategyAccumulator>,
    conflicts: NutritionResolvedConflict[],
  ): void {
    if (!context.packageIds.has(P.RUNNING) || !context.inadequateHydration)
      return;
    this.addStrategy(
      strategies,
      S.HYDRATION_SUPPORT,
      R.CRITICAL,
      P.HYDRATION,
      'CONFLICT_RESOLUTION',
    );
    this.conflict(
      conflicts,
      NUTRITION_REASONING_CONFLICT.RUNNING_INADEQUATE_HYDRATION,
      [P.RUNNING, P.HYDRATION],
      [S.HYDRATION_SUPPORT, S.RECOVERY_SUPPORT],
      [],
      [],
    );
  }

  private resolveVeganProteinConflict(
    context: ReasoningContext,
    conflicts: NutritionResolvedConflict[],
  ): void {
    if (!context.packageIds.has(P.VEGAN)) return;
    this.conflict(
      conflicts,
      NUTRITION_REASONING_CONFLICT.VEGAN_PROTEIN,
      [P.VEGAN],
      [S.PROTEIN_PRIORITY, S.FOOD_SUBSTITUTION],
      [],
      [],
    );
  }

  private resolveRejectionBudgetConflict(
    context: ReasoningContext,
    conflicts: NutritionResolvedConflict[],
  ): void {
    if (!context.packageIds.has(P.FOOD_REJECTIONS) || !context.lowBudget)
      return;
    this.conflict(
      conflicts,
      NUTRITION_REASONING_CONFLICT.REJECTIONS_LOW_BUDGET,
      [P.FOOD_REJECTIONS, P.BUDGET_LOW],
      [S.FOOD_SUBSTITUTION, S.ECONOMIC_SELECTION],
      [S.EXTENSIVE_VARIETY],
      [S.HIGH_COST_DEFAULTS],
    );
  }

  private resolvePracticalityVarietyConflict(
    context: ReasoningContext,
    strategies: Map<NutritionReasoningStrategy, StrategyAccumulator>,
    prohibited: Map<NutritionReasoningStrategy, StrategyAccumulator>,
    conflicts: NutritionResolvedConflict[],
  ): void {
    if (
      !context.limitedCookingTime ||
      (!strategies.has(S.CONTROLLED_VARIETY) &&
        !strategies.has(S.EXTENSIVE_VARIETY))
    )
      return;
    this.reduceStrategy(
      strategies,
      S.CONTROLLED_VARIETY,
      R.LOW,
      P.LIMITED_COOKING_TIME,
      'VARIETY_REDUCTION',
    );
    this.addProhibited(
      prohibited,
      S.EXTENSIVE_VARIETY,
      P.LIMITED_COOKING_TIME,
      'VARIETY_REDUCTION',
    );
    this.conflict(
      conflicts,
      NUTRITION_REASONING_CONFLICT.PRACTICALITY_VARIETY,
      [P.LIMITED_COOKING_TIME, P.HEALTHY_EATING_FOUNDATION],
      [S.PRACTICAL_MEALS, S.QUICK_MEALS],
      [S.CONTROLLED_VARIETY],
      [S.EXTENSIVE_VARIETY],
    );
  }

  private objectives(
    context: ReasoningContext,
    strategies: readonly NutritionSelectedStrategy[],
    packages: readonly NutritionKnowledgePackage[],
  ): readonly NutritionPrioritizedObjective[] {
    const values = new Map<NutritionReasoningObjective, ObjectiveAccumulator>();
    const add = (
      objective: NutritionReasoningObjective,
      priority: Exclude<NutritionReasoningPriority, 'IGNORED'>,
      packageId: NutritionKnowledgePackageId,
      reason: NutritionReasoningReasonCode,
    ) => this.addObjective(values, objective, priority, packageId, reason);

    if (context.safetyRestricted || context.restrictionCount > 0)
      add(
        O.SAFETY,
        R.CRITICAL,
        context.packageIds.has(P.CLINICAL_SAFETY_BOUNDARY)
          ? P.CLINICAL_SAFETY_BOUNDARY
          : context.packageIds.has(P.SPECIAL_POPULATION_BOUNDARY)
            ? P.SPECIAL_POPULATION_BOUNDARY
            : P.FOOD_RESTRICTION_SAFETY,
        'SAFETY_MANDATORY',
      );
    if (context.packageIds.has(P.WEIGHT_LOSS)) {
      add(O.WEIGHT_REDUCTION, R.HIGH, P.WEIGHT_LOSS, 'GOAL_ALIGNMENT');
      add(O.SATIETY, R.HIGH, P.WEIGHT_LOSS, 'GOAL_ALIGNMENT');
    }
    if (context.packageIds.has(P.HYPERTROPHY))
      add(O.MUSCLE_DEVELOPMENT, R.HIGH, P.HYPERTROPHY, 'GOAL_ALIGNMENT');
    if (context.packageIds.has(P.MAINTENANCE))
      add(O.WEIGHT_MAINTENANCE, R.HIGH, P.MAINTENANCE, 'GOAL_ALIGNMENT');
    if (context.lowAdherence)
      add(O.ADHERENCE, R.CRITICAL, P.BEHAVIOR_ADHERENCE, 'LOW_ADHERENCE');
    else if (context.packageIds.has(P.BEHAVIOR_ADHERENCE))
      add(
        O.ADHERENCE,
        context.highAdherence ? R.LOW : R.MEDIUM,
        P.BEHAVIOR_ADHERENCE,
        context.highAdherence ? 'HIGH_ADHERENCE' : 'KNOWLEDGE_PRIORITY',
      );
    if (context.sportsContext) {
      const sport = this.firstPackage(context.packageIds, [
        P.RUNNING,
        P.CYCLING,
        P.CROSSFIT,
      ]);
      add(O.PERFORMANCE, R.HIGH, sport, 'SPORTS_CONTEXT');
      add(O.RECOVERY, R.HIGH, sport, 'SPORTS_CONTEXT');
    }
    if (context.limitedCookingTime || context.mealsAwayFromHome)
      add(
        O.PRACTICALITY,
        R.HIGH,
        context.limitedCookingTime
          ? P.LIMITED_COOKING_TIME
          : P.MEALS_AWAY_FROM_HOME,
        context.limitedCookingTime
          ? 'LIMITED_COOKING_TIME'
          : 'MEALS_AWAY_FROM_HOME',
      );
    if (context.lowBudget) add(O.ECONOMY, R.HIGH, P.BUDGET_LOW, 'LOW_BUDGET');
    else if (context.highBudget)
      add(O.ECONOMY, R.LOW, P.BUDGET_HIGH, 'HIGH_BUDGET');
    if (context.packageIds.has(P.NUTRITION_EDUCATION_FOUNDATION))
      add(
        O.NUTRITION_EDUCATION,
        context.lowAdherence || context.generalGuidance ? R.HIGH : R.MEDIUM,
        P.NUTRITION_EDUCATION_FOUNDATION,
        context.generalGuidance
          ? 'GENERAL_GUIDANCE'
          : context.lowAdherence
            ? 'LOW_ADHERENCE'
            : 'KNOWLEDGE_PRIORITY',
      );

    const selectedIds = new Set(strategies.map((item) => item.strategy));
    const packageIds = new Set(packages.map((item) => item.id));
    if (selectedIds.has(S.PRACTICAL_MEALS) && !values.has(O.PRACTICALITY))
      add(
        O.PRACTICALITY,
        R.MEDIUM,
        packageIds.has(P.BUDGET_LOW)
          ? P.BUDGET_LOW
          : P.HEALTHY_EATING_FOUNDATION,
        'KNOWLEDGE_PRIORITY',
      );

    this.applyExtensibleObjectives(values, strategies);

    const sorted = [...values.values()].sort(
      (left, right) =>
        PRIORITY_ORDER[right.priority] - PRIORITY_ORDER[left.priority] ||
        OBJECTIVE_ORDER[left.objective] - OBJECTIVE_ORDER[right.objective] ||
        left.objective.localeCompare(right.objective),
    );
    return Object.freeze(
      sorted.map((item, index) =>
        Object.freeze({
          objective: item.objective,
          priority: item.priority,
          primary: index === 0,
          sourcePackageIds: Object.freeze([...item.sourcePackageIds].sort()),
          reasonCodes: Object.freeze([...item.reasonCodes].sort()),
        }),
      ),
    );
  }

  private applyExtensibleObjectives(
    objectives: Map<NutritionReasoningObjective, ObjectiveAccumulator>,
    strategies: readonly NutritionSelectedStrategy[],
  ): void {
    for (const selectedStrategy of strategies) {
      const futureSources = selectedStrategy.sourcePackageIds.filter(
        (packageId) => !LEGACY_POLICY_PACKAGE_IDS.has(packageId),
      );
      if (futureSources.length === 0) continue;
      for (const policy of STRATEGY_OBJECTIVE_POLICIES) {
        if (!policy.strategies.has(selectedStrategy.strategy)) continue;
        for (const packageId of futureSources) {
          this.addObjective(
            objectives,
            policy.objective,
            selectedStrategy.priority,
            packageId,
            'KNOWLEDGE_PRIORITY',
          );
        }
      }
    }
  }

  private activeFactors(
    packages: readonly NutritionKnowledgePackage[],
    decisions: readonly NutritionKnowledgePackageDecision[],
  ): readonly NutritionReasoningFactorDecision[] {
    const result: NutritionReasoningFactorDecision[] = [];
    for (const knowledgePackage of packages) {
      const priority = this.decisionPriority(decisions, knowledgePackage.id);
      for (const item of knowledgePackage.positiveFactors) {
        result.push(
          Object.freeze({
            packageId: knowledgePackage.id,
            factorCode: item.code,
            polarity: 'POSITIVE',
            priority,
          }),
        );
      }
      for (const item of knowledgePackage.negativeFactors) {
        result.push(
          Object.freeze({
            packageId: knowledgePackage.id,
            factorCode: item.code,
            polarity: 'NEGATIVE',
            priority,
          }),
        );
      }
    }
    return Object.freeze(
      result.sort((left, right) =>
        `${left.packageId}:${left.factorCode}:${left.polarity}`.localeCompare(
          `${right.packageId}:${right.factorCode}:${right.polarity}`,
        ),
      ),
    );
  }

  private discardedFactors(
    packages: readonly NutritionKnowledgePackage[],
  ): readonly NutritionDiscardedFactor[] {
    return Object.freeze(
      packages
        .flatMap((knowledgePackage) =>
          [
            ...knowledgePackage.positiveFactors,
            ...knowledgePackage.negativeFactors,
          ].map((factor) =>
            Object.freeze({
              packageId: knowledgePackage.id,
              factorCode: factor.code,
              reasonCode: 'PACKAGE_CONFLICT' as const,
            }),
          ),
        )
        .sort((left, right) =>
          `${left.packageId}:${left.factorCode}`.localeCompare(
            `${right.packageId}:${right.factorCode}`,
          ),
        ),
    );
  }

  private restrictions(
    packages: readonly NutritionKnowledgePackage[],
  ): readonly NutritionAppliedRestriction[] {
    const values = new Map<
      string,
      {
        readonly code: string;
        readonly enforcement: NutritionAppliedRestriction['enforcement'];
        readonly sourcePackageIds: Set<NutritionKnowledgePackageId>;
      }
    >();
    for (const knowledgePackage of packages) {
      for (const limit of knowledgePackage.limits) {
        const key = `${limit.code}:${limit.enforcement}`;
        const existing = values.get(key);
        if (existing) existing.sourcePackageIds.add(knowledgePackage.id);
        else
          values.set(key, {
            code: limit.code,
            enforcement: limit.enforcement,
            sourcePackageIds: new Set([knowledgePackage.id]),
          });
      }
    }
    return Object.freeze(
      [...values.values()]
        .sort((left, right) =>
          `${left.enforcement}:${left.code}`.localeCompare(
            `${right.enforcement}:${right.code}`,
          ),
        )
        .map((item) =>
          Object.freeze({
            code: item.code,
            enforcement: item.enforcement,
            sourcePackageIds: Object.freeze([...item.sourcePackageIds].sort()),
          }),
        ),
    );
  }

  private priorityProfile(
    context: ReasoningContext,
  ): NutritionReasoningPriorityProfile {
    return Object.freeze({
      adherence: context.lowAdherence
        ? R.CRITICAL
        : context.highAdherence
          ? R.LOW
          : R.MEDIUM,
      performance: context.sportsContext ? R.HIGH : R.IGNORED,
      recovery:
        context.sportsContext || context.packageIds.has(P.HYPERTROPHY)
          ? R.HIGH
          : R.LOW,
      education:
        context.lowAdherence || context.generalGuidance ? R.HIGH : R.MEDIUM,
      practicality:
        context.limitedCookingTime ||
        context.mealsAwayFromHome ||
        context.lowAdherence
          ? R.HIGH
          : R.MEDIUM,
      economy: context.lowBudget
        ? R.HIGH
        : context.highBudget
          ? R.LOW
          : R.MEDIUM,
      satiety: context.packageIds.has(P.WEIGHT_LOSS) ? R.HIGH : R.LOW,
      behavior: context.lowAdherence
        ? R.CRITICAL
        : context.highAdherence
          ? R.LOW
          : context.packageIds.has(P.BEHAVIOR_ADHERENCE)
            ? R.MEDIUM
            : R.IGNORED,
    });
  }

  private interventionIntensity(
    input: NutritionReasoningInput,
    context: ReasoningContext,
  ): NutritionReasoningResult['interventionIntensity'] {
    if (this.requiresRestrictedIntervention(context)) return 'RESTRICTED';
    if (this.requiresLowIntervention(input, context)) return 'LOW';
    if (this.supportsHighIntervention(context)) return 'HIGH';
    return 'MODERATE';
  }

  private requiresRestrictedIntervention(context: ReasoningContext): boolean {
    return context.safetyRestricted;
  }

  private requiresLowIntervention(
    input: NutritionReasoningInput,
    context: ReasoningContext,
  ): boolean {
    return (
      input.artifactType === NUTRITION_ARTIFACT_TYPE.POINT_GUIDANCE ||
      context.lowAdherence
    );
  }

  private supportsHighIntervention(context: ReasoningContext): boolean {
    return (
      context.sportsContext && !context.limitedCookingTime && !context.lowBudget
    );
  }

  private personalizationLevel(
    packages: readonly NutritionKnowledgePackage[],
    context: ReasoningContext,
  ): NutritionPersonalizationLevel {
    const contextualCount = packages.filter(
      (knowledgePackage) => !BASE_PACKAGES.has(knowledgePackage.id),
    ).length;
    const personalizationSignals =
      contextualCount + Math.min(context.profileSignalCount, 2);
    return personalizationSignals >= 5
      ? 'HIGH'
      : personalizationSignals >= 2
        ? 'CONTEXTUAL'
        : 'BASIC';
  }

  private recommendedComplexity(
    input: NutritionReasoningInput,
    context: ReasoningContext,
  ): NutritionRecommendedComplexity {
    if (this.requiresMinimalComplexity(input)) return 'MINIMAL';
    if (this.requiresSimpleComplexity(context)) return 'SIMPLE';
    if (this.supportsDetailedComplexity(input)) return 'DETAILED';
    return 'MODERATE';
  }

  private requiresMinimalComplexity(input: NutritionReasoningInput): boolean {
    return input.artifactType === NUTRITION_ARTIFACT_TYPE.POINT_GUIDANCE;
  }

  private requiresSimpleComplexity(context: ReasoningContext): boolean {
    return (
      context.safetyRestricted ||
      context.lowAdherence ||
      context.lowBudget ||
      context.limitedCookingTime ||
      context.manyRestrictions
    );
  }

  private supportsDetailedComplexity(input: NutritionReasoningInput): boolean {
    return input.artifactType === NUTRITION_ARTIFACT_TYPE.WEEKLY_PLAN;
  }

  private addStrategy(
    target: Map<NutritionReasoningStrategy, StrategyAccumulator>,
    strategy: NutritionReasoningStrategy,
    priority: NutritionReasoningPriority,
    packageId: NutritionKnowledgePackageId,
    reason: NutritionReasoningReasonCode,
  ): void {
    if (priority === R.IGNORED) return;
    const existing = target.get(strategy);
    if (existing) {
      if (PRIORITY_ORDER[priority] > PRIORITY_ORDER[existing.priority])
        existing.priority = priority;
      existing.sourcePackageIds.add(packageId);
      existing.reasonCodes.add(reason);
      return;
    }
    target.set(strategy, {
      strategy,
      priority,
      sourcePackageIds: new Set([packageId]),
      reasonCodes: new Set([reason]),
    });
  }

  private addProhibited(
    target: Map<NutritionReasoningStrategy, StrategyAccumulator>,
    strategy: NutritionReasoningStrategy,
    packageId: NutritionKnowledgePackageId,
    reason: NutritionReasoningReasonCode,
  ): void {
    this.addStrategy(target, strategy, R.CRITICAL, packageId, reason);
  }

  private reduceStrategy(
    target: Map<NutritionReasoningStrategy, StrategyAccumulator>,
    strategy: NutritionReasoningStrategy,
    priority: Exclude<NutritionReasoningPriority, 'IGNORED'>,
    packageId: NutritionKnowledgePackageId,
    reason: NutritionReasoningReasonCode,
  ): void {
    const existing = target.get(strategy);
    if (!existing) return;
    existing.priority = priority;
    existing.sourcePackageIds.add(packageId);
    existing.reasonCodes.add(reason);
  }

  private addObjective(
    target: Map<NutritionReasoningObjective, ObjectiveAccumulator>,
    objective: NutritionReasoningObjective,
    priority: Exclude<NutritionReasoningPriority, 'IGNORED'>,
    packageId: NutritionKnowledgePackageId,
    reason: NutritionReasoningReasonCode,
  ): void {
    const existing = target.get(objective);
    if (existing) {
      if (PRIORITY_ORDER[priority] > PRIORITY_ORDER[existing.priority])
        existing.priority = priority;
      existing.sourcePackageIds.add(packageId);
      existing.reasonCodes.add(reason);
      return;
    }
    target.set(objective, {
      objective,
      priority,
      sourcePackageIds: new Set([packageId]),
      reasonCodes: new Set([reason]),
    });
  }

  private conflict(
    target: NutritionResolvedConflict[],
    conflict: NutritionReasoningConflict,
    packageIds: readonly NutritionKnowledgePackageId[],
    elevatedStrategies: readonly NutritionReasoningStrategy[],
    reducedStrategies: readonly NutritionReasoningStrategy[],
    prohibitedStrategies: readonly NutritionReasoningStrategy[],
  ): void {
    target.push(
      Object.freeze({
        conflict,
        packageIds: Object.freeze([...packageIds].sort()),
        elevatedStrategies: Object.freeze([...elevatedStrategies].sort()),
        reducedStrategies: Object.freeze([...reducedStrategies].sort()),
        prohibitedStrategies: Object.freeze([...prohibitedStrategies].sort()),
        reasonCodes: Object.freeze([
          'CONFLICT_RESOLUTION' as NutritionReasoningReasonCode,
        ]),
      }),
    );
    target.sort((left, right) => left.conflict.localeCompare(right.conflict));
  }

  private freezeStrategies(
    strategies: ReadonlyMap<NutritionReasoningStrategy, StrategyAccumulator>,
  ): readonly NutritionSelectedStrategy[] {
    return Object.freeze(
      [...strategies.values()]
        .sort(
          (left, right) =>
            PRIORITY_ORDER[right.priority] - PRIORITY_ORDER[left.priority] ||
            left.strategy.localeCompare(right.strategy),
        )
        .map((item) =>
          Object.freeze({
            strategy: item.strategy,
            priority: item.priority,
            sourcePackageIds: Object.freeze([...item.sourcePackageIds].sort()),
            reasonCodes: Object.freeze([...item.reasonCodes].sort()),
          }),
        ),
    );
  }

  private freezeProhibitedStrategies(
    strategies: ReadonlyMap<NutritionReasoningStrategy, StrategyAccumulator>,
  ): readonly NutritionProhibitedStrategy[] {
    return Object.freeze(
      [...strategies.values()]
        .sort((left, right) => left.strategy.localeCompare(right.strategy))
        .map((item) =>
          Object.freeze({
            strategy: item.strategy,
            sourcePackageIds: Object.freeze([...item.sourcePackageIds].sort()),
            reasonCodes: Object.freeze([...item.reasonCodes].sort()),
          }),
        ),
    );
  }

  private decisionPriority(
    decisions: readonly NutritionKnowledgePackageDecision[],
    packageId: NutritionKnowledgePackageId,
  ): Exclude<NutritionReasoningPriority, 'IGNORED'> {
    const priority = decisions.find(
      (decision) => decision.packageId === packageId,
    )?.resolvedPriority;
    return priority && priority !== R.IGNORED ? priority : R.LOW;
  }

  private compareKnowledgePackages(
    left: NutritionKnowledgePackage,
    right: NutritionKnowledgePackage,
  ): number {
    return (
      PRIORITY_ORDER[KNOWLEDGE_PRIORITY[right.priority]] -
        PRIORITY_ORDER[KNOWLEDGE_PRIORITY[left.priority]] ||
      left.id.localeCompare(right.id)
    );
  }

  private firstPackage(
    packageIds: ReadonlySet<NutritionKnowledgePackageId>,
    options: readonly NutritionKnowledgePackageId[],
  ): NutritionKnowledgePackageId {
    return options.find((item) => packageIds.has(item)) ?? options[0];
  }

  private datumValue<T>(
    datum: import('../context/coach-profile-snapshot.contract').CoachProfileDatum<T>,
  ): T | undefined {
    return 'value' in datum ? datum.value : undefined;
  }

  private datumValues<T>(
    datum:
      | import('../context/coach-profile-snapshot.contract').CoachProfileDatum<
          readonly T[]
        >
      | undefined,
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
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value))
    return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
