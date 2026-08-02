import { Injectable } from '@nestjs/common';
import type {
  CoachProfileConstraint,
  CoachProfileDatum,
  CoachProfileSnapshot,
} from '../context/coach-profile-snapshot.contract';
import { WORKOUT_KNOWLEDGE_PACKAGES } from '../workout-knowledge/workout-knowledge.catalog';
import {
  WORKOUT_KNOWLEDGE_CATALOG_VERSION,
  WORKOUT_KNOWLEDGE_DOMAIN,
  WORKOUT_KNOWLEDGE_PACKAGE_ID,
  WORKOUT_KNOWLEDGE_SCHEMA_VERSION,
  type WorkoutKnowledgePackage,
  type WorkoutKnowledgePackageId,
  type WorkoutKnowledgePriority,
} from '../workout-knowledge/workout-knowledge.contract';
import {
  WORKOUT_ARTIFACT_TYPE,
  WORKOUT_MODALITY,
  type WorkoutModality,
} from '../workout/v2/workout-planning-artifact.contract';
import {
  WORKOUT_REASONING_CONFLICT,
  WORKOUT_REASONING_OBJECTIVE,
  WORKOUT_REASONING_PRIORITY,
  WORKOUT_REASONING_PROHIBITION,
  WORKOUT_REASONING_SCHEMA_VERSION,
  WORKOUT_REASONING_STRATEGY,
  WORKOUT_REASONING_STRATEGY_VERSION,
  type WorkoutComplexityLevel,
  type WorkoutDiscardedFactor,
  type WorkoutExperienceDecision,
  type WorkoutInterventionIntensity,
  type WorkoutKnowledgeDecision,
  type WorkoutProgressionDecision,
  type WorkoutProhibitedStrategy,
  type WorkoutReasoningConflict,
  type WorkoutReasoningConflictResolution,
  type WorkoutReasoningConstraint,
  type WorkoutReasoningFactor,
  type WorkoutReasoningInput,
  type WorkoutReasoningModalityDecision,
  type WorkoutReasoningObjective,
  type WorkoutReasoningPriorities,
  type WorkoutReasoningPriority,
  type WorkoutReasoningProhibition,
  type WorkoutReasoningRationaleCode,
  type WorkoutReasoningResult,
  type WorkoutReasoningStrategy,
  type WorkoutSelectedStrategy,
} from './workout-reasoning.contract';

interface ReasoningContext {
  readonly packageIds: ReadonlySet<WorkoutKnowledgePackageId>;
  readonly explicitObjective: WorkoutReasoningObjective | null;
  readonly experience: WorkoutExperienceDecision;
  readonly modality: WorkoutReasoningModalityDecision;
  readonly limitedTime: boolean;
  readonly lowAdherence: boolean;
  readonly highAdherence: boolean;
  readonly returningAfterBreak: boolean;
  readonly hasLimitations: boolean;
  readonly unconfirmedLimitation: boolean;
  readonly insufficientRecovery: boolean;
  readonly significantFatigue: boolean;
  readonly fever: boolean;
  readonly acutePain: boolean;
  readonly significantMalaise: boolean;
  readonly reportedIncapacity: boolean;
  readonly recentInjury: boolean;
  readonly rehabilitationRequest: boolean;
  readonly extremeRequest: boolean;
  readonly profileConflict: boolean;
  readonly noEquipment: boolean;
  readonly hasEquipment: boolean;
  readonly environmentIncompatible: boolean;
  readonly intensityConfirmedHigh: boolean;
  readonly detailedArtifact: boolean;
  readonly pointArtifact: boolean;
  readonly reviewArtifact: boolean;
  readonly safetyRestricted: boolean;
}

interface StrategyAccumulator {
  readonly strategy: WorkoutReasoningStrategy;
  priority: Exclude<WorkoutReasoningPriority, 'IGNORED'>;
  readonly sourcePackageIds: Set<WorkoutKnowledgePackageId>;
  readonly rationaleCodes: Set<WorkoutReasoningRationaleCode>;
}

interface ProhibitionAccumulator {
  readonly prohibition: WorkoutReasoningProhibition;
  readonly sourcePackageIds: Set<WorkoutKnowledgePackageId>;
  readonly rationaleCodes: Set<WorkoutReasoningRationaleCode>;
}

const P = WORKOUT_KNOWLEDGE_PACKAGE_ID;
const S = WORKOUT_REASONING_STRATEGY;
const X = WORKOUT_REASONING_PROHIBITION;
const R = WORKOUT_REASONING_PRIORITY;
const O = WORKOUT_REASONING_OBJECTIVE;

const KNOWLEDGE_PRIORITY: Readonly<
  Record<WorkoutKnowledgePriority, WorkoutReasoningPriority>
> = Object.freeze({
  CRITICAL: R.CRITICAL,
  HIGH: R.HIGH,
  STANDARD: R.MEDIUM,
  SUPPORTING: R.LOW,
});

const PRIORITY_ORDER: Readonly<Record<WorkoutReasoningPriority, number>> =
  Object.freeze({
    CRITICAL: 5,
    HIGH: 4,
    MEDIUM: 3,
    LOW: 2,
    IGNORED: 1,
  });

const OBJECTIVE_ORDER: Readonly<Record<WorkoutReasoningObjective, number>> =
  Object.freeze({
    SAFETY: 1,
    HYPERTROPHY: 2,
    STRENGTH: 2,
    MUSCULAR_ENDURANCE: 2,
    MAINTENANCE: 2,
    CONDITIONING: 3,
    ENDURANCE: 3,
    MOBILITY: 4,
    ACTIVE_RECOVERY: 4,
    ADHERENCE: 5,
    EDUCATION: 6,
  });

@Injectable()
export class WorkoutReasoningEngineService {
  private readonly canonicalPackages = new Map<
    WorkoutKnowledgePackageId,
    WorkoutKnowledgePackage
  >(WORKOUT_KNOWLEDGE_PACKAGES.map((item) => [item.id, item]));

  reason(input: WorkoutReasoningInput): WorkoutReasoningResult {
    const packages = this.canonicalPackagesFromResolution(input);
    const context = this.context(input, packages);
    const knowledgeDecisions = this.packageDecisions(packages, context);
    const selected = new Map<WorkoutReasoningStrategy, StrategyAccumulator>();
    const prohibited = new Map<
      WorkoutReasoningProhibition,
      ProhibitionAccumulator
    >();
    const conflicts: WorkoutReasoningConflictResolution[] = [];

    this.mapPackages(packages, context, selected, prohibited);
    this.applyContextStrategies(context, selected, prohibited);
    this.resolveConflicts(context, selected, prohibited, conflicts);

    const selectedStrategies = this.freezeStrategies(selected);
    const prohibitedStrategies = this.freezeProhibitions(prohibited);
    const progressionDecision = this.progressionDecision(input, context);
    const objectives = this.objectives(context);
    const rationaleCodes = this.rationaleCodes(
      knowledgeDecisions,
      selectedStrategies,
      prohibitedStrategies,
      conflicts,
      progressionDecision,
    );

    return deepFreeze({
      primaryObjective: objectives[0],
      secondaryObjectives: objectives.slice(1),
      modality: context.modality,
      knowledgeDecisions,
      activeFactors: this.activeFactors(packages, knowledgeDecisions),
      discardedFactors: this.discardedFactors(packages, knowledgeDecisions),
      resolvedConflicts: conflicts,
      appliedConstraints: this.constraints(packages),
      selectedStrategies,
      prohibitedStrategies,
      interventionIntensity: this.interventionIntensity(context),
      authorizedComplexity: this.authorizedComplexity(input, context),
      progressionDecision,
      priorities: this.priorities(context),
      rationaleCodes,
      metadata: {
        schemaVersion: WORKOUT_REASONING_SCHEMA_VERSION,
        strategyVersion: WORKOUT_REASONING_STRATEGY_VERSION,
        knowledgeSchemaVersion: WORKOUT_KNOWLEDGE_SCHEMA_VERSION,
        knowledgeCatalogVersion: WORKOUT_KNOWLEDGE_CATALOG_VERSION,
        sourcePackageIds: packages.map((item) => item.id).sort(),
        conversationGoal: input.conversationGoal.goal,
        artifactType: input.artifactType,
        requestedModality: input.recognizedModality,
        experience: context.experience,
        deterministic: true,
        safetyRestricted: context.safetyRestricted,
      },
    });
  }

