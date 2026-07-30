import type { ShadowObservationEnvelope } from '../shadow-evaluation/shadow-observation-envelope.contract';
import {
  COACHING_QUALITY_POLICY_VERSION,
  COACHING_QUALITY_SCHEMA_VERSION,
} from './coaching-quality.contract';
import type {
  AdherencePredictionEvaluation,
  CoachingOverallScore,
  CoachingQualityAvailability,
  CoachingQualityCode,
  CoachingQualityCriterionEvaluation,
  CoachingQualityCriterionId,
  CoachingQualityDomain,
  CoachingQualityDomainEvaluation,
  CoachingQualityReport,
  ConversationQualityEvaluation,
  LongitudinalQualityEvaluation,
  NutritionQualityEvaluation,
  PersonalizationQualityEvaluation,
  SafetyQualityEvaluation,
  WorkoutQualityEvaluation,
} from './coaching-quality.contract';

const DOMAIN_WEIGHTS: Readonly<Record<CoachingQualityDomain, number>> = {
  NUTRITION: 20,
  WORKOUT: 20,
  LONGITUDINAL: 15,
  CONVERSATION: 15,
  SAFETY: 20,
  PERSONALIZATION: 5,
  ADHERENCE: 5,
};

export class CoachingQualityEvaluationEngine {
  evaluate(observation: ShadowObservationEnvelope): CoachingQualityReport {
    const nutrition = this.evaluateNutrition(observation);
    const workout = this.evaluateWorkout(observation);
    const longitudinal = this.evaluateLongitudinal(observation);
    const conversation = this.evaluateConversation(observation);
    const safety = this.evaluateSafety(observation);
    const personalization = this.evaluatePersonalization(observation);
    const adherencePrediction = this.evaluateAdherence(observation);
    const overall = this.evaluateOverall([
      nutrition,
      workout,
      longitudinal,
      conversation,
      safety,
      personalization,
      adherencePrediction,
    ]);

    return deepFreeze({
      schemaVersion: COACHING_QUALITY_SCHEMA_VERSION,
      policyVersion: COACHING_QUALITY_POLICY_VERSION,
      sourceSchemaVersion: observation.schemaVersion,
      runId: observation.runId,
      nutrition,
      workout,
      longitudinal,
      conversation,
      safety,
      personalization,
      adherencePrediction,
      overall,
      deterministic: true,
    });
  }

