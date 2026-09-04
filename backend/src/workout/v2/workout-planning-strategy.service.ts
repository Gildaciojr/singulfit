import { Injectable } from '@nestjs/common';
import {
  WORKOUT_ARTIFACT_TYPE,
  WORKOUT_MODALITY,
} from './workout-planning-artifact.contract';
import type { WorkoutPlanningContext } from './workout-planning-context.contract';
import type {
  WorkoutBlockType,
  WorkoutPersonalizationFactor,
  WorkoutPlanningStrategy,
} from './workout-planning-strategy.contract';

@Injectable()
export class WorkoutPlanningStrategyService {
  build(context: WorkoutPlanningContext): WorkoutPlanningStrategy {
    const factors: WorkoutPersonalizationFactor[] = ['MODALITY'];
    if (context.training.objective.status !== 'NOT_SET')
      factors.push('OBJECTIVE');
    if (
      context.training.secondaryObjectives.status !== 'NOT_SET' &&
      !factors.includes('OBJECTIVE')
    )
      factors.push('OBJECTIVE');
    if (context.training.experience.status !== 'NOT_SET')
      factors.push('EXPERIENCE');
    if (context.training.weeklyFrequency.status !== 'NOT_SET')
      factors.push('FREQUENCY');
    if (context.training.sessionDurationMinutes.status !== 'NOT_SET')
      factors.push('DURATION');
    if (context.training.environment.status !== 'NOT_SET')
      factors.push('ENVIRONMENT');
    if (context.training.equipment.status !== 'NOT_SET')
      factors.push('EQUIPMENT');
    if (context.movementConstraints.length > 0) factors.push('LIMITATIONS');
    if (context.training.perceivedConditioning.status !== 'NOT_SET')
      factors.push('CONDITIONING');
    if (context.training.intensityPreference.status !== 'NOT_SET')
      factors.push('INTENSITY_PREFERENCE');
    if (context.profile.sex.status !== 'NOT_SET') factors.push('SEX');
    if (context.training.muscleFocus.status !== 'NOT_SET')
      factors.push('MUSCLE_FOCUS');
    if (context.training.formatPreference.status !== 'NOT_SET')
      factors.push('FORMAT_PREFERENCE');
    if (context.training.availableTrainingDays.status !== 'NOT_SET')
      factors.push('AVAILABLE_TRAINING_DAYS');
    if (context.training.dailyTrainingWindows.status !== 'NOT_SET')
      factors.push('DAILY_TRAINING_WINDOWS');
    if (context.training.targetDistanceKm.status !== 'NOT_SET')
      factors.push('TARGET_DISTANCE');
    if (context.training.currentRunningDistanceKm.status !== 'NOT_SET')
      factors.push('CURRENT_RUNNING_DISTANCE');
    if (context.training.targetEventDate.status !== 'NOT_SET')
      factors.push('TARGET_EVENT_DATE');
    if (context.progressEvidence.length > 0) factors.push('PROGRESS_EVIDENCE');
    if (context.previousPlan) factors.push('PREVIOUS_PLAN');

    const experience = context.training.experience;
    const level =
      experience.status === 'NOT_SET' ? 'BEGINNER' : experience.value;
    const intensityLevel =
      context.training.intensityPreference.status === 'CONFIRMED'
        ? context.training.intensityPreference.value
        : level === 'ADVANCED'
          ? 'HIGH'
          : 'MODERATE';
    const [minimum, maximum] =
      intensityLevel === 'LIGHT'
        ? [3, 5]
        : intensityLevel === 'HIGH' && level !== 'BEGINNER'
          ? [6, 8]
          : [4, 7];
    const blocks = this.blocks(
      context.modality.status === 'NOT_SET'
        ? 'GENERAL_FITNESS'
        : context.modality.value,
      context.training.objective.status === 'NOT_SET'
        ? null
        : context.training.objective.value,
    );
    const technicalMovementsAllowed =
      level !== 'BEGINNER' &&
      context.training.experience.status === 'CONFIRMED';

    const modality =
      context.modality.status === 'NOT_SET'
        ? WORKOUT_MODALITY.GENERAL_FITNESS
        : context.modality.value;
    const sessionCount = this.sessionCount(context);
    return Object.freeze({
      schemaVersion: 2,
      artifactType: context.artifactType,
      modality,
      objective: Object.freeze({ ...context.training.objective }),
      secondaryObjectives:
        context.training.secondaryObjectives.status === 'NOT_SET'
          ? Object.freeze([])
          : Object.freeze([...context.training.secondaryObjectives.value]),
      experience: Object.freeze({ ...context.training.experience }),
      sessionCount,
      sessionFocuses: this.sessionFocuses(context, modality, sessionCount),
      recoveryGuidance: this.recoveryGuidance(context, modality, sessionCount),
      sessionDurationMinutes: Object.freeze({
        ...context.training.sessionDurationMinutes,
      }),
      environment: Object.freeze({ ...context.training.environment }),
      authorizedEquipment:
        context.training.equipment.status === 'NOT_SET'
          ? Object.freeze([])
          : Object.freeze([...context.training.equipment.value]),
      muscleFocus:
        context.training.muscleFocus.status === 'NOT_SET'
          ? Object.freeze([])
          : Object.freeze([...context.training.muscleFocus.value]),
      requiredBlocks: Object.freeze(blocks.required),
      optionalBlocks: Object.freeze(blocks.optional),
      maximumActivitiesPerSession:
        level === 'BEGINNER' ? 8 : level === 'INTERMEDIATE' ? 10 : 12,
      technicalMovementsAllowed,
      intensityPolicy: Object.freeze({
        scale: this.intensityScale(context),
        minimum,
        maximum,
        qualitativeLevel:
          intensityLevel === 'HIGH' && level === 'BEGINNER'
            ? 'MODERATE'
            : intensityLevel,
        exactLoadAllowed: false,
        exactPaceAllowed: false,
        exactPowerAllowed: false,
      }),
      progressionPolicy: Object.freeze({
        initialState:
          context.safetySignals.length > 0 ? 'REASSESS' : 'MAINTAIN',
        maximumWeeklyIncreasePercent: level === 'BEGINNER' ? 5 : 10,
        simultaneousVariablesAllowed: 1,
        requiresCompletedSessions: true,
        blocksOnSafetyFlag: true,
      }),
      appliedConstraints: Object.freeze(
        context.movementConstraints.map((constraint) =>
          Object.freeze({ ...constraint }),
        ),
      ),
      personalizationFactors: Object.freeze(factors),
    });
  }