  private canonicalPackagesFromResolution(
    input: WorkoutReasoningInput,
  ): readonly WorkoutKnowledgePackage[] {
    const resolution = input.knowledgeResolution;
    if (
      resolution.schemaVersion !== WORKOUT_KNOWLEDGE_SCHEMA_VERSION ||
      resolution.catalogVersion !== WORKOUT_KNOWLEDGE_CATALOG_VERSION
    ) {
      throw new Error('Versão de conhecimento de treino não autorizada');
    }
    if (
      resolution.packages.length !== resolution.packageIds.length ||
      resolution.matchedFacts.length !== resolution.packages.length
    ) {
      throw new Error('Resolução de conhecimento de treino inconsistente');
    }

    const seen = new Set<WorkoutKnowledgePackageId>();
    const packages = resolution.packages.map((inputPackage, index) => {
      if (seen.has(inputPackage.id)) {
        throw new Error(`Pacote de treino duplicado: ${inputPackage.id}`);
      }
      seen.add(inputPackage.id);
      if (resolution.packageIds[index] !== inputPackage.id) {
        throw new Error('Ordem dos pacotes de treino inconsistente');
      }
      const canonical = this.canonicalPackages.get(inputPackage.id);
      if (!canonical) {
        throw new Error(`Pacote de treino desconhecido: ${inputPackage.id}`);
      }
      if (
        canonical.schemaVersion !== inputPackage.schemaVersion ||
        canonical.catalogVersion !== inputPackage.catalogVersion ||
        canonical.packageVersion !== inputPackage.packageVersion ||
        JSON.stringify(canonical) !== JSON.stringify(inputPackage)
      ) {
        throw new Error(`Pacote de treino não canônico: ${inputPackage.id}`);
      }
      return canonical;
    });

    const matchedIds = new Set<WorkoutKnowledgePackageId>();
    for (let index = 0; index < resolution.matchedFacts.length; index += 1) {
      const match = resolution.matchedFacts[index];
      if (!seen.has(match.packageId) || matchedIds.has(match.packageId)) {
        throw new Error('Fatos correspondentes de treino inconsistentes');
      }
      if (match.packageId !== packages[index].id) {
        throw new Error('Ordem dos fatos correspondentes inconsistente');
      }
      matchedIds.add(match.packageId);
    }
    for (const requiredId of [
      P.SAFETY_FOUNDATION,
      P.TRAINING_FOUNDATION,
      P.PROGRESSION,
      P.RECOVERY,
      P.TECHNIQUE,
      P.WARM_UP,
      P.TRAINING_EDUCATION,
    ]) {
      if (!seen.has(requiredId)) {
        throw new Error(`Pacote-base de treino ausente: ${requiredId}`);
      }
    }
    for (const knowledgePackage of packages) {
      for (const dependencyId of knowledgePackage.dependencyPackageIds) {
        if (!seen.has(dependencyId)) {
          throw new Error(
            `Dependência ausente no pacote ${knowledgePackage.id}: ${dependencyId}`,
          );
        }
      }
      for (const conflictId of knowledgePackage.conflictingPackageIds) {
        if (seen.has(conflictId)) {
          throw new Error(
            `Conflito não resolvido entre ${knowledgePackage.id} e ${conflictId}`,
          );
        }
      }
    }
    const expectedSafetyRestricted = [
      P.FEVER_SAFETY,
      P.ACUTE_PAIN_SAFETY,
      P.SIGNIFICANT_FATIGUE_SAFETY,
      P.CLINICAL_SAFETY_BOUNDARY,
      P.PHYSICAL_LIMITATIONS,
    ].some((id) => seen.has(id));
    if (resolution.safetyRestricted !== expectedSafetyRestricted) {
      throw new Error('Indicador de segurança do conhecimento inconsistente');
    }
    return Object.freeze(packages);
  }

  private context(
    input: WorkoutReasoningInput,
    packages: readonly WorkoutKnowledgePackage[],
  ): ReasoningContext {
    const packageIds = new Set(packages.map((item) => item.id));
    const limitations = this.datumValues(
      input.snapshot.restrictions.physicalLimitations,
    );
    const medical = this.datumValues(
      input.snapshot.restrictions.medicalConditions,
    );
    const strings = this.contextStrings(input.snapshot, limitations, medical);
    const adherence = this.datumValue(
      input.snapshot.longitudinal.adherenceScore,
    );
    const duration = this.datumValue(
      input.snapshot.training.sessionDurationMinutes,
    );
    const experience = this.experience(input.snapshot);
    const modality = this.modalityDecision(input);
    const equipment = this.datumValues(
      input.snapshot.training.availableEquipment,
    );
    const equipmentKnown =
      'value' in input.snapshot.training.availableEquipment;
    const insufficientRecovery = this.containsAny(strings, [
      'RECUPERACAO INSUFICIENTE',
      'INSUFFICIENT RECOVERY',
      'MAL RECUPERADO',
      'POUCO SONO',
    ]);
    const significantFatigue =
      packageIds.has(P.SIGNIFICANT_FATIGUE_SAFETY) ||
      this.containsAny(strings, [
        'FADIGA IMPORTANTE',
        'SIGNIFICANT FATIGUE',
        'EXAUSTAO',
      ]);
    const fever =
      packageIds.has(P.FEVER_SAFETY) ||
      this.containsAny(strings, ['FEBRE', 'FEVER']);
    const acutePain =
      packageIds.has(P.ACUTE_PAIN_SAFETY) ||
      this.containsAny(strings, ['DOR AGUDA', 'ACUTE PAIN']);
    const significantMalaise = this.containsAny(strings, [
      'MAL ESTAR IMPORTANTE',
      'SIGNIFICANT MALAISE',
    ]);
    const reportedIncapacity = this.containsAny(strings, [
      'INCAPAZ',
      'INCAPACIDADE',
      'UNABLE TO EXERCISE',
    ]);
    const recentInjury = this.containsAny(strings, [
      'LESAO RECENTE',
      'RECENT INJURY',
    ]);
    const rehabilitationRequest = this.containsAny(strings, [
      'REABILITACAO',
      'FISIOTERAPIA',
      'REHABILITATION',
      'PHYSIOTHERAPY',
    ]);
    const extremeRequest = this.containsAny(strings, [
      'ATE A EXAUSTAO',
      'SEM DESCANSO',
      'EXTREME',
      'MAXIMO TODO DIA',
    ]);
    const environmentIncompatible = this.environmentIncompatible(
      input.snapshot,
      input.recognizedModality,
      equipment,
    );

    return Object.freeze({
      packageIds,
      explicitObjective: this.explicitObjective(input.snapshot),
      experience,
      modality,
      limitedTime: typeof duration === 'number' && duration <= 30,
      lowAdherence: typeof adherence === 'number' && adherence < 0.6,
      highAdherence: typeof adherence === 'number' && adherence >= 0.8,
      returningAfterBreak:
        this.optionalDatumValue(input.snapshot.training.returningAfterBreak) ===
          true || packageIds.has(P.RETURN_AFTER_BREAK),
      hasLimitations: limitations.length > 0,
      unconfirmedLimitation:
        input.snapshot.restrictions.physicalLimitations.status ===
        'REQUIRES_CONFIRMATION',
      insufficientRecovery,
      significantFatigue,
      fever,
      acutePain,
      significantMalaise,
      reportedIncapacity,
      recentInjury,
      rehabilitationRequest,
      extremeRequest,
      profileConflict: input.snapshot.conflicts.length > 0,
      noEquipment: equipmentKnown && equipment.length === 0,
      hasEquipment: equipment.length > 0,
      environmentIncompatible,
      intensityConfirmedHigh:
        input.snapshot.training.intensityPreference.status === 'KNOWN' &&
        this.normalizedDatum(input.snapshot.training.intensityPreference).some(
          (value) => ['HIGH', 'ALTA', 'INTENSA'].includes(value),
        ),
      detailedArtifact:
        input.artifactType === WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
      pointArtifact:
        input.artifactType === WORKOUT_ARTIFACT_TYPE.POINT_GUIDANCE ||
        input.artifactType === WORKOUT_ARTIFACT_TYPE.CURRENT_PLAN_PRESENTATION,
      reviewArtifact:
        input.artifactType === WORKOUT_ARTIFACT_TYPE.PLAN_REVIEW ||
        input.artifactType === WORKOUT_ARTIFACT_TYPE.PLAN_ADAPTATION ||
        input.artifactType === WORKOUT_ARTIFACT_TYPE.EXERCISE_SUBSTITUTION,
      safetyRestricted:
        input.knowledgeResolution.safetyRestricted ||
        fever ||
        acutePain ||
        significantMalaise ||
        reportedIncapacity ||
        rehabilitationRequest ||
        extremeRequest,
    });
  }