  private evaluateNutrition(
    observation: ShadowObservationEnvelope,
  ): NutritionQualityEvaluation {
    const reasoning = observation.artifacts.nutritionReasoning;
    const strategy = observation.artifacts.nutritionShadowStrategy;
    if (!reasoning || !strategy) {
      return asNutrition(notObservedDomain('NUTRITION'));
    }

    const packages = new Set(
      reasoning.packageDecisions.map((item) => item.packageId),
    );
    const strategies = new Set(
      reasoning.selectedStrategies.map((item) => item.strategy),
    );
    const prohibited = new Set(
      reasoning.prohibitedStrategies.map((item) => item.strategy),
    );
    const restrictionContext = hasAny(packages, [
      'FOOD_RESTRICTION_SAFETY',
      'LACTOSE_INTOLERANCE',
      'GLUTEN_RESTRICTION',
      'VEGAN',
      'VEGETARIAN',
      'CLINICAL_SAFETY_BOUNDARY',
      'SPECIAL_POPULATION_BOUNDARY',
    ]);
    const preferenceContext = hasAny(packages, [
      'FOOD_PREFERENCES',
      'FOOD_REJECTIONS',
    ]);
    const budgetContext = hasAny(packages, [
      'BUDGET_LOW',
      'BUDGET_MEDIUM',
      'BUDGET_HIGH',
    ]);

    const criteria: CoachingQualityCriterionEvaluation[] = [
      restrictionContext
        ? criterion(
            'NUTRITION_RESTRICTIONS',
            strategies.has('CONSTRAINT_PRESERVATION') ||
              strategy.restrictionCodes.length > 0 ||
              prohibited.size > 0
              ? 100
              : 35,
            strategies.has('CONSTRAINT_PRESERVATION') ||
              strategy.restrictionCodes.length > 0 ||
              prohibited.size > 0
              ? ['RESTRICTIONS_RESPECTED']
              : ['RESTRICTIONS_NOT_OBSERVED'],
          )
        : unavailable('NUTRITION_RESTRICTIONS', 'RESTRICTIONS_NOT_OBSERVED'),
      preferenceContext
        ? criterion('NUTRITION_PREFERENCES', 100, ['PREFERENCES_CONSIDERED'])
        : unavailable('NUTRITION_PREFERENCES', 'PREFERENCES_NOT_OBSERVED'),
      strategies.has('EXTENSIVE_VARIETY')
        ? criterion('NUTRITION_VARIETY', 100, ['VARIETY_SUPPORTED'])
        : strategies.has('CONTROLLED_VARIETY')
          ? criterion('NUTRITION_VARIETY', 80, ['VARIETY_CONTROLLED'])
          : unavailable('NUTRITION_VARIETY', 'VARIETY_NOT_OBSERVED'),
      unavailable('NUTRITION_REPETITION', 'REPETITION_NOT_OBSERVED'),
      criterion(
        'NUTRITION_SIMPLICITY',
        complexityScore(reasoning.recommendedComplexity),
        reasoning.recommendedComplexity === 'DETAILED'
          ? ['HIGH_COMPLEXITY']
          : ['SIMPLE_STRATEGY'],
      ),
      hasAny(strategies, [
        'PRACTICAL_MEALS',
        'QUICK_MEALS',
        'ROUTINE_ALIGNMENT',
        'EATING_OUT_NAVIGATION',
      ])
        ? criterion('NUTRITION_PRACTICALITY', 100, ['PRACTICAL_STRATEGY'])
        : unavailable('NUTRITION_PRACTICALITY', 'PRACTICALITY_NOT_OBSERVED'),
      budgetContext
        ? criterion(
            'NUTRITION_BUDGET',
            strategies.has('ECONOMIC_SELECTION') ? 100 : 45,
            strategies.has('ECONOMIC_SELECTION')
              ? ['BUDGET_ALIGNED']
              : ['BUDGET_NOT_OBSERVED'],
          )
        : unavailable('NUTRITION_BUDGET', 'BUDGET_NOT_OBSERVED'),
      strategies.has('HYDRATION_SUPPORT')
        ? criterion('NUTRITION_HYDRATION', 100, ['HYDRATION_SUPPORTED'])
        : unavailable('NUTRITION_HYDRATION', 'HYDRATION_NOT_OBSERVED'),
      strategies.has('NUTRITION_EDUCATION')
        ? criterion('NUTRITION_EDUCATION', 100, ['NUTRITION_EDUCATION_PRESENT'])
        : unavailable(
            'NUTRITION_EDUCATION',
            'NUTRITION_EDUCATION_NOT_OBSERVED',
          ),
      strategies.has('PROTEIN_DISTRIBUTION')
        ? criterion('NUTRITION_PROTEIN_DISTRIBUTION', 100, [
            'GOOD_PROTEIN_DISTRIBUTION',
          ])
        : unavailable(
            'NUTRITION_PROTEIN_DISTRIBUTION',
            'PROTEIN_DISTRIBUTION_NOT_OBSERVED',
          ),
      strategies.has('RECOVERY_SUPPORT')
        ? criterion('NUTRITION_RECOVERY', 100, ['RECOVERY_SUPPORTED'])
        : unavailable('NUTRITION_RECOVERY', 'RECOVERY_NOT_OBSERVED'),
      strategies.has('SATIETY_SUPPORT')
        ? criterion('NUTRITION_SATIETY', 100, ['SATIETY_SUPPORTED'])
        : unavailable('NUTRITION_SATIETY', 'SATIETY_NOT_OBSERVED'),
      criterion(
        'NUTRITION_SAFETY',
        reasoning.metadata.safetyRestricted || prohibited.size > 0 ? 100 : 90,
        reasoning.metadata.safetyRestricted || prohibited.size > 0
          ? ['NUTRITION_SAFETY_RESTRICTED']
          : ['NUTRITION_SAFETY_PRESENT'],
      ),
    ];

    return asNutrition(evaluateDomain('NUTRITION', criteria));
  }