  private sessionCount(context: WorkoutPlanningContext): number {
    if (
      context.artifactType === WORKOUT_ARTIFACT_TYPE.POINT_GUIDANCE ||
      context.artifactType === WORKOUT_ARTIFACT_TYPE.PLAN_REVIEW ||
      context.artifactType === WORKOUT_ARTIFACT_TYPE.CURRENT_PLAN_PRESENTATION
    )
      return 0;
    if (
      (context.artifactType === WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN ||
        context.artifactType === WORKOUT_ARTIFACT_TYPE.PLAN_ADAPTATION) &&
      context.training.weeklyFrequency.status !== 'NOT_SET'
    )
      return Math.min(7, context.training.weeklyFrequency.value);
    if (
      (context.artifactType === WORKOUT_ARTIFACT_TYPE.PLAN_ADAPTATION ||
        context.artifactType === WORKOUT_ARTIFACT_TYPE.EXERCISE_SUBSTITUTION) &&
      context.previousPlan
    ) {
      return context.previousPlan.sessionCount;
    }
    return 1;
  }

  private blocks(
    modality: WorkoutPlanningStrategy['modality'],
    objective: string | null,
  ): { required: WorkoutBlockType[]; optional: WorkoutBlockType[] } {
    if (
      modality === WORKOUT_MODALITY.RUNNING ||
      modality === WORKOUT_MODALITY.WALKING ||
      modality === WORKOUT_MODALITY.CYCLING
    ) {
      return {
        required: ['WARM_UP', 'ENDURANCE', 'COOLDOWN'],
        optional: ['INTERVAL', 'MOBILITY'],
      };
    }
    if (modality === WORKOUT_MODALITY.CROSSFIT) {
      return {
        required: ['WARM_UP', 'TECHNIQUE', 'CONDITIONING', 'COOLDOWN'],
        optional: ['STRENGTH', 'MOBILITY'],
      };
    }
    if (
      modality === WORKOUT_MODALITY.CARDIO_CONDITIONING ||
      ((modality === WORKOUT_MODALITY.HOME_WORKOUT ||
        modality === WORKOUT_MODALITY.FUNCTIONAL) &&
        objective === 'CONDITIONING')
    ) {
      return {
        required: ['WARM_UP', 'CONDITIONING', 'COOLDOWN'],
        optional: ['MOBILITY', 'CORE'],
      };
    }
    if (modality === WORKOUT_MODALITY.MOBILITY) {
      return { required: ['MOBILITY', 'RECOVERY'], optional: ['WARM_UP'] };
    }
    if (modality === WORKOUT_MODALITY.ACTIVE_RECOVERY) {
      return { required: ['RECOVERY', 'MOBILITY'], optional: ['COOLDOWN'] };
    }
    return {
      required: [
        'WARM_UP',
        objective === 'HYPERTROPHY' ? 'HYPERTROPHY' : 'STRENGTH',
        'COOLDOWN',
      ],
      optional: ['CORE', 'CONDITIONING', 'MOBILITY'],
    };
  }