  private packageDecisions(
    packages: readonly WorkoutKnowledgePackage[],
    context: ReasoningContext,
  ): readonly WorkoutKnowledgeDecision[] {
    return Object.freeze(
      packages
        .map((knowledgePackage) => {
          const criticalSafety =
            knowledgePackage.domain === WORKOUT_KNOWLEDGE_DOMAIN.SAFETY &&
            knowledgePackage.priority === 'CRITICAL';
          const reduced =
            (knowledgePackage.id === P.HYPERTROPHY && context.limitedTime) ||
            (knowledgePackage.id === P.ADVANCED &&
              context.experience !== 'ADVANCED');
          const elevated =
            knowledgePackage.priority === 'HIGH' ||
            [P.RECOVERY, P.TECHNIQUE, P.ADHERENCE].some(
              (id) =>
                id === knowledgePackage.id &&
                (context.insufficientRecovery ||
                  context.lowAdherence ||
                  context.experience === 'BEGINNER'),
            );
          const resolvedPriority = criticalSafety
            ? R.CRITICAL
            : reduced
              ? R.MEDIUM
              : elevated
                ? R.HIGH
                : KNOWLEDGE_PRIORITY[knowledgePackage.priority];
          const disposition = criticalSafety
            ? 'REQUIRED'
            : reduced
              ? 'REDUCED'
              : elevated
                ? 'ELEVATED'
                : 'KEPT';
          const rationaleCodes: WorkoutReasoningRationaleCode[] = [
            criticalSafety ? 'SAFETY_MANDATORY' : 'KNOWLEDGE_PRIORITY',
          ];
          if (reduced) rationaleCodes.push('PACKAGE_REDUCED');
          return Object.freeze({
            packageId: knowledgePackage.id,
            originalPriority: knowledgePackage.priority,
            resolvedPriority,
            disposition,
            rationaleCodes: Object.freeze(rationaleCodes.sort()),
          });
        })
        .sort(
          (left, right) =>
            PRIORITY_ORDER[right.resolvedPriority] -
              PRIORITY_ORDER[left.resolvedPriority] ||
            left.packageId.localeCompare(right.packageId),
        ),
    );
  }

  private mapPackages(
    packages: readonly WorkoutKnowledgePackage[],
    context: ReasoningContext,
    selected: Map<WorkoutReasoningStrategy, StrategyAccumulator>,
    prohibited: Map<WorkoutReasoningProhibition, ProhibitionAccumulator>,
  ): void {
    for (const knowledgePackage of packages) {
      const id = knowledgePackage.id;
      if (id === P.TRAINING_FOUNDATION) {
        this.addStrategy(selected, S.SUSTAINABLE_FREQUENCY, R.MEDIUM, id);
      }
      if (id === P.TRAINING_EDUCATION) {
        this.addStrategy(selected, S.TRAINING_EDUCATION, R.LOW, id);
      }
      if (id === P.TECHNIQUE) {
        this.addStrategy(selected, S.TECHNIQUE_PRIORITY, R.MEDIUM, id);
      }
      if (id === P.PROGRESSION) {
        this.addStrategy(selected, S.SINGLE_VARIABLE_PROGRESSION, R.HIGH, id);
        this.addProhibition(prohibited, X.AGGRESSIVE_PROGRESSION, id);
        this.addProhibition(prohibited, X.MULTIPLE_VARIABLE_INCREASE, id);
      }
      if (id === P.RECOVERY) {
        this.addStrategy(selected, S.BETWEEN_SESSION_RECOVERY, R.MEDIUM, id);
        this.addStrategy(selected, S.REQUIRED_COOLDOWN, R.MEDIUM, id);
      }
      if (id === P.WARM_UP) {
        this.addStrategy(selected, S.REQUIRED_WARM_UP, R.MEDIUM, id);
      }
      if (id === P.MOBILITY) {
        this.addStrategy(selected, S.REQUIRED_MOBILITY, R.HIGH, id);
      }
      if (id === P.ACTIVE_RECOVERY) {
        this.addStrategy(selected, S.ACTIVE_RECOVERY, R.HIGH, id);
      }
      if (id === P.HYPERTROPHY) {
        this.addStrategy(selected, S.HYPERTROPHY, R.HIGH, id);
        this.addStrategy(selected, S.EXECUTION_BASED_PROGRESSION, R.HIGH, id);
        this.addStrategy(selected, S.SIMPLE_SPLIT, R.MEDIUM, id);
        this.addStrategy(selected, S.LIMITED_ACCESSORIES, R.MEDIUM, id);
      }
      if (id === P.STRENGTH) {
        this.addStrategy(selected, S.STRENGTH, R.HIGH, id);
        this.addProhibition(prohibited, X.INVENTED_1RM, id);
        this.addProhibition(prohibited, X.EXACT_LOAD_WITHOUT_REFERENCE, id);
      }
      if (id === P.MUSCULAR_ENDURANCE) {
        this.addStrategy(selected, S.MUSCULAR_ENDURANCE, R.HIGH, id);
      }
      if (id === P.MAINTENANCE) {
        this.addStrategy(selected, S.MAINTENANCE, R.HIGH, id);
      }
      if (id === P.RESISTANCE_TRAINING) {
        this.addStrategy(selected, S.BASIC_MOVEMENTS, R.MEDIUM, id);
        this.addProhibition(prohibited, X.EXACT_LOAD_WITHOUT_REFERENCE, id);
      }
      if (id === P.RUNNING_ADAPTATION) {
        this.addStrategy(selected, S.GRADUAL_RUNNING_ADAPTATION, R.HIGH, id);
        this.addStrategy(selected, S.CONVERSATIONAL_INTENSITY, R.HIGH, id);
        this.addProhibition(prohibited, X.INVENTED_PACE, id);
      }
      if (id === P.RUNNING_ENDURANCE) {
        this.addStrategy(selected, S.LIGHT_ENDURANCE, R.MEDIUM, id);
        this.addStrategy(selected, S.DURATION_PROGRESSION, R.MEDIUM, id);
      }
      if (id === P.WALKING) {
        this.addStrategy(selected, S.LIGHT_ENDURANCE, R.HIGH, id);
      }
      if (id === P.CYCLING) {
        this.addStrategy(selected, S.CYCLING_ENDURANCE, R.HIGH, id);
        this.addStrategy(selected, S.PERCEIVED_INTENSITY, R.HIGH, id);
        this.addStrategy(selected, S.TERRAIN_AWARENESS, R.MEDIUM, id);
        this.addProhibition(prohibited, X.INVENTED_FTP, id);
        this.addProhibition(prohibited, X.INVENTED_POWER, id);
      }
      if (id === P.CROSSFIT || id === P.FUNCTIONAL) {
        this.addStrategy(selected, S.TECHNIQUE_BEFORE_INTENSITY, R.HIGH, id);
        this.addStrategy(selected, S.COMPATIBLE_CONDITIONING, R.MEDIUM, id);
      }
      if (id === P.CALISTHENICS || id === P.HOME_TRAINING) {
        this.addStrategy(selected, S.BODYWEIGHT, R.HIGH, id);
        this.addStrategy(selected, S.MOVEMENT_REGRESSIONS, R.MEDIUM, id);
        this.addStrategy(selected, S.SIMPLE_PROGRESSIONS, R.MEDIUM, id);
      }
      if (id === P.HOME_TRAINING || id === P.ENVIRONMENT_COMPATIBILITY) {
        this.addStrategy(selected, S.SPACE_COMPATIBILITY, R.HIGH, id);
      }
      if (id === P.EQUIPMENT_COMPATIBILITY) {
        this.addStrategy(selected, S.EQUIPMENT_COMPATIBILITY, R.CRITICAL, id);
        this.addProhibition(prohibited, X.UNAVAILABLE_EQUIPMENT, id);
      }
      if (id === P.ENVIRONMENT_COMPATIBILITY) {
        this.addStrategy(selected, S.ENVIRONMENT_COMPATIBILITY, R.CRITICAL, id);
        this.addProhibition(
          prohibited,
          X.TECHNICAL_TRAINING_IN_INCOMPATIBLE_ENVIRONMENT,
          id,
        );
      }
      if (id === P.CROSSFIT) {
        this.addStrategy(selected, S.REQUIRED_SCALING, R.HIGH, id);
      }
      if (id === P.NO_EQUIPMENT) {
        this.addStrategy(selected, S.RESTRICTED_EQUIPMENT, R.HIGH, id);
      }
      if (id === P.LIMITED_TIME) {
        this.addStrategy(selected, S.SHORT_SESSIONS, R.HIGH, id);
        this.addStrategy(selected, S.REDUCED_DURATION, R.HIGH, id);
        this.addStrategy(selected, S.CONTROLLED_VOLUME, R.HIGH, id);
        this.addProhibition(prohibited, X.VOLUME_INCOMPATIBLE_WITH_TIME, id);
      }
      if (id === P.ADHERENCE) {
        this.addStrategy(selected, S.LOW_FRICTION, R.HIGH, id);
        this.addStrategy(selected, S.REALISTIC_FREQUENCY, R.HIGH, id);
      }
      if (id === P.MOTIVATION) {
        this.addStrategy(selected, S.SUSTAINABLE_MOTIVATION, R.MEDIUM, id);
      }
      if (id === P.BEGINNER) {
        this.addStrategy(selected, S.SIMPLE_MOVEMENTS, R.HIGH, id);
        this.addStrategy(selected, S.CONSERVATIVE_PROGRESSION, R.HIGH, id);
        this.addProhibition(prohibited, X.ADVANCED_MOVEMENTS_FOR_BEGINNER, id);
        this.addProhibition(
          prohibited,
          X.HIGH_INTENSITY_WITHOUT_EXPERIENCE,
          id,
        );
      }
      if (id === P.RETURN_AFTER_BREAK) {
        this.addStrategy(selected, S.REGRESSION, R.CRITICAL, id);
        this.addStrategy(selected, S.CONSERVATIVE_PROGRESSION, R.CRITICAL, id);
      }
      if (id === P.DELOAD || id === P.SIGNIFICANT_FATIGUE_SAFETY) {
        this.addStrategy(selected, S.DELOAD, R.CRITICAL, id);
      }
      if (
        knowledgePackage.domain === WORKOUT_KNOWLEDGE_DOMAIN.SAFETY &&
        knowledgePackage.priority === 'CRITICAL'
      ) {
        this.addStrategy(selected, S.REASSESSMENT, R.CRITICAL, id);
      }
      if (id === P.FEVER_SAFETY) {
        this.addProhibition(prohibited, X.INTENSE_TRAINING_WITH_FEVER, id);
      }
      if (id === P.ACUTE_PAIN_SAFETY) {
        this.addProhibition(prohibited, X.PAIN_AGGRAVATING_TRAINING, id);
      }
      if (id === P.CLINICAL_SAFETY_BOUNDARY || id === P.SAFETY_FOUNDATION) {
        this.addProhibition(prohibited, X.IMPROVISED_REHABILITATION, id);
      }
      if (id === P.CARDIO_CONDITIONING) {
        this.addStrategy(selected, S.PERCEIVED_INTENSITY, R.HIGH, id);
        this.addProhibition(prohibited, X.PRECISE_ZONES_WITHOUT_DATA, id);
      }
    }

    if (context.experience === 'UNKNOWN') {
      this.addProhibition(
        prohibited,
        X.HIGH_INTENSITY_WITHOUT_EXPERIENCE,
        this.source(context, [P.TRAINING_FOUNDATION]),
        'EXPERIENCE_UNKNOWN',
      );
    }
    if (
      context.experience === 'BEGINNER' &&
      context.packageIds.has(P.RUNNING_ADAPTATION)
    ) {
      this.addProhibition(
        prohibited,
        X.ADVANCED_RUNNING_WITHOUT_BASE,
        this.source(context, [P.RUNNING_ADAPTATION, P.BEGINNER]),
        'EXPERIENCE_BEGINNER',
      );
    }
    if (
      (context.experience === 'INTERMEDIATE' ||
        context.experience === 'ADVANCED') &&
      context.packageIds.has(P.RUNNING_ADAPTATION) &&
      !context.returningAfterBreak
    ) {
      this.addStrategy(
        selected,
        S.AUTHORIZED_INTERVALS,
        R.MEDIUM,
        this.source(context, [P.RUNNING_ADAPTATION]),
        'EXPERIENCE_INTERMEDIATE',
      );
    }
  }