  private evaluateWorkout(
    observation: ShadowObservationEnvelope,
  ): WorkoutQualityEvaluation {
    const reasoning = observation.artifacts.workoutReasoning;
    const strategy = observation.artifacts.workoutShadowStrategy;
    if (!reasoning || !strategy) {
      return asWorkout(notObservedDomain('WORKOUT'));
    }

    const packages = new Set(
      reasoning.knowledgeDecisions.map((item) => item.packageId),
    );
    const strategies = new Set(
      reasoning.selectedStrategies.map((item) => item.strategy),
    );
    const progressionScore =
      reasoning.progressionDecision === 'PAUSE' ||
      reasoning.progressionDecision === 'REASSESS'
        ? 90
        : reasoning.progressionDecision === 'DELOAD' ||
            reasoning.progressionDecision === 'REGRESS'
          ? 100
          : 95;
    const safetyPresent =
      reasoning.metadata.safetyRestricted ||
      reasoning.prohibitedStrategies.length > 0 ||
      hasAny(packages, [
        'SAFETY_FOUNDATION',
        'FEVER_SAFETY',
        'ACUTE_PAIN_SAFETY',
        'SIGNIFICANT_FATIGUE_SAFETY',
        'CLINICAL_SAFETY_BOUNDARY',
      ]);

    const criteria: CoachingQualityCriterionEvaluation[] = [
      reasoning.modality.resolved
        ? criterion('WORKOUT_MODALITY', 100, ['MODALITY_ALIGNED'])
        : unavailable('WORKOUT_MODALITY', 'MODALITY_UNKNOWN'),
      criterion(
        'WORKOUT_INTENSITY',
        reasoning.interventionIntensity === 'HIGH'
          ? 75
          : reasoning.interventionIntensity === 'MODERATE_HIGH'
            ? 85
            : 100,
        reasoning.interventionIntensity === 'BLOCKED'
          ? ['INTENSITY_RESTRICTED']
          : ['SAFE_INTENSITY'],
      ),
      criterion(
        'WORKOUT_PROGRESSION',
        progressionScore,
        reasoning.progressionDecision === 'REASSESS' ||
          reasoning.progressionDecision === 'PAUSE'
          ? ['PROGRESSION_REQUIRES_REVIEW']
          : ['SAFE_PROGRESS'],
      ),
      criterion(
        'WORKOUT_COMPLEXITY',
        workoutComplexityScore(reasoning.authorizedComplexity),
        reasoning.authorizedComplexity === 'ADVANCED'
          ? ['HIGH_COMPLEXITY']
          : ['COMPLEXITY_COMPATIBLE'],
      ),
      criterion(
        'WORKOUT_SAFETY',
        safetyPresent ? 100 : 90,
        safetyPresent
          ? ['WORKOUT_SAFETY_RESTRICTED']
          : ['WORKOUT_SAFETY_PRESENT'],
      ),
      hasAny(packages, ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'])
        ? criterion('WORKOUT_EXPERIENCE', 100, ['EXPERIENCE_COMPATIBLE'])
        : unavailable('WORKOUT_EXPERIENCE', 'EXPERIENCE_NOT_OBSERVED'),
      hasAny(packages, ['EQUIPMENT_AVAILABLE', 'NO_EQUIPMENT']) ||
      strategies.has('EQUIPMENT_COMPATIBILITY')
        ? criterion('WORKOUT_EQUIPMENT', 100, ['EQUIPMENT_COMPATIBLE'])
        : unavailable('WORKOUT_EQUIPMENT', 'EQUIPMENT_NOT_OBSERVED'),
      hasAny(packages, ['ENVIRONMENT', 'HOME_TRAINING']) ||
      strategies.has('ENVIRONMENT_COMPATIBILITY')
        ? criterion('WORKOUT_ENVIRONMENT', 100, ['ENVIRONMENT_COMPATIBLE'])
        : unavailable('WORKOUT_ENVIRONMENT', 'ENVIRONMENT_NOT_OBSERVED'),
      hasAny(strategies, [
        'LOW_FRICTION',
        'SUSTAINABLE_FREQUENCY',
        'REALISTIC_FREQUENCY',
        'SHORT_SESSIONS',
      ])
        ? criterion('WORKOUT_ADHERENCE', 100, ['WORKOUT_ADHERENCE_SUPPORTED'])
        : criterion('WORKOUT_ADHERENCE', 70, ['MODERATE_ADHERENCE']),
      hasAny(strategies, [
        'ACTIVE_RECOVERY',
        'BETWEEN_SESSION_RECOVERY',
        'DELOAD',
      ])
        ? criterion('WORKOUT_RECOVERY', 100, ['WORKOUT_RECOVERY_SUPPORTED'])
        : unavailable('WORKOUT_RECOVERY', 'WORKOUT_RECOVERY_NOT_OBSERVED'),
    ];

    return asWorkout(evaluateDomain('WORKOUT', criteria));
  }

  private evaluateLongitudinal(
    observation: ShadowObservationEnvelope,
  ): LongitudinalQualityEvaluation {
    const longitudinal = observation.artifacts.longitudinalDecision;
    const state = longitudinal.currentState;
    const action = longitudinal.decision;
    const stateScore: Readonly<Record<typeof state, number>> = {
      IMPROVING: 100,
      STABLE: 95,
      PLATEAU: 75,
      REGRESSING: 55,
      UNKNOWN: 40,
    };
    const stateCode: Readonly<Record<typeof state, CoachingQualityCode>> = {
      IMPROVING: 'LONGITUDINAL_IMPROVING',
      STABLE: 'LONGITUDINAL_STABLE',
      PLATEAU: 'LONGITUDINAL_PLATEAU',
      REGRESSING: 'LONGITUDINAL_REGRESSION',
      UNKNOWN: 'LONGITUDINAL_UNKNOWN',
    };
    const correct = (expected: readonly string[]): number =>
      expected.includes(action) ? 100 : 35;

    const criteria: CoachingQualityCriterionEvaluation[] = [
      criterion('LONGITUDINAL_STABILITY', stateScore[state], [
        stateCode[state],
      ]),
      state === 'PLATEAU'
        ? criterion(
            'LONGITUDINAL_ADAPTATION_TIMING',
            correct(['ADAPT_PLAN', 'REVIEW']),
            [
              ['ADAPT_PLAN', 'REVIEW'].includes(action)
                ? 'ADAPTATION_TIMELY'
                : 'ADAPTATION_MISTIMED',
            ],
          )
        : unavailable('LONGITUDINAL_ADAPTATION_TIMING'),
      state === 'IMPROVING' || state === 'STABLE'
        ? criterion(
            'LONGITUDINAL_MAINTENANCE_TIMING',
            correct(['KEEP_PLAN', 'WAIT']),
            [
              ['KEEP_PLAN', 'WAIT'].includes(action)
                ? 'MAINTENANCE_TIMELY'
                : 'MAINTENANCE_MISTIMED',
            ],
          )
        : unavailable('LONGITUDINAL_MAINTENANCE_TIMING'),
      action === 'DELOAD' || observation.safetyIndicators.mandatoryDeload
        ? criterion('LONGITUDINAL_DELOAD', action === 'DELOAD' ? 100 : 30, [
            action === 'DELOAD' ? 'DELOAD_TIMELY' : 'DELOAD_MISSING',
          ])
        : unavailable('LONGITUDINAL_DELOAD'),
      action === 'REVIEW' || observation.safetyIndicators.mandatoryReview
        ? criterion('LONGITUDINAL_REVIEW', action === 'REVIEW' ? 100 : 30, [
            action === 'REVIEW' ? 'REVIEW_TIMELY' : 'REVIEW_MISSING',
          ])
        : unavailable('LONGITUDINAL_REVIEW'),
      state === 'REGRESSING'
        ? criterion(
            'LONGITUDINAL_SIMPLIFICATION',
            correct(['REDUCE', 'ADAPT_PLAN', 'REVIEW', 'DELOAD']),
            [
              ['REDUCE', 'ADAPT_PLAN', 'REVIEW', 'DELOAD'].includes(action)
                ? 'SIMPLIFICATION_TIMELY'
                : 'SIMPLIFICATION_MISSING',
            ],
          )
        : unavailable('LONGITUDINAL_SIMPLIFICATION'),
      state === 'IMPROVING'
        ? criterion(
            'LONGITUDINAL_PROGRESSION',
            correct(['KEEP_PLAN', 'INCREASE']),
            [
              ['KEEP_PLAN', 'INCREASE'].includes(action)
                ? 'PROGRESSION_TIMELY'
                : 'PROGRESSION_MISTIMED',
            ],
          )
        : unavailable('LONGITUDINAL_PROGRESSION'),
      state === 'REGRESSING'
        ? criterion(
            'LONGITUDINAL_REGRESSION',
            correct(['REDUCE', 'ADAPT_PLAN', 'REVIEW', 'DELOAD']),
            [
              ['REDUCE', 'ADAPT_PLAN', 'REVIEW', 'DELOAD'].includes(action)
                ? 'REGRESSION_HANDLED'
                : 'REGRESSION_UNHANDLED',
            ],
          )
        : unavailable('LONGITUDINAL_REGRESSION'),
    ];

    return asLongitudinal(evaluateDomain('LONGITUDINAL', criteria));
  }

  private evaluateConversation(
    observation: ShadowObservationEnvelope,
  ): ConversationQualityEvaluation {
    const adaptive = observation.artifacts.adaptiveDecision;
    const planner = observation.artifacts.plannerDecision;
    const personalization = personalizationLevel(observation);
    const questionScore = adaptive.shouldAsk
      ? planner.canExecute
        ? 45
        : 100
      : planner.canExecute
        ? 100
        : 35;
    const questionCode: CoachingQualityCode = adaptive.shouldAsk
      ? planner.canExecute
        ? 'EXCESS_QUESTIONS'
        : 'QUESTION_BALANCED'
      : planner.canExecute
        ? 'QUESTION_BALANCED'
        : 'INSUFFICIENT_QUESTIONS';
    const educational =
      hasNutritionStrategy(observation, 'NUTRITION_EDUCATION') ||
      hasWorkoutStrategy(observation, 'TRAINING_EDUCATION');
    const encouraging =
      hasWorkoutStrategy(observation, 'SUSTAINABLE_MOTIVATION') ||
      observation.artifacts.workoutReasoning?.priorities.motivation === 'HIGH';

    const criteria: CoachingQualityCriterionEvaluation[] = [
      criterion('CONVERSATION_PERSONALIZATION', personalization, [
        personalization >= 85
          ? 'HIGH_PERSONALIZATION'
          : personalization >= 55
            ? 'CONTEXTUAL_PERSONALIZATION'
            : 'LOW_PERSONALIZATION',
      ]),
      unavailable(
        'CONVERSATION_STRUCTURAL_EMPATHY',
        'STRUCTURAL_EMPATHY_NOT_OBSERVED',
      ),
      criterion('CONVERSATION_QUESTION_BALANCE', questionScore, [questionCode]),
      criterion('CONVERSATION_CLARITY', planner.goal === 'UNKNOWN' ? 30 : 100, [
        planner.goal === 'UNKNOWN' ? 'UNCLEAR_GOAL' : 'CLEAR_GOAL',
      ]),
      criterion(
        'CONVERSATION_FOCUS',
        planner.recognizedIntent === 'UNKNOWN' ? 40 : 100,
        [
          planner.recognizedIntent === 'UNKNOWN'
            ? 'UNFOCUSED_RESPONSE_STRUCTURE'
            : 'FOCUSED_RESPONSE_STRUCTURE',
        ],
      ),
      educational
        ? criterion('CONVERSATION_EDUCATION', 100, ['EDUCATIONAL_STRUCTURE'])
        : unavailable(
            'CONVERSATION_EDUCATION',
            'NUTRITION_EDUCATION_NOT_OBSERVED',
          ),
      encouraging
        ? criterion('CONVERSATION_ENCOURAGEMENT', 100, [
            'ENCOURAGEMENT_STRUCTURE',
          ])
        : unavailable(
            'CONVERSATION_ENCOURAGEMENT',
            'ENCOURAGEMENT_NOT_OBSERVED',
          ),
      criterion(
        'CONVERSATION_COHERENCE',
        planner.canExecute || adaptive.shouldAsk ? 100 : 45,
        [
          planner.canExecute || adaptive.shouldAsk
            ? 'COHERENT_STRUCTURE'
            : 'INCOHERENT_STRUCTURE',
        ],
      ),
    ];

    return asConversation(evaluateDomain('CONVERSATION', criteria));
  }

  private evaluateSafety(
    observation: ShadowObservationEnvelope,
  ): SafetyQualityEvaluation {
    const indicators = observation.safetyIndicators;
    const nutrition = observation.artifacts.nutritionReasoning;
    const workout = observation.artifacts.workoutReasoning;
    const nutritionRestricted =
      nutrition?.metadata.safetyRestricted === true ||
      observation.artifacts.nutritionShadowStrategy?.safetyRestricted === true;
    const workoutRestricted =
      workout?.metadata.safetyRestricted === true ||
      observation.artifacts.workoutShadowStrategy?.safetyRestricted === true;
    const anyBlock =
      indicators.paused ||
      indicators.mandatoryReview ||
      indicators.mandatoryDeload ||
      indicators.longitudinalCritical;
    const blockHandled =
      !anyBlock ||
      ['WAIT', 'REVIEW', 'DELOAD', 'REDUCE'].includes(
        observation.artifacts.longitudinalDecision.decision,
      );
    const conflict =
      observation.pipelineResult.comparison.overallCategory === 'CONFLICT';

    const criteria: CoachingQualityCriterionEvaluation[] = [
      criterion(
        'SAFETY_RESTRICTIONS',
        (!indicators.nutritionRestricted || nutritionRestricted) &&
          (!indicators.workoutRestricted || workoutRestricted)
          ? 100
          : 0,
        [
          (!indicators.nutritionRestricted || nutritionRestricted) &&
          (!indicators.workoutRestricted || workoutRestricted)
            ? 'SAFETY_RESTRICTION_APPLIED'
            : 'SAFETY_RESTRICTION_MISSING',
        ],
      ),
      criterion('SAFETY_CONFLICTS', conflict ? 20 : 100, [
        conflict ? 'SAFETY_CONFLICT_UNRESOLVED' : 'SAFETY_CONFLICT_RESOLVED',
      ]),
      criterion('SAFETY_BLOCKS', blockHandled ? 100 : 0, [
        blockHandled ? 'SAFETY_BLOCK_APPLIED' : 'SAFETY_BLOCK_MISSING',
      ]),
      criterion(
        'SAFETY_CLINICAL_BOUNDARY',
        !indicators.clinicalBoundary || nutritionRestricted || workoutRestricted
          ? 100
          : 0,
        [
          !indicators.clinicalBoundary ||
          nutritionRestricted ||
          workoutRestricted
            ? 'CLINICAL_BOUNDARY_RESPECTED'
            : 'CLINICAL_BOUNDARY_MISSING',
        ],
      ),
      workout
        ? criterion(
            'SAFETY_WORKOUT',
            !indicators.workoutRestricted || workoutRestricted ? 100 : 0,
            [
              workoutRestricted
                ? 'WORKOUT_SAFETY_RESTRICTED'
                : 'WORKOUT_SAFETY_PRESENT',
            ],
          )
        : unavailable('SAFETY_WORKOUT'),
      nutrition
        ? criterion(
            'SAFETY_NUTRITION',
            !indicators.nutritionRestricted || nutritionRestricted ? 100 : 0,
            [
              nutritionRestricted
                ? 'NUTRITION_SAFETY_RESTRICTED'
                : 'NUTRITION_SAFETY_PRESENT',
            ],
          )
        : unavailable('SAFETY_NUTRITION'),
    ];

    return asSafety(evaluateDomain('SAFETY', criteria));
  }

  private evaluatePersonalization(
    observation: ShadowObservationEnvelope,
  ): PersonalizationQualityEvaluation {
    const nutritionPackages = packageSet(observation, 'nutrition');
    const workoutPackages = packageSet(observation, 'workout');
    const allPackages = new Set([...nutritionPackages, ...workoutPackages]);
    const restriction = hasAny(allPackages, [
      'FOOD_RESTRICTION_SAFETY',
      'PHYSICAL_LIMITATIONS',
      'CLINICAL_SAFETY_BOUNDARY',
    ]);
    const criteria: CoachingQualityCriterionEvaluation[] = [
      criterion(
        'PERSONALIZATION_FACTORS',
        clamp(allPackages.size * 8, 0, 100),
        [allPackages.size > 0 ? 'FACTORS_USED' : 'NO_FACTORS_USED'],
      ),
      hasAny(nutritionPackages, ['FOOD_PREFERENCES', 'FOOD_REJECTIONS'])
        ? criterion('PERSONALIZATION_PREFERENCES', 100, [
            'PREFERENCES_CONSIDERED',
          ])
        : unavailable(
            'PERSONALIZATION_PREFERENCES',
            'PREFERENCES_NOT_OBSERVED',
          ),
      restriction
        ? criterion('PERSONALIZATION_RESTRICTIONS', 100, [
            'RESTRICTIONS_RESPECTED',
          ])
        : unavailable(
            'PERSONALIZATION_RESTRICTIONS',
            'RESTRICTIONS_NOT_OBSERVED',
          ),
      observation.artifacts.longitudinalDecision.currentState !== 'UNKNOWN'
        ? criterion('PERSONALIZATION_LONGITUDINAL', 100, [
            'LONGITUDINAL_CONTEXT_USED',
          ])
        : unavailable('PERSONALIZATION_LONGITUDINAL'),
      observation.artifacts.workoutReasoning?.modality.resolved !== null &&
      observation.artifacts.workoutReasoning !== null
        ? criterion('PERSONALIZATION_MODALITY', 100, ['MODALITY_ALIGNED'])
        : unavailable('PERSONALIZATION_MODALITY', 'MODALITY_UNKNOWN'),
      hasAny(allPackages, [
        'LIMITED_COOKING_TIME',
        'MEALS_AWAY_FROM_HOME',
        'WEEKLY_FREQUENCY',
        'ENVIRONMENT',
      ])
        ? criterion('PERSONALIZATION_ROUTINE', 100, ['ROUTINE_CONTEXT_USED'])
        : unavailable('PERSONALIZATION_ROUTINE'),
      hasAny(nutritionPackages, ['BUDGET_LOW', 'BUDGET_MEDIUM', 'BUDGET_HIGH'])
        ? criterion('PERSONALIZATION_BUDGET', 100, ['BUDGET_ALIGNED'])
        : unavailable('PERSONALIZATION_BUDGET', 'BUDGET_NOT_OBSERVED'),
      hasAny(allPackages, ['LIMITED_TIME', 'LIMITED_COOKING_TIME'])
        ? criterion('PERSONALIZATION_TIME', 100, ['TIME_CONTEXT_USED'])
        : unavailable('PERSONALIZATION_TIME'),
    ];

    return asPersonalization(evaluateDomain('PERSONALIZATION', criteria));
  }

  private evaluateAdherence(
    observation: ShadowObservationEnvelope,
  ): AdherencePredictionEvaluation {
    const nutritionPackages = packageSet(observation, 'nutrition');
    const workoutPackages = packageSet(observation, 'workout');
    const allPackages = new Set([...nutritionPackages, ...workoutPackages]);
    const nutritionComplexity = observation.artifacts.nutritionReasoning
      ? complexityScore(
          observation.artifacts.nutritionReasoning.recommendedComplexity,
        )
      : null;
    const workoutComplexity = observation.artifacts.workoutReasoning
      ? workoutComplexityScore(
          observation.artifacts.workoutReasoning.authorizedComplexity,
        )
      : null;
    const complexities = [nutritionComplexity, workoutComplexity].filter(
      (value): value is number => value !== null,
    );
    const criteria: CoachingQualityCriterionEvaluation[] = [
      complexities.length > 0
        ? criterion('ADHERENCE_COMPLEXITY', mean(complexities), [
            mean(complexities) >= 80 ? 'GOOD_ADHERENCE' : 'MODERATE_ADHERENCE',
          ])
        : unavailable('ADHERENCE_COMPLEXITY'),
      hasAny(allPackages, [
        'LIMITED_COOKING_TIME',
        'MEALS_AWAY_FROM_HOME',
        'WEEKLY_FREQUENCY',
        'ENVIRONMENT',
      ])
        ? criterion('ADHERENCE_ROUTINE', 100, ['ROUTINE_CONTEXT_USED'])
        : unavailable('ADHERENCE_ROUTINE'),
      hasAny(allPackages, ['LIMITED_TIME', 'LIMITED_COOKING_TIME'])
        ? criterion('ADHERENCE_TIME', 100, ['TIME_CONTEXT_USED'])
        : unavailable('ADHERENCE_TIME'),
      hasAny(nutritionPackages, ['BUDGET_LOW', 'BUDGET_MEDIUM', 'BUDGET_HIGH'])
        ? criterion('ADHERENCE_BUDGET', 100, ['BUDGET_ALIGNED'])
        : unavailable('ADHERENCE_BUDGET', 'BUDGET_NOT_OBSERVED'),
      observation.artifacts.longitudinalDecision.currentState !== 'UNKNOWN'
        ? criterion(
            'ADHERENCE_HISTORY',
            observation.artifacts.longitudinalDecision.currentState ===
              'REGRESSING'
              ? 45
              : observation.artifacts.longitudinalDecision.currentState ===
                  'PLATEAU'
                ? 65
                : 95,
            ['HISTORICAL_ADHERENCE_USED'],
          )
        : unavailable('ADHERENCE_HISTORY'),
      hasAny(workoutPackages, ['MOTIVATION', 'ADHERENCE']) ||
      observation.artifacts.workoutReasoning?.priorities.motivation === 'HIGH'
        ? criterion('ADHERENCE_MOTIVATION', 100, ['MOTIVATION_USED'])
        : unavailable('ADHERENCE_MOTIVATION', 'MOTIVATION_NOT_OBSERVED'),
      hasAny(allPackages, [
        'FOOD_RESTRICTION_SAFETY',
        'PHYSICAL_LIMITATIONS',
        'CLINICAL_SAFETY_BOUNDARY',
      ])
        ? criterion('ADHERENCE_RESTRICTIONS', 100, ['RESTRICTIONS_RESPECTED'])
        : unavailable('ADHERENCE_RESTRICTIONS', 'RESTRICTIONS_NOT_OBSERVED'),
    ];

    return asAdherence(evaluateDomain('ADHERENCE', criteria));
  }

  private evaluateOverall(
    domains: readonly CoachingQualityDomainEvaluation[],
  ): CoachingOverallScore {
    const observed = domains.filter(
      (domain) => domain.availability !== 'NOT_OBSERVED',
    );
    const observedWeight = observed.reduce(
      (total, domain) => total + DOMAIN_WEIGHTS[domain.domain],
      0,
    );
    const score =
      observedWeight === 0
        ? 0
        : round(
            observed.reduce(
              (total, domain) =>
                total + domain.score * DOMAIN_WEIGHTS[domain.domain],
              0,
            ) / observedWeight,
          );
    return {
      score,
      observedWeight,
      codes: uniqueCodes(observed.flatMap((domain) => domain.codes)),
    };
  }
}

function criterion(
  criterionId: CoachingQualityCriterionId,
  score: number,
  codes: readonly CoachingQualityCode[] = [],
): CoachingQualityCriterionEvaluation {
  const normalized = normalize(score);
  return {
    criterion: criterionId,
    availability: 'OBSERVED',
    status:
      normalized >= 90
        ? 'EXCELLENT'
        : normalized >= 70
          ? 'GOOD'
          : normalized >= 40
            ? 'ATTENTION'
            : 'CRITICAL',
    score: normalized,
    codes: uniqueCodes(codes),
  };
}

function unavailable(
  criterionId: CoachingQualityCriterionId,
  code?: CoachingQualityCode,
): CoachingQualityCriterionEvaluation {
  return {
    criterion: criterionId,
    availability: 'NOT_OBSERVED',
    status: 'NOT_OBSERVED',
    score: null,
    codes: code ? [code] : [],
  };
}

function evaluateDomain(
  domain: CoachingQualityDomain,
  criteria: readonly CoachingQualityCriterionEvaluation[],
): CoachingQualityDomainEvaluation {
  const observed = criteria.filter(
    (
      item,
    ): item is CoachingQualityCriterionEvaluation & {
      readonly score: number;
    } => item.score !== null,
  );
  const availability: CoachingQualityAvailability =
    observed.length === 0
      ? 'NOT_OBSERVED'
      : observed.length === criteria.length
        ? 'OBSERVED'
        : 'PARTIAL';
  return {
    domain,
    score: observed.length === 0 ? 0 : mean(observed.map((item) => item.score)),
    coverage: percent(observed.length, criteria.length),
    availability,
    criteria,
    codes: uniqueCodes(criteria.flatMap((item) => item.codes)),
  };
}

function notObservedDomain(
  domain: CoachingQualityDomain,
): CoachingQualityDomainEvaluation {
  return {
    domain,
    score: 0,
    coverage: 0,
    availability: 'NOT_OBSERVED',
    criteria: [],
    codes: [],
  };
}

function packageSet(
  observation: ShadowObservationEnvelope,
  domain: 'nutrition' | 'workout',
): ReadonlySet<string> {
  return domain === 'nutrition'
    ? new Set(
        observation.artifacts.nutritionReasoning?.packageDecisions.map(
          (item) => item.packageId,
        ) ?? [],
      )
    : new Set(
        observation.artifacts.workoutReasoning?.knowledgeDecisions.map(
          (item) => item.packageId,
        ) ?? [],
      );
}

function hasNutritionStrategy(
  observation: ShadowObservationEnvelope,
  strategy: string,
): boolean {
  return (
    observation.artifacts.nutritionReasoning?.selectedStrategies.some(
      (item) => item.strategy === strategy,
    ) ?? false
  );
}

function hasWorkoutStrategy(
  observation: ShadowObservationEnvelope,
  strategy: string,
): boolean {
  return (
    observation.artifacts.workoutReasoning?.selectedStrategies.some(
      (item) => item.strategy === strategy,
    ) ?? false
  );
}

function personalizationLevel(observation: ShadowObservationEnvelope): number {
  const values: number[] = [];
  const nutrition =
    observation.artifacts.nutritionReasoning?.personalizationLevel;
  const workout = observation.artifacts.workoutShadowStrategy?.personalization;
  if (nutrition) values.push(rankPersonalization(nutrition));
  if (workout) values.push(rankPersonalization(workout));
  return values.length === 0 ? 0 : mean(values);
}

function rankPersonalization(value: string): number {
  return value === 'HIGH' ? 100 : value === 'CONTEXTUAL' ? 70 : 35;
}

function complexityScore(value: string): number {
  return value === 'MINIMAL'
    ? 100
    : value === 'SIMPLE'
      ? 95
      : value === 'MODERATE'
        ? 80
        : 60;
}

function workoutComplexityScore(value: string): number {
  return value === 'MINIMAL'
    ? 100
    : value === 'SIMPLE'
      ? 95
      : value === 'STANDARD'
        ? 85
        : value === 'DETAILED'
          ? 75
          : value === 'RESTRICTED'
            ? 100
            : 60;
}

function hasAny(
  values: ReadonlySet<string>,
  expected: readonly string[],
): boolean {
  return expected.some((value) => values.has(value));
}

function uniqueCodes(
  codes: readonly CoachingQualityCode[],
): readonly CoachingQualityCode[] {
  return [...new Set(codes)].sort();
}

function normalize(value: number): number {
  return round(clamp(value, 0, 100));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function percent(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : round((numerator / denominator) * 100);
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : round(values.reduce((total, value) => total + value, 0) / values.length);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function asNutrition(
  value: CoachingQualityDomainEvaluation,
): NutritionQualityEvaluation {
  return { ...value, domain: 'NUTRITION' };
}

function asWorkout(
  value: CoachingQualityDomainEvaluation,
): WorkoutQualityEvaluation {
  return { ...value, domain: 'WORKOUT' };
}

function asLongitudinal(
  value: CoachingQualityDomainEvaluation,
): LongitudinalQualityEvaluation {
  return { ...value, domain: 'LONGITUDINAL' };
}

function asConversation(
  value: CoachingQualityDomainEvaluation,
): ConversationQualityEvaluation {
  return { ...value, domain: 'CONVERSATION' };
}

function asSafety(
  value: CoachingQualityDomainEvaluation,
): SafetyQualityEvaluation {
  return { ...value, domain: 'SAFETY' };
}

function asPersonalization(
  value: CoachingQualityDomainEvaluation,
): PersonalizationQualityEvaluation {
  return { ...value, domain: 'PERSONALIZATION' };
}

function asAdherence(
  value: CoachingQualityDomainEvaluation,
): AdherencePredictionEvaluation {
  return { ...value, domain: 'ADHERENCE' };
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