  private intensityScale(
    context: WorkoutPlanningContext,
  ): WorkoutPlanningStrategy['intensityPolicy']['scale'] {
    const modality =
      context.modality.status === 'NOT_SET'
        ? WORKOUT_MODALITY.GENERAL_FITNESS
        : context.modality.value;
    if (
      modality === WORKOUT_MODALITY.RUNNING ||
      modality === WORKOUT_MODALITY.WALKING
    )
      return 'CONVERSATIONAL_PACE';
    if (
      modality === WORKOUT_MODALITY.CYCLING ||
      modality === WORKOUT_MODALITY.CARDIO_CONDITIONING
    )
      return 'RPE';
    return 'RPE';
  }

  private sessionFocuses(
    context: WorkoutPlanningContext,
    modality: WorkoutPlanningStrategy['modality'],
    count: number,
  ): readonly string[] {
    if (count < 1) return Object.freeze([]);
    if (modality === WORKOUT_MODALITY.GYM_STRENGTH) {
      return this.gymSessionFocuses(context, count);
    }
    if (modality === WORKOUT_MODALITY.CROSSFIT) {
      return this.crossfitSessionFocuses(context, count);
    }
    if (
      modality === WORKOUT_MODALITY.RUNNING ||
      modality === WORKOUT_MODALITY.WALKING
    ) {
      return this.runningSessionFocuses(context, count);
    }
    return Object.freeze(
      Array.from({ length: count }, (_, index) => `Sessão ${index + 1}`),
    );
  }

  private gymSessionFocuses(
    context: WorkoutPlanningContext,
    count: number,
  ): readonly string[] {
    const objective =
      context.training.objective.status === 'NOT_SET'
        ? null
        : context.training.objective.value;
    const experience =
      context.training.experience.status === 'NOT_SET'
        ? 'BEGINNER'
        : context.training.experience.value;
    const secondaryObjectives =
      context.training.secondaryObjectives.status === 'NOT_SET'
        ? []
        : context.training.secondaryObjectives.value;
    const equipment =
      context.training.equipment.status === 'NOT_SET'
        ? []
        : context.training.equipment.value;
    const shortSession =
      context.training.sessionDurationMinutes.status !== 'NOT_SET' &&
      context.training.sessionDurationMinutes.value <= 35;
    const limitedEquipment =
      equipment.length > 0 &&
      !equipment.some((item) =>
        ['BARBELL', 'MACHINE', 'CABLE', 'DUMBBELL'].includes(item),
      );
    const conservative = this.requiresConservativeDistribution(context);
    const muscleFocus =
      context.training.muscleFocus.status === 'NOT_SET'
        ? []
        : context.training.muscleFocus.value;
    let focuses: readonly string[];

    if (conservative || (experience === 'BEGINNER' && count >= 4)) {
      focuses = this.takeCycle(
        [
          'Corpo inteiro — técnica e controle',
          'Inferiores — base e estabilidade',
          'Superiores — base e estabilidade',
          'Corpo inteiro — volume moderado',
          'Mobilidade, core e condicionamento leve',
          'Corpo inteiro — consolidação técnica',
        ],
        count,
      );
    } else if (limitedEquipment) {
      focuses = this.takeCycle(
        [
          'Padrões de empurrar e core',
          'Padrões de agachar e locomover',
          'Padrões de puxar e estabilizar',
          'Corpo inteiro com equipamento disponível',
          'Unilateral e condicionamento',
          'Técnica e mobilidade ativa',
        ],
        count,
      );
    } else if (objective === 'STRENGTH') {
      focuses = this.takeCycle(
        [
          'Força — agachamento e complementares',
          'Força — empurrar e puxar superiores',
          'Força — hinge e cadeia posterior',
          'Técnica dos levantamentos principais',
          'Força — corpo inteiro e pontos fracos',
          'Potência controlada e acessórios',
        ],
        count,
      );
    } else if (
      objective === 'HYPERTROPHY' ||
      secondaryObjectives.includes('HYPERTROPHY')
    ) {
      focuses = this.hypertrophyFocuses(count, muscleFocus);
    } else {
      focuses = this.takeCycle(
        [
          'Corpo inteiro A',
          'Inferiores e core',
          'Superiores e postura',
          'Corpo inteiro B',
          'Condicionamento de força',
          'Mobilidade e força complementar',
        ],
        count,
      );
    }

    return Object.freeze(
      focuses.map((focus) =>
        shortSession ? `${focus} — seleção essencial` : focus,
      ),
    );
  }