  private applyContextStrategies(
    context: ReasoningContext,
    selected: Map<WorkoutReasoningStrategy, StrategyAccumulator>,
    prohibited: Map<WorkoutReasoningProhibition, ProhibitionAccumulator>,
  ): void {
    const foundation = this.source(context, [P.TRAINING_FOUNDATION]);
    if (context.pointArtifact) {
      this.addStrategy(
        selected,
        S.SIMPLE_SESSION,
        R.HIGH,
        foundation,
        'ARTIFACT_ALIGNMENT',
      );
    }
    if (context.lowAdherence) {
      const source = this.source(context, [P.ADHERENCE, P.TRAINING_FOUNDATION]);
      this.addStrategy(
        selected,
        S.LOW_FRICTION,
        R.CRITICAL,
        source,
        'LOW_ADHERENCE',
      );
      this.addStrategy(
        selected,
        S.REDUCED_COMPLEXITY,
        R.CRITICAL,
        source,
        'LOW_ADHERENCE',
      );
      this.addStrategy(
        selected,
        S.REALISTIC_FREQUENCY,
        R.CRITICAL,
        source,
        'LOW_ADHERENCE',
      );
    }
    if (context.insufficientRecovery || context.significantFatigue) {
      const source = this.source(context, [
        P.RECOVERY,
        P.SIGNIFICANT_FATIGUE_SAFETY,
      ]);
      this.addStrategy(
        selected,
        S.DELOAD,
        R.CRITICAL,
        source,
        'INSUFFICIENT_RECOVERY',
      );
      this.addStrategy(
        selected,
        S.ACTIVE_RECOVERY,
        R.HIGH,
        source,
        'INSUFFICIENT_RECOVERY',
      );
    }
    if (context.environmentIncompatible) {
      const source = this.source(context, [
        P.ENVIRONMENT_COMPATIBILITY,
        P.SAFETY_FOUNDATION,
      ]);
      this.addStrategy(
        selected,
        S.REASSESSMENT,
        R.CRITICAL,
        source,
        'ENVIRONMENT_INCOMPATIBLE',
      );
      this.addProhibition(
        prohibited,
        X.TECHNICAL_TRAINING_IN_INCOMPATIBLE_ENVIRONMENT,
        source,
        'ENVIRONMENT_INCOMPATIBLE',
      );
    }
    if (context.rehabilitationRequest) {
      this.addProhibition(
        prohibited,
        X.IMPROVISED_REHABILITATION,
        this.source(context, [P.SAFETY_FOUNDATION, P.CLINICAL_SAFETY_BOUNDARY]),
        'REHABILITATION_REQUEST_SIGNAL',
      );
    }
  }

  private resolveConflicts(
    context: ReasoningContext,
    selected: Map<WorkoutReasoningStrategy, StrategyAccumulator>,
    prohibited: Map<WorkoutReasoningProhibition, ProhibitionAccumulator>,
    conflicts: WorkoutReasoningConflictResolution[],
  ): void {
    if (context.packageIds.has(P.HYPERTROPHY) && context.limitedTime) {
      const source = this.source(context, [P.HYPERTROPHY, P.LIMITED_TIME]);
      this.elevate(selected, S.BASIC_MOVEMENTS, R.CRITICAL, source);
      this.elevate(selected, S.CONTROLLED_VOLUME, R.CRITICAL, source);
      this.elevate(selected, S.SUSTAINABLE_FREQUENCY, R.HIGH, source);
      this.addProhibition(prohibited, X.EXCESSIVE_ACCESSORIES, source);
      this.addProhibition(prohibited, X.LONG_STRUCTURE, source);
      this.conflict(
        conflicts,
        WORKOUT_REASONING_CONFLICT.HYPERTROPHY_LIMITED_TIME,
        [P.HYPERTROPHY, P.LIMITED_TIME],
        [S.BASIC_MOVEMENTS, S.CONTROLLED_VOLUME, S.SUSTAINABLE_FREQUENCY],
        [S.LIMITED_ACCESSORIES],
        [X.EXCESSIVE_ACCESSORIES, X.LONG_STRUCTURE],
      );
    }
    if (
      context.packageIds.has(P.STRENGTH) &&
      context.experience === 'BEGINNER'
    ) {
      const source = this.source(context, [P.STRENGTH, P.BEGINNER]);
      this.elevate(selected, S.TECHNIQUE_PRIORITY, R.CRITICAL, source);
      this.elevate(selected, S.BASIC_MOVEMENTS, R.CRITICAL, source);
      this.elevate(selected, S.CONSERVATIVE_PROGRESSION, R.CRITICAL, source);
      this.addProhibition(prohibited, X.INVENTED_1RM, source);
      this.addProhibition(prohibited, X.AGGRESSIVE_PROGRESSION, source);
      this.conflict(
        conflicts,
        WORKOUT_REASONING_CONFLICT.STRENGTH_BEGINNER,
        [P.STRENGTH, P.BEGINNER],
        [S.TECHNIQUE_PRIORITY, S.BASIC_MOVEMENTS, S.CONSERVATIVE_PROGRESSION],
        [S.STRENGTH],
        [X.INVENTED_1RM, X.AGGRESSIVE_PROGRESSION],
      );
    }
    if (
      context.packageIds.has(P.RUNNING_ADAPTATION) &&
      context.returningAfterBreak
    ) {
      const source = this.source(context, [
        P.RUNNING_ADAPTATION,
        P.RETURN_AFTER_BREAK,
      ]);
      this.elevate(selected, S.RUN_WALK, R.CRITICAL, source);
      this.elevate(selected, S.CONSERVATIVE_PROGRESSION, R.CRITICAL, source);
      this.elevate(selected, S.BETWEEN_SESSION_RECOVERY, R.CRITICAL, source);
      this.addProhibition(prohibited, X.INTENSE_INTERVALS_AFTER_BREAK, source);
      this.addProhibition(prohibited, X.ABRUPT_DISTANCE_INCREASE, source);
      this.conflict(
        conflicts,
        WORKOUT_REASONING_CONFLICT.RUNNING_RETURN_AFTER_BREAK,
        [P.RUNNING_ADAPTATION, P.RETURN_AFTER_BREAK],
        [S.RUN_WALK, S.CONSERVATIVE_PROGRESSION, S.BETWEEN_SESSION_RECOVERY],
        [S.AUTHORIZED_INTERVALS],
        [X.INTENSE_INTERVALS_AFTER_BREAK, X.ABRUPT_DISTANCE_INCREASE],
      );
    }
    if (context.packageIds.has(P.RUNNING_ADAPTATION) && context.limitedTime) {
      const source = this.source(context, [
        P.RUNNING_ADAPTATION,
        P.LIMITED_TIME,
      ]);
      this.elevate(selected, S.REALISTIC_FREQUENCY, R.HIGH, source);
      this.elevate(selected, S.REDUCED_DURATION, R.HIGH, source);
      this.conflict(
        conflicts,
        WORKOUT_REASONING_CONFLICT.RUNNING_LIMITED_TIME,
        [P.RUNNING_ADAPTATION, P.LIMITED_TIME],
        [S.REALISTIC_FREQUENCY, S.REDUCED_DURATION],
        [S.DURATION_PROGRESSION],
        [],
      );
    }
    if (context.packageIds.has(P.CYCLING)) {
      const source = this.source(context, [P.CYCLING]);
      this.elevate(selected, S.PERCEIVED_INTENSITY, R.CRITICAL, source);
      this.elevate(selected, S.TERRAIN_AWARENESS, R.HIGH, source);
      this.addProhibition(prohibited, X.INVENTED_FTP, source);
      this.addProhibition(prohibited, X.INVENTED_POWER, source);
      this.addProhibition(prohibited, X.PRECISE_ZONES_WITHOUT_DATA, source);
      this.conflict(
        conflicts,
        WORKOUT_REASONING_CONFLICT.CYCLING_WITHOUT_METRICS,
        [P.CYCLING],
        [S.PERCEIVED_INTENSITY, S.TERRAIN_AWARENESS],
        [],
        [X.INVENTED_FTP, X.INVENTED_POWER, X.PRECISE_ZONES_WITHOUT_DATA],
      );
    }
    if (
      context.packageIds.has(P.CROSSFIT) &&
      context.experience === 'BEGINNER'
    ) {
      const source = this.source(context, [P.CROSSFIT, P.BEGINNER]);
      this.elevate(selected, S.REQUIRED_SCALING, R.CRITICAL, source);
      this.elevate(selected, S.TECHNIQUE_BEFORE_INTENSITY, R.CRITICAL, source);
      this.elevate(selected, S.SIMPLE_MOVEMENTS, R.CRITICAL, source);
      this.addProhibition(
        prohibited,
        X.ADVANCED_CROSSFIT_WITHOUT_EXPERIENCE,
        source,
      );
      this.addProhibition(prohibited, X.COMPETITION_AS_REFERENCE, source);
      this.conflict(
        conflicts,
        WORKOUT_REASONING_CONFLICT.CROSSFIT_BEGINNER,
        [P.CROSSFIT, P.BEGINNER],
        [S.REQUIRED_SCALING, S.TECHNIQUE_BEFORE_INTENSITY, S.SIMPLE_MOVEMENTS],
        [],
        [X.ADVANCED_CROSSFIT_WITHOUT_EXPERIENCE, X.COMPETITION_AS_REFERENCE],
      );
    }
    if (context.packageIds.has(P.HOME_TRAINING) && context.noEquipment) {
      const source = this.source(context, [P.HOME_TRAINING, P.NO_EQUIPMENT]);
      this.elevate(selected, S.BODYWEIGHT, R.CRITICAL, source);
      this.elevate(selected, S.MOVEMENT_REGRESSIONS, R.HIGH, source);
      this.elevate(selected, S.SIMPLE_PROGRESSIONS, R.HIGH, source);
      this.addProhibition(prohibited, X.UNAVAILABLE_EQUIPMENT, source);
      this.conflict(
        conflicts,
        WORKOUT_REASONING_CONFLICT.HOME_WITHOUT_EQUIPMENT,
        [P.HOME_TRAINING, P.NO_EQUIPMENT],
        [S.BODYWEIGHT, S.MOVEMENT_REGRESSIONS, S.SIMPLE_PROGRESSIONS],
        [],
        [X.UNAVAILABLE_EQUIPMENT],
      );
    }
    if (context.lowAdherence && context.detailedArtifact) {
      const source = this.source(context, [P.ADHERENCE, P.TRAINING_FOUNDATION]);
      this.elevate(selected, S.SIMPLE_SESSION, R.CRITICAL, source);
      this.elevate(selected, S.SHORT_SESSIONS, R.CRITICAL, source);
      this.elevate(selected, S.REALISTIC_FREQUENCY, R.CRITICAL, source);
      this.conflict(
        conflicts,
        WORKOUT_REASONING_CONFLICT.LOW_ADHERENCE_COMPLEX_PLAN,
        [source],
        [S.SIMPLE_SESSION, S.SHORT_SESSIONS, S.REALISTIC_FREQUENCY],
        [S.SIMPLE_SPLIT],
        [],
      );
    }
    if (context.hasLimitations && this.hasSportObjective(context)) {
      const source = this.source(context, [
        P.PHYSICAL_LIMITATIONS,
        P.SAFETY_FOUNDATION,
      ]);
      this.elevate(selected, S.REASSESSMENT, R.CRITICAL, source);
      this.elevate(selected, S.REGRESSION, R.CRITICAL, source);
      this.conflict(
        conflicts,
        WORKOUT_REASONING_CONFLICT.SPORT_OBJECTIVE_PHYSICAL_LIMITATION,
        [source],
        [S.REASSESSMENT, S.REGRESSION],
        [S.HYPERTROPHY, S.STRENGTH, S.LIGHT_ENDURANCE],
        [X.PAIN_AGGRAVATING_TRAINING],
      );
    }
    if (context.significantFatigue) {
      const source = this.source(context, [
        P.SIGNIFICANT_FATIGUE_SAFETY,
        P.RECOVERY,
      ]);
      this.elevate(selected, S.DELOAD, R.CRITICAL, source);
      this.conflict(
        conflicts,
        WORKOUT_REASONING_CONFLICT.PROGRESSION_FATIGUE,
        [source],
        [S.DELOAD, S.ACTIVE_RECOVERY],
        [S.SINGLE_VARIABLE_PROGRESSION],
        [X.AGGRESSIVE_PROGRESSION],
      );
    }
    if (context.insufficientRecovery) {
      const source = this.source(context, [P.RECOVERY]);
      this.elevate(selected, S.ACTIVE_RECOVERY, R.CRITICAL, source);
      this.conflict(
        conflicts,
        WORKOUT_REASONING_CONFLICT.INTENSITY_INSUFFICIENT_RECOVERY,
        [source],
        [S.ACTIVE_RECOVERY],
        [S.PERCEIVED_INTENSITY],
        [X.HIGH_INTENSITY_WITHOUT_EXPERIENCE],
      );
    }
    if (context.modality.status === 'CONFLICT') {
      const source = this.source(context, [
        P.ENVIRONMENT_COMPATIBILITY,
        P.TRAINING_FOUNDATION,
      ]);
      this.conflict(
        conflicts,
        WORKOUT_REASONING_CONFLICT.MODALITY_PROFILE_MISMATCH,
        [source],
        [S.REASSESSMENT],
        [],
        [X.TECHNICAL_TRAINING_IN_INCOMPATIBLE_ENVIRONMENT],
      );
    }
    if (context.environmentIncompatible) {
      const source = this.source(context, [
        P.ENVIRONMENT_COMPATIBILITY,
        P.EQUIPMENT_COMPATIBILITY,
        P.SAFETY_FOUNDATION,
      ]);
      this.conflict(
        conflicts,
        WORKOUT_REASONING_CONFLICT.MODALITY_ENVIRONMENT_INCOMPATIBLE,
        [source],
        [S.REASSESSMENT, S.ENVIRONMENT_COMPATIBILITY],
        [],
        [X.TECHNICAL_TRAINING_IN_INCOMPATIBLE_ENVIRONMENT],
      );
    }
    if (context.experience === 'CONFLICT') {
      const source = this.source(context, [P.TRAINING_FOUNDATION]);
      this.conflict(
        conflicts,
        WORKOUT_REASONING_CONFLICT.EXPERIENCE_PROFILE_CONFLICT,
        [source],
        [S.REASSESSMENT, S.TECHNIQUE_PRIORITY],
        [],
        [X.HIGH_INTENSITY_WITHOUT_EXPERIENCE],
      );
    }
  }