  private hypertrophyFocuses(
    count: number,
    muscleFocus: readonly string[],
  ): readonly string[] {
    const explicitFocus = muscleFocus[0];
    if (explicitFocus === 'GLUTES') {
      return this.takeCycle(
        [
          'Superiores — empurrar e puxar',
          'Glúteos prioritários e quadríceps',
          'Superiores e core',
          'Posteriores e estabilidade do quadril',
          'Glúteos complementares e inferiores',
          'Corpo inteiro com volume moderado',
        ],
        count,
      );
    }
    if (explicitFocus === 'CHEST') {
      return this.takeCycle(
        [
          'Peito prioritário e tríceps',
          'Inferiores A',
          'Costas, bíceps e postura',
          'Peito complementar e ombros',
          'Inferiores B e core',
          'Puxar e braços complementares',
        ],
        count,
      );
    }
    const focusLabel = explicitFocus
      ? this.muscleFocusLabel(explicitFocus)
      : null;
    const base = [
      'Superiores A',
      'Inferiores A',
      'Empurrar e braços',
      'Puxar e cadeia posterior',
      focusLabel
        ? `${focusLabel} prioritário e complementares`
        : 'Corpo inteiro complementar',
      'Inferiores B e core',
    ];
    return this.takeCycle(base, count);
  }

  private crossfitSessionFocuses(
    context: WorkoutPlanningContext,
    count: number,
  ): readonly string[] {
    const experience =
      context.training.experience.status === 'NOT_SET'
        ? 'BEGINNER'
        : context.training.experience.value;
    const conditioning =
      context.training.perceivedConditioning.status === 'NOT_SET'
        ? null
        : context.training.perceivedConditioning.value;
    const conservative = this.requiresConservativeDistribution(context);
    const cycle =
      conservative || experience === 'BEGINNER' || conditioning === 'LOW'
        ? [
            'Fundamentos, mobilidade e scaling',
            'Técnica básica e WOD curto controlado',
            'Força técnica com cargas moderadas',
            'Base aeróbica e movimentos simples',
            'Skill fundamental sem fadiga alta',
            'WOD leve e recuperação ativa',
          ]
        : experience === 'ADVANCED' && conditioning === 'HIGH'
          ? [
              'Levantamento técnico e força',
              'Skill avançada e intervalos intensos',
              'WOD misto com estratégia de ritmo',
              'Força máxima e acessórios',
              'Capacidade aeróbica prolongada',
              'Ginástica, potência e WOD curto',
            ]
          : [
              'Técnica e WOD moderado',
              'Força e condicionamento',
              'Skill com scaling individual',
              'Capacidade aeróbica',
              'Potência técnica e core',
              'WOD misto controlado',
            ];
    return this.takeCycle(cycle, count);
  }