  private progressionDecision(
    input: WorkoutReasoningInput,
    context: ReasoningContext,
  ): WorkoutProgressionDecision {
    if (
      context.fever ||
      context.significantMalaise ||
      context.reportedIncapacity ||
      context.rehabilitationRequest ||
      context.extremeRequest
    )
      return 'PAUSE';
    if (
      context.acutePain ||
      context.recentInjury ||
      context.unconfirmedLimitation ||
      context.profileConflict ||
      context.environmentIncompatible ||
      context.modality.status !== 'CONFIRMED' ||
      context.experience === 'CONFLICT' ||
      (context.experience === 'UNKNOWN' && !context.pointArtifact)
    )
      return 'REASSESS';
    if (context.significantFatigue || context.insufficientRecovery)
      return 'DELOAD';
    if (
      context.returningAfterBreak ||
      context.hasLimitations ||
      (context.lowAdherence && context.detailedArtifact)
    )
      return 'REGRESS';
    if (
      context.pointArtifact ||
      context.reviewArtifact ||
      input.artifactType === WORKOUT_ARTIFACT_TYPE.MOBILITY_SESSION ||
      input.artifactType === WORKOUT_ARTIFACT_TYPE.ACTIVE_RECOVERY_SESSION ||
      (context.packageIds.has(P.MAINTENANCE) &&
        context.explicitObjective === null)
    )
      return 'MAINTAIN';
    if (
      context.experience !== 'UNKNOWN' &&
      context.highAdherence &&
      !context.safetyRestricted
    )
      return 'PROGRESS';
    return 'MAINTAIN';
  }

  private interventionIntensity(
    context: ReasoningContext,
  ): WorkoutInterventionIntensity {
    if (
      context.fever ||
      context.significantMalaise ||
      context.reportedIncapacity ||
      context.rehabilitationRequest ||
      context.extremeRequest
    )
      return 'BLOCKED';
    if (
      context.significantFatigue ||
      context.insufficientRecovery ||
      context.packageIds.has(P.ACTIVE_RECOVERY)
    )
      return 'RECOVERY';
    if (
      context.safetyRestricted ||
      context.returningAfterBreak ||
      context.experience === 'BEGINNER' ||
      context.experience === 'UNKNOWN' ||
      context.experience === 'CONFLICT' ||
      context.lowAdherence
    )
      return 'LOW';
    if (
      context.experience === 'ADVANCED' &&
      context.intensityConfirmedHigh &&
      context.highAdherence
    )
      return 'HIGH';
    if (context.experience === 'ADVANCED') return 'MODERATE_HIGH';
    if (
      context.experience === 'INTERMEDIATE' &&
      context.intensityConfirmedHigh &&
      context.highAdherence
    )
      return 'MODERATE_HIGH';
    return 'MODERATE';
  }

  private authorizedComplexity(
    input: WorkoutReasoningInput,
    context: ReasoningContext,
  ): WorkoutComplexityLevel {
    if (
      context.safetyRestricted ||
      context.modality.status === 'CONFLICT' ||
      context.experience === 'CONFLICT'
    )
      return 'RESTRICTED';
    if (context.pointArtifact) return 'MINIMAL';
    if (
      context.experience === 'BEGINNER' ||
      context.experience === 'UNKNOWN' ||
      context.limitedTime ||
      context.lowAdherence ||
      input.artifactType === WORKOUT_ARTIFACT_TYPE.SINGLE_SESSION ||
      input.artifactType === WORKOUT_ARTIFACT_TYPE.MOBILITY_SESSION ||
      input.artifactType === WORKOUT_ARTIFACT_TYPE.ACTIVE_RECOVERY_SESSION
    )
      return 'SIMPLE';
    if (
      context.experience === 'ADVANCED' &&
      context.modality.status === 'CONFIRMED' &&
      context.detailedArtifact
    )
      return 'ADVANCED';
    if (context.detailedArtifact) return 'DETAILED';
    return 'STANDARD';
  }

  private objectives(
    context: ReasoningContext,
  ): readonly WorkoutReasoningObjective[] {
    const objectives = new Set<WorkoutReasoningObjective>();
    if (context.safetyRestricted || context.hasLimitations)
      objectives.add(O.SAFETY);
    if (context.packageIds.has(P.HYPERTROPHY)) objectives.add(O.HYPERTROPHY);
    if (context.packageIds.has(P.STRENGTH)) objectives.add(O.STRENGTH);
    if (context.packageIds.has(P.MUSCULAR_ENDURANCE))
      objectives.add(O.MUSCULAR_ENDURANCE);
    if (context.packageIds.has(P.MAINTENANCE)) objectives.add(O.MAINTENANCE);
    if (
      context.packageIds.has(P.CARDIO_CONDITIONING) ||
      context.packageIds.has(P.CROSSFIT) ||
      context.packageIds.has(P.FUNCTIONAL)
    )
      objectives.add(O.CONDITIONING);
    if (
      context.packageIds.has(P.RUNNING_ENDURANCE) ||
      context.packageIds.has(P.WALKING) ||
      context.packageIds.has(P.CYCLING)
    )
      objectives.add(O.ENDURANCE);
    if (context.packageIds.has(P.MOBILITY)) objectives.add(O.MOBILITY);
    if (context.packageIds.has(P.ACTIVE_RECOVERY) || context.significantFatigue)
      objectives.add(O.ACTIVE_RECOVERY);
    if (context.lowAdherence || context.packageIds.has(P.ADHERENCE))
      objectives.add(O.ADHERENCE);
    objectives.add(O.EDUCATION);
    return Object.freeze(
      [...objectives].sort(
        (left, right) =>
          (left === O.SAFETY ? -1 : right === O.SAFETY ? 1 : 0) ||
          (left === context.explicitObjective
            ? -1
            : right === context.explicitObjective
              ? 1
              : 0) ||
          OBJECTIVE_ORDER[left] - OBJECTIVE_ORDER[right] ||
          left.localeCompare(right),
      ),
    );
  }

  private explicitObjective(
    snapshot: CoachProfileSnapshot,
  ): WorkoutReasoningObjective | null {
    const value = this.normalizedDatum(snapshot.nutrition.desiredOutcome)[0];
    if (!value) return null;
    if (value.includes('FORCA') || value.includes('STRENGTH'))
      return O.STRENGTH;
    if (value.includes('RESISTENCIA MUSCULAR')) return O.MUSCULAR_ENDURANCE;
    if (value.includes('HIPERTROFIA') || value.includes('MUSCLE'))
      return O.HYPERTROPHY;
    if (value.includes('CONDICIONAMENTO') || value.includes('CARDIO'))
      return O.CONDITIONING;
    if (value.includes('ENDURANCE') || value.includes('DISTANCIA'))
      return O.ENDURANCE;
    if (value.includes('MOBILIDADE')) return O.MOBILITY;
    if (value.includes('RECUPERACAO')) return O.ACTIVE_RECOVERY;
    return null;
  }

  private priorities(context: ReasoningContext): WorkoutReasoningPriorities {
    return Object.freeze({
      safety:
        context.safetyRestricted ||
        context.hasLimitations ||
        context.insufficientRecovery ||
        context.significantFatigue ||
        context.environmentIncompatible
          ? R.CRITICAL
          : R.HIGH,
      technique:
        context.experience === 'BEGINNER' || context.packageIds.has(P.CROSSFIT)
          ? R.CRITICAL
          : R.HIGH,
      adherence: context.lowAdherence
        ? R.CRITICAL
        : context.highAdherence
          ? R.LOW
          : context.packageIds.has(P.ADHERENCE)
            ? R.MEDIUM
            : R.LOW,
      motivation: context.packageIds.has(P.MOTIVATION)
        ? R.HIGH
        : context.lowAdherence
          ? R.MEDIUM
          : R.LOW,
      education:
        context.experience === 'UNKNOWN' || context.experience === 'BEGINNER'
          ? R.HIGH
          : R.MEDIUM,
      strength: context.packageIds.has(P.STRENGTH)
        ? R.HIGH
        : context.packageIds.has(P.RESISTANCE_TRAINING)
          ? R.MEDIUM
          : R.IGNORED,
      hypertrophy: context.packageIds.has(P.HYPERTROPHY) ? R.HIGH : R.IGNORED,
      endurance:
        context.packageIds.has(P.RUNNING_ENDURANCE) ||
        context.packageIds.has(P.CYCLING) ||
        context.packageIds.has(P.WALKING)
          ? R.HIGH
          : R.IGNORED,
      conditioning:
        context.packageIds.has(P.CARDIO_CONDITIONING) ||
        context.packageIds.has(P.CROSSFIT) ||
        context.packageIds.has(P.FUNCTIONAL)
          ? R.HIGH
          : R.IGNORED,
      mobility:
        context.packageIds.has(P.MOBILITY) || context.hasLimitations
          ? R.HIGH
          : R.LOW,
      recovery:
        context.significantFatigue ||
        context.insufficientRecovery ||
        context.returningAfterBreak
          ? R.CRITICAL
          : R.MEDIUM,
      progression:
        context.returningAfterBreak || context.safetyRestricted
          ? R.LOW
          : R.HIGH,
      practicality:
        context.limitedTime || context.lowAdherence ? R.CRITICAL : R.MEDIUM,
      equipment:
        context.noEquipment || context.environmentIncompatible
          ? R.CRITICAL
          : context.hasEquipment
            ? R.MEDIUM
            : R.HIGH,
      environment: context.environmentIncompatible
        ? R.CRITICAL
        : context.modality.status === 'UNKNOWN'
          ? R.HIGH
          : R.MEDIUM,
    });
  }