  private runningSessionFocuses(
    context: WorkoutPlanningContext,
    count: number,
  ): readonly string[] {
    const experience =
      context.training.experience.status === 'NOT_SET'
        ? 'BEGINNER'
        : context.training.experience.value;
    const conditioning =
      context.training.perceivedConditioning.status === 'NOT_SET'
        ? null
        : context.training.perceivedConditioning.value;
    const currentDistance =
      context.training.currentRunningDistanceKm.status === 'NOT_SET'
        ? null
        : context.training.currentRunningDistanceKm.value;
    const targetDistance =
      context.training.targetDistanceKm.status === 'NOT_SET'
        ? null
        : context.training.targetDistanceKm.value;
    const objective =
      context.training.objective.status === 'NOT_SET'
        ? null
        : context.training.objective.value;
    const beginner =
      experience === 'BEGINNER' ||
      conditioning === 'LOW' ||
      currentDistance === null ||
      this.requiresConservativeDistribution(context);
    const cycle = beginner
      ? [
          'Run/walk leve e técnica',
          'Base aeróbica com progressão curta',
          'Corrida contínua confortável ou caminhada',
          'Mobilidade e recuperação ativa',
          'Run/walk progressivo sem pace prescrito',
          'Resistência leve e técnica',
        ]
      : objective === 'COMPLETE_DISTANCE' && targetDistance !== null
        ? [
            'Corrida leve e técnica',
            'Intervalos controlados',
            `Ritmo sustentável para progressão até ${targetDistance} km`,
            'Recuperação ativa',
            'Tempo run controlado',
            'Longo progressivo por percepção de esforço',
          ]
        : [
            'Corrida leve e técnica',
            'Intervalos por percepção de esforço',
            'Contínuo moderado',
            'Recuperação ativa',
            'Fartlek controlado',
            'Resistência aeróbica',
          ];
    return this.takeCycle(cycle, count);
  }

  private requiresConservativeDistribution(
    context: WorkoutPlanningContext,
  ): boolean {
    const returning =
      context.training.returningAfterBreak.status !== 'NOT_SET' &&
      context.training.returningAfterBreak.value;
    const lowConditioning =
      context.training.perceivedConditioning.status !== 'NOT_SET' &&
      context.training.perceivedConditioning.value === 'LOW';
    const constrained = context.movementConstraints.some(
      (constraint) => constraint.status !== 'INFERRED',
    );
    const insufficientAvailability =
      context.training.availableTrainingDays.status !== 'NOT_SET' &&
      context.training.availableTrainingDays.value.length <
        this.sessionCount(context);
    const recoveryEvidence = context.progressEvidence.some(
      (evidence) =>
        (evidence.adherenceScore !== null && evidence.adherenceScore < 45) ||
        (evidence.perceivedEffort !== null && evidence.perceivedEffort >= 9),
    );
    return Boolean(
      returning ||
      lowConditioning ||
      constrained ||
      insufficientAvailability ||
      recoveryEvidence,
    );
  }

  private takeCycle(
    values: readonly string[],
    count: number,
  ): readonly string[] {
    return Object.freeze(
      Array.from(
        { length: count },
        (_, index) =>
          values[index % values.length] +
          (index >= values.length ? ` ${index + 1}` : ''),
      ),
    );
  }

  private muscleFocusLabel(focus: string): string {
    const labels: Readonly<Record<string, string>> = Object.freeze({
      BACK: 'Costas',
      SHOULDERS: 'Ombros',
      BICEPS: 'Bíceps',
      TRICEPS: 'Tríceps',
      ARMS: 'Braços',
      CORE: 'Core',
      QUADRICEPS: 'Quadríceps',
      HAMSTRINGS: 'Posteriores',
      CALVES: 'Panturrilhas',
      LOWER_BODY: 'Inferiores',
      UPPER_BODY: 'Superiores',
      FULL_BODY: 'Corpo inteiro',
    });
    return labels[focus] ?? focus;
  }

  private recoveryGuidance(
    context: WorkoutPlanningContext,
    modality: WorkoutPlanningStrategy['modality'],
    count: number,
  ): string {
    if (
      count >= 6 &&
      (modality === WORKOUT_MODALITY.GYM_STRENGTH ||
        modality === WORKOUT_MODALITY.CROSSFIT)
    )
      return 'Distribuir no horizonte semanal com pelo menos uma janela completa de descanso e sem repetir estímulo intenso do mesmo grupo em dias consecutivos.';
    if (this.requiresConservativeDistribution(context))
      return 'Retomar com distribuição conservadora, intensidade controlada e recuperação entre estímulos semelhantes; progredir somente com tolerância confirmada.';
    return 'Distribuir estímulos e recuperação conforme intensidade, experiência e dias confirmados; dias não confirmados são apenas sugestões.';
  }
}