  private activeFactors(
    packages: readonly WorkoutKnowledgePackage[],
    decisions: readonly WorkoutKnowledgeDecision[],
  ): readonly WorkoutReasoningFactor[] {
    const result: WorkoutReasoningFactor[] = [];
    for (const knowledgePackage of packages) {
      const decision = decisions.find(
        (item) => item.packageId === knowledgePackage.id,
      );
      if (
        !decision ||
        decision.disposition === 'DISCARDED' ||
        decision.disposition === 'REDUCED'
      )
        continue;
      for (const item of knowledgePackage.positiveFactors)
        result.push(
          Object.freeze({
            packageId: knowledgePackage.id,
            factorCode: item.code,
            polarity: 'POSITIVE',
            priority: decision.resolvedPriority,
          }),
        );
      for (const item of knowledgePackage.negativeFactors)
        result.push(
          Object.freeze({
            packageId: knowledgePackage.id,
            factorCode: item.code,
            polarity: 'NEGATIVE',
            priority: decision.resolvedPriority,
          }),
        );
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
    packages: readonly WorkoutKnowledgePackage[],
    decisions: readonly WorkoutKnowledgeDecision[],
  ): readonly WorkoutDiscardedFactor[] {
    return Object.freeze(
      packages
        .flatMap((knowledgePackage) => {
          const decision = decisions.find(
            (item) => item.packageId === knowledgePackage.id,
          );
          if (
            !decision ||
            (decision.disposition !== 'DISCARDED' &&
              decision.disposition !== 'REDUCED')
          )
            return [];
          return [
            ...knowledgePackage.positiveFactors,
            ...knowledgePackage.negativeFactors,
          ].map((factor) =>
            Object.freeze({
              packageId: knowledgePackage.id,
              factorCode: factor.code,
              reasonCode:
                decision.disposition === 'DISCARDED'
                  ? 'PACKAGE_CONFLICT'
                  : 'PACKAGE_REDUCED',
            }),
          );
        })
        .sort((left, right) =>
          `${left.packageId}:${left.factorCode}`.localeCompare(
            `${right.packageId}:${right.factorCode}`,
          ),
        ),
    );
  }

  private constraints(
    packages: readonly WorkoutKnowledgePackage[],
  ): readonly WorkoutReasoningConstraint[] {
    const values = new Map<
      string,
      {
        readonly code: string;
        readonly enforcement: WorkoutReasoningConstraint['enforcement'];
        readonly sourcePackageIds: Set<WorkoutKnowledgePackageId>;
      }
    >();
    for (const knowledgePackage of packages) {
      for (const limit of knowledgePackage.limits) {
        const key = `${limit.enforcement}:${limit.code}`;
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

  private modalityDecision(
    input: WorkoutReasoningInput,
  ): WorkoutReasoningModalityDecision {
    const profile = this.profileModality(input.snapshot);
    if (!input.recognizedModality)
      return Object.freeze({
        requested: null,
        profile,
        resolved: null,
        status: 'UNKNOWN',
        requiresConfirmation: true,
      });
    if (profile && profile !== input.recognizedModality)
      return Object.freeze({
        requested: input.recognizedModality,
        profile,
        resolved: input.recognizedModality,
        status: 'CONFLICT',
        requiresConfirmation: true,
      });
    return Object.freeze({
      requested: input.recognizedModality,
      profile,
      resolved: input.recognizedModality,
      status: 'CONFIRMED',
      requiresConfirmation: false,
    });
  }

  private profileModality(
    snapshot: CoachProfileSnapshot,
  ): WorkoutModality | null {
    const values = this.normalizedDatum(snapshot.training.preferredModality);
    const value = values[0];
    if (!value) return null;
    const mappings: readonly (readonly [readonly string[], WorkoutModality])[] =
      [
        [
          ['GYM STRENGTH', 'MUSCULACAO', 'ACADEMIA'],
          WORKOUT_MODALITY.GYM_STRENGTH,
        ],
        [['HOME WORKOUT', 'TREINO EM CASA'], WORKOUT_MODALITY.HOME_WORKOUT],
        [['OUTDOOR WORKOUT', 'AO AR LIVRE'], WORKOUT_MODALITY.OUTDOOR_WORKOUT],
        [['CALISTHENICS', 'CALISTENIA'], WORKOUT_MODALITY.CALISTHENICS],
        [['FUNCTIONAL', 'FUNCIONAL'], WORKOUT_MODALITY.FUNCTIONAL],
        [['CROSSFIT', 'CROSS FIT'], WORKOUT_MODALITY.CROSSFIT],
        [['RUNNING', 'CORRIDA'], WORKOUT_MODALITY.RUNNING],
        [['WALKING', 'CAMINHADA'], WORKOUT_MODALITY.WALKING],
        [['CYCLING', 'CICLISMO', 'BIKE'], WORKOUT_MODALITY.CYCLING],
        [['MOBILITY', 'MOBILIDADE'], WORKOUT_MODALITY.MOBILITY],
        [
          ['CARDIO CONDITIONING', 'CARDIO', 'CONDICIONAMENTO'],
          WORKOUT_MODALITY.CARDIO_CONDITIONING,
        ],
        [
          ['ACTIVE RECOVERY', 'RECUPERACAO ATIVA'],
          WORKOUT_MODALITY.ACTIVE_RECOVERY,
        ],
        [
          ['GENERAL FITNESS', 'FITNESS GERAL'],
          WORKOUT_MODALITY.GENERAL_FITNESS,
        ],
      ];
    return (
      mappings.find(([tokens]) =>
        tokens.some((token) => value.includes(token)),
      )?.[1] ?? null
    );
  }

  private experience(
    snapshot: CoachProfileSnapshot,
  ): WorkoutExperienceDecision {
    if (
      snapshot.conflicts.some(
        (conflict) => conflict.field === 'TRAINING_EXPERIENCE',
      ) ||
      snapshot.training.experienceLevel.status === 'REQUIRES_CONFIRMATION'
    )
      return 'CONFLICT';
    const value = this.normalizedDatum(snapshot.training.experienceLevel)[0];
    if (value === 'BEGINNER' || value === 'INICIANTE') return 'BEGINNER';
    if (value === 'INTERMEDIATE' || value === 'INTERMEDIARIO')
      return 'INTERMEDIATE';
    if (value === 'ADVANCED' || value === 'AVANCADO') return 'ADVANCED';
    return 'UNKNOWN';
  }

  private environmentIncompatible(
    snapshot: CoachProfileSnapshot,
    modality: WorkoutModality | null,
    equipment: readonly string[],
  ): boolean {
    const environment = this.normalizedDatum(snapshot.training.environment)[0];
    if (!modality) return false;
    if (modality === WORKOUT_MODALITY.CROSSFIT)
      return (
        environment !== undefined &&
        !environment.includes('CROSSFIT') &&
        !environment.includes('BOX')
      );
    if (modality === WORKOUT_MODALITY.CYCLING)
      return !equipment.some((item) => this.normalize(item).includes('BIKE'));
    if (modality === WORKOUT_MODALITY.GYM_STRENGTH)
      return environment === 'NO EQUIPMENT';
    return false;
  }

  private contextStrings(
    snapshot: CoachProfileSnapshot,
    limitations: readonly CoachProfileConstraint[],
    medical: readonly CoachProfileConstraint[],
  ): readonly string[] {
    const values = [...limitations, ...medical].flatMap((item) => [
      item.type ?? '',
      item.description,
    ]);
    for (const datum of [
      snapshot.training.perceivedConditioning,
      snapshot.training.intensityPreference,
      snapshot.nutrition.desiredOutcome,
    ]) {
      const value = this.datumValue(datum);
      if (typeof value === 'string') values.push(value);
    }
    return Object.freeze(
      values.map((value) => this.normalize(value)).filter(Boolean),
    );
  }

  private containsAny(
    values: readonly string[],
    tokens: readonly string[],
  ): boolean {
    return values.some((value) =>
      tokens.some((token) => value.includes(this.normalize(token))),
    );
  }

  private hasSportObjective(context: ReasoningContext): boolean {
    return [
      P.HYPERTROPHY,
      P.STRENGTH,
      P.MUSCULAR_ENDURANCE,
      P.RUNNING_ENDURANCE,
      P.CYCLING,
      P.CROSSFIT,
      P.CARDIO_CONDITIONING,
    ].some((id) => context.packageIds.has(id));
  }

  private source(
    context: ReasoningContext,
    preferred: readonly WorkoutKnowledgePackageId[],
  ): WorkoutKnowledgePackageId {
    return (
      preferred.find((id) => context.packageIds.has(id)) ?? P.SAFETY_FOUNDATION
    );
  }

  private addStrategy(
    target: Map<WorkoutReasoningStrategy, StrategyAccumulator>,
    strategy: WorkoutReasoningStrategy,
    priority: Exclude<WorkoutReasoningPriority, 'IGNORED'>,
    packageId: WorkoutKnowledgePackageId,
    rationale: WorkoutReasoningRationaleCode = 'KNOWLEDGE_PRIORITY',
  ): void {
    const existing = target.get(strategy);
    if (existing) {
      if (PRIORITY_ORDER[priority] > PRIORITY_ORDER[existing.priority])
        existing.priority = priority;
      existing.sourcePackageIds.add(packageId);
      existing.rationaleCodes.add(rationale);
      return;
    }
    target.set(strategy, {
      strategy,
      priority,
      sourcePackageIds: new Set([packageId]),
      rationaleCodes: new Set([rationale]),
    });
  }

  private elevate(
    target: Map<WorkoutReasoningStrategy, StrategyAccumulator>,
    strategy: WorkoutReasoningStrategy,
    priority: Exclude<WorkoutReasoningPriority, 'IGNORED'>,
    packageId: WorkoutKnowledgePackageId,
  ): void {
    this.addStrategy(
      target,
      strategy,
      priority,
      packageId,
      'CONFLICT_RESOLUTION',
    );
  }

  private addProhibition(
    target: Map<WorkoutReasoningProhibition, ProhibitionAccumulator>,
    prohibition: WorkoutReasoningProhibition,
    packageId: WorkoutKnowledgePackageId,
    rationale: WorkoutReasoningRationaleCode = 'KNOWLEDGE_PRIORITY',
  ): void {
    const existing = target.get(prohibition);
    if (existing) {
      existing.sourcePackageIds.add(packageId);
      existing.rationaleCodes.add(rationale);
      return;
    }
    target.set(prohibition, {
      prohibition,
      sourcePackageIds: new Set([packageId]),
      rationaleCodes: new Set([rationale]),
    });
  }

  private conflict(
    target: WorkoutReasoningConflictResolution[],
    conflict: WorkoutReasoningConflict,
    packageIds: readonly WorkoutKnowledgePackageId[],
    elevatedStrategies: readonly WorkoutReasoningStrategy[],
    reducedStrategies: readonly WorkoutReasoningStrategy[],
    prohibitedStrategies: readonly WorkoutReasoningProhibition[],
  ): void {
    const rationaleCodes: readonly WorkoutReasoningRationaleCode[] =
      Object.freeze(['CONFLICT_RESOLUTION']);
    target.push(
      Object.freeze({
        conflict,
        packageIds: Object.freeze([...new Set(packageIds)].sort()),
        elevatedStrategies: Object.freeze([...elevatedStrategies].sort()),
        reducedStrategies: Object.freeze([...reducedStrategies].sort()),
        prohibitedStrategies: Object.freeze([...prohibitedStrategies].sort()),
        rationaleCodes,
      }),
    );
    target.sort((left, right) => left.conflict.localeCompare(right.conflict));
  }

  private freezeStrategies(
    values: ReadonlyMap<WorkoutReasoningStrategy, StrategyAccumulator>,
  ): readonly WorkoutSelectedStrategy[] {
    return Object.freeze(
      [...values.values()]
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
            rationaleCodes: Object.freeze([...item.rationaleCodes].sort()),
          }),
        ),
    );
  }

  private freezeProhibitions(
    values: ReadonlyMap<WorkoutReasoningProhibition, ProhibitionAccumulator>,
  ): readonly WorkoutProhibitedStrategy[] {
    return Object.freeze(
      [...values.values()]
        .sort((left, right) =>
          left.prohibition.localeCompare(right.prohibition),
        )
        .map((item) =>
          Object.freeze({
            prohibition: item.prohibition,
            sourcePackageIds: Object.freeze([...item.sourcePackageIds].sort()),
            rationaleCodes: Object.freeze([...item.rationaleCodes].sort()),
          }),
        ),
    );
  }

  private rationaleCodes(
    decisions: readonly WorkoutKnowledgeDecision[],
    strategies: readonly WorkoutSelectedStrategy[],
    prohibitions: readonly WorkoutProhibitedStrategy[],
    conflicts: readonly WorkoutReasoningConflictResolution[],
    progression: WorkoutProgressionDecision,
  ): readonly WorkoutReasoningRationaleCode[] {
    const values = new Set<WorkoutReasoningRationaleCode>();
    for (const item of decisions)
      for (const code of item.rationaleCodes) values.add(code);
    for (const item of strategies)
      for (const code of item.rationaleCodes) values.add(code);
    for (const item of prohibitions)
      for (const code of item.rationaleCodes) values.add(code);
    for (const item of conflicts)
      for (const code of item.rationaleCodes) values.add(code);
    values.add(
      progression === 'PROGRESS'
        ? 'PROGRESSION_ALLOWED'
        : 'PROGRESSION_BLOCKED',
    );
    return Object.freeze([...values].sort());
  }

  private normalizedDatum(datum: CoachProfileDatum<string>): readonly string[] {
    const value = this.datumValue(datum);
    return typeof value === 'string' && value.trim()
      ? Object.freeze([this.normalize(value)])
      : Object.freeze([]);
  }

  private datumValue<T>(datum: CoachProfileDatum<T>): T | undefined {
    return 'value' in datum ? datum.value : undefined;
  }

  private optionalDatumValue<T>(
    datum: CoachProfileDatum<T> | undefined,
  ): T | undefined {
    return datum ? this.datumValue(datum) : undefined;
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
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}
