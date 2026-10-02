import {
  declaredWorkoutEnvironment,
  declaredWorkoutFrequency,
  declaredWorkoutProfileFacts,
} from './workout-declared-profile-facts';
import { workoutEquipmentBaseline } from './workout-equipment-defaults';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { CurrentWorkoutPlanReaderService } from './current-workout-plan-reader.service';
import { isFullPlanReplacementRequest } from '../../conversation/understanding/full-plan-replacement.policy';
import { CoachProfileSnapshotBuilder } from '../../context/coach-profile-snapshot.builder';
import type {
  CoachProfileDatum,
  CoachProfileSnapshot,
} from '../../context/coach-profile-snapshot.contract';
import {
  CONVERSATION_GOAL,
  CONVERSATION_RECOGNIZED_INTENT,
  type ConversationGoalDecision,
} from '../../context/conversation-goal-planner.contract';
import { PrismaService } from '../../prisma/prisma.service';
import {
  WORKOUT_ARTIFACT_TYPE,
  WORKOUT_MODALITY,
  type WorkoutModality,
  type WorkoutSafetyFlag,
} from './workout-planning-artifact.contract';
import type {
  WorkoutEquipment,
  WorkoutExperienceLevel,
  WorkoutMovementConstraint,
  WorkoutMuscleFocus,
  WorkoutObjective,
  WorkoutPlanningValue,
  WorkoutProgressEvidence,
  WorkoutRecognizedContext,
} from './workout-planning-context.contract';
import type { GenerateWorkoutPlanV2Input } from './workout-planning-generation.contract';
import type { WorkoutPlanV2 } from './workout-plan-v2.contract';

export interface GenerateWorkoutPlanV2InputSource {
  readonly userId: string;
  readonly profileId?: string;
  readonly decision?: ConversationGoalDecision;
  readonly recognizedContext?: WorkoutRecognizedContext;
  readonly declaredContext?: WorkoutRecognizedContext;
  readonly snapshot?: CoachProfileSnapshot;
  readonly referenceDate: Date;
  readonly currentMessage?: string;
  readonly progressEvidence?: readonly WorkoutProgressEvidence[];
  readonly previousPlan?: WorkoutPlanV2;
}

export interface BuiltWorkoutPlanV2Input {
  readonly generationInput: GenerateWorkoutPlanV2Input;
  readonly profileId: string;
}

@Injectable()
export class GenerateWorkoutPlanV2InputBuilder {
  constructor(
    private readonly snapshotBuilder: CoachProfileSnapshotBuilder,
    private readonly prisma: PrismaService,
    @Optional()
    private readonly previousPlanReader?: CurrentWorkoutPlanReaderService,
  ) {}

  async build(
    source: GenerateWorkoutPlanV2InputSource,
  ): Promise<BuiltWorkoutPlanV2Input> {
    const [snapshot, profileId] = await Promise.all([
      source.snapshot ??
        this.snapshotBuilder.build(source.userId, source.referenceDate),
      source.profileId
        ? Promise.resolve(source.profileId)
        : this.profileId(source.userId),
    ]);
    const decision = this.generationDecision(source.decision, snapshot);
    const history = await this.history(source, profileId);
    const recognizedContext = this.recognizedContext(
      source.recognizedContext,
      snapshot,
      source.declaredContext ??
        this.recognizeDeclaredContext(source.currentMessage),
    );

    return Object.freeze({
      profileId,
      generationInput: Object.freeze({
        userId: source.userId,
        decision,
        recognizedContext:
          recognizedContext.purpose === 'REPLACEMENT' && !history.previousPlan
            ? Object.freeze({
                ...recognizedContext,
                purpose: 'CREATION' as const,
              })
            : recognizedContext,
        snapshot,
        referenceDate: source.referenceDate,
        progressEvidence: history.progressEvidence,
        previousPlan: history.previousPlan,
      }),
    });
  }

  recognizeDeclaredContext(
    message: string | undefined,
  ): WorkoutRecognizedContext {
    return this.declaredContext(message);
  }

  private async history(
    source: GenerateWorkoutPlanV2InputSource,
    profileId: string,
  ): Promise<
    Pick<GenerateWorkoutPlanV2Input, 'previousPlan' | 'progressEvidence'>
  > {
    if (!this.previousPlanReader) {
      if (source.previousPlan || source.progressEvidence?.length)
        throw new BadRequestException(
          'Histórico Workout sem reader de ownership',
        );
      return {};
    }
    const cutoff = new Date(
      source.referenceDate.getTime() - 56 * 24 * 60 * 60 * 1000,
    );
    const [previous, observations] = await Promise.all([
      this.previousPlanReader.readPrevious(source.userId, source.referenceDate),
      this.prisma.fitnessCheckIn.findMany({
        where: {
          userId: source.userId,
          profileId,
          profile: { userId: source.userId },
          createdAt: { gte: cutoff, lte: source.referenceDate },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 12,
        select: {
          userId: true,
          profileId: true,
          adherenceScore: true,
          energyLevel: true,
          notes: true,
          createdAt: true,
        },
      }),
    ]);
    const previousPlan =
      previous?.userId === source.userId ? previous.document : undefined;
    if (
      source.previousPlan &&
      (!previousPlan ||
        source.previousPlan.generationMetadata.aiJobId !==
          previousPlan.generationMetadata.aiJobId)
    )
      throw new BadRequestException(
        'Plano anterior Workout não corresponde ao usuário/histórico canônico',
      );
    const progressEvidence = observations
      .filter(
        (item) =>
          item.userId === source.userId &&
          item.profileId === profileId &&
          item.createdAt >= cutoff &&
          item.createdAt <= source.referenceDate &&
          Number.isInteger(item.adherenceScore) &&
          item.adherenceScore >= 0 &&
          item.adherenceScore <= 100,
      )
      .map((item) =>
        Object.freeze({
          source: 'FITNESS_CHECK_IN' as const,
          observedAt: item.createdAt.toISOString(),
          adherenceScore: item.adherenceScore,
          ...(item.energyLevel ? { energyLevel: item.energyLevel } : {}),
          ...(item.notes ? { feedback: item.notes } : {}),
          perceivedEffort: null,
          completedSessions: null,
          expectedSessions: null,
        }),
      )
      .sort((left, right) => left.observedAt.localeCompare(right.observedAt));
    return {
      previousPlan,
      progressEvidence: progressEvidence.length
        ? Object.freeze(progressEvidence)
        : undefined,
    };
  }

  private async profileId(userId: string): Promise<string> {
    const profile = await this.prisma.fitnessProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) {
      throw new NotFoundException(
        'Complete o perfil fitness antes de gerar um treino',
      );
    }
    return profile.id;
  }

  private generationDecision(
    decision: ConversationGoalDecision | undefined,
    snapshot: CoachProfileSnapshot,
  ): ConversationGoalDecision {
    if (decision) {
      return decision;
    }
    return Object.freeze({
      recognizedIntent: CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_REQUEST,
      goal: CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN,
      reason: 'WORKOUT_PROFILE_READY' as const,
      targetPlan: 'WORKOUT' as const,
      profileCompletionState: snapshot.completion.overall,
      canExecute: true,
      confidence: 'HIGH' as const,
      selectedProfileField: null,
      metPreconditions: Object.freeze([]),
      missingPreconditions: Object.freeze([]),
      pendingDependencies: Object.freeze([]),
    });
  }

  private recognizedContext(
    current: WorkoutRecognizedContext | undefined,
    snapshot: CoachProfileSnapshot,
    declared: WorkoutRecognizedContext,
  ): WorkoutRecognizedContext {
    const storedEquipment = snapshot.training.availableEquipment;
    const storedEnvironment = snapshot.training.environment;
    const declaredEnvironment =
      declared.environment && 'value' in declared.environment
        ? declared.environment.value
        : undefined;
    const currentEnvironment =
      current?.environment && 'value' in current.environment
        ? current.environment.value
        : undefined;
    const preserveLimitedGym =
      declaredEnvironment === 'FULL_GYM' &&
      ((storedEnvironment &&
        'value' in storedEnvironment &&
        storedEnvironment.value === 'LIMITED_GYM') ||
        currentEnvironment === 'LIMITED_GYM');
    const environmentChanged =
      !preserveLimitedGym &&
      declaredEnvironment !== undefined &&
      declaredEnvironment !==
        (storedEnvironment && 'value' in storedEnvironment
          ? storedEnvironment.value
          : currentEnvironment);
    const equipment =
      declared.equipment?.status === 'INFERRED'
        ? environmentChanged
          ? currentEnvironment === declaredEnvironment
            ? (current?.equipment ?? declared.equipment)
            : declared.equipment
          : (current?.equipment ??
            (preserveLimitedGym ||
            (storedEquipment && storedEquipment.status !== 'UNKNOWN')
              ? undefined
              : declared.equipment))
        : (declared.equipment ?? current?.equipment);
    return this.resolveFrequencyAvailabilityConflict({
      ...current,
      ...Object.fromEntries(
        Object.entries(declared).filter(([, value]) => value !== undefined),
      ),
      equipment,
      environment: preserveLimitedGym
        ? current?.environment
        : (declared.environment ?? current?.environment),
      artifactType:
        declared.artifactType ??
        current?.artifactType ??
        WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
      modality:
        declared.modality ??
        current?.modality ??
        this.modality(snapshot.training.preferredModality),
      movementConstraints: Object.freeze([
        ...(current?.movementConstraints ?? []),
        ...(declared.movementConstraints ?? []),
      ]),
      safetySignals: Object.freeze([
        ...new Set([
          ...(current?.safetySignals ?? []),
          ...(declared.safetySignals ?? []),
        ]),
      ]),
      purpose: declared.purpose ?? current?.purpose ?? 'CREATION',
      previousPlanPolicy:
        declared.previousPlanPolicy ??
        current?.previousPlanPolicy ??
        'CONTEXT_ONLY',
    });
  }

  private declaredContext(
    message: string | undefined,
  ): WorkoutRecognizedContext {
    if (!message?.trim()) return Object.freeze({});
    const text = this.normalize(message);
    const equipmentScope = declaredWorkoutProfileFacts(text).equipmentScope;
    const modality = this.declaredModality(text);
    const environment = declaredWorkoutEnvironment(text);
    const experience = this.declaredExperience(text);
    const objective = this.declaredObjective(text);
    const objectives = this.declaredObjectives(text);
    const muscleFocus = this.declaredMuscleFocus(text);
    const distances = this.runningDistances(text);
    const targetEventDate = this.declaredEventDate(text);
    const frequency = declaredWorkoutFrequency(text);
    const duration = this.integer(
      text,
      /\b(\d{1,3})\s*(?:minutos?|min)\b/u,
      10,
      240,
    );
    const safetySignals = this.safetySignals(text);
    const movementConstraints = this.movementConstraints(text);

    return this.resolveFrequencyAvailabilityConflict({
      modality: modality
        ? Object.freeze({ status: 'CONFIRMED' as const, value: modality })
        : undefined,
      environment: environment
        ? Object.freeze({ status: 'CONFIRMED' as const, value: environment })
        : undefined,
      previousPlanPolicy:
        /\b(?:completamente diferente|totalmente diferente|do zero)\b/u.test(
          text,
        )
          ? 'REPLACE_FREELY'
          : undefined,
      purpose: isFullPlanReplacementRequest(text) ? 'REPLACEMENT' : undefined,
      experience: experience
        ? Object.freeze({ status: 'CONFIRMED' as const, value: experience })
        : undefined,
      objective: objective
        ? Object.freeze({ status: 'CONFIRMED' as const, value: objective })
        : undefined,
      secondaryObjectives:
        objectives.length > 1
          ? Object.freeze({
              status: 'CONFIRMED' as const,
              value: Object.freeze(objectives.slice(1)),
            })
          : undefined,
      weeklyFrequency:
        frequency === null
          ? undefined
          : Object.freeze({
              status: 'CONFIRMED' as const,
              value: frequency,
            }),
      sessionDurationMinutes:
        duration === null
          ? undefined
          : Object.freeze({ status: 'CONFIRMED' as const, value: duration }),
      availableTrainingDays: this.declaredTrainingDays(text),
      equipment:
        this.declaredEquipment(equipmentScope.text) ??
        (equipmentScope.restricted
          ? undefined
          : workoutEquipmentBaseline(environment)),
      muscleFocus:
        muscleFocus.length > 0
          ? Object.freeze({
              status: 'CONFIRMED' as const,
              value: muscleFocus,
            })
          : undefined,
      targetDistanceKm:
        distances.target === null
          ? undefined
          : Object.freeze({
              status: 'CONFIRMED' as const,
              value: distances.target,
            }),
      currentRunningDistanceKm:
        distances.current === null
          ? undefined
          : Object.freeze({
              status: 'CONFIRMED' as const,
              value: distances.current,
            }),
      targetEventDate: targetEventDate
        ? Object.freeze({
            status: 'CONFIRMED' as const,
            value: targetEventDate,
          })
        : undefined,
      movementConstraints,
      safetySignals,
    });
  }

  private resolveFrequencyAvailabilityConflict(
    context: WorkoutRecognizedContext,
  ): WorkoutRecognizedContext {
    const frequency = context.weeklyFrequency;
    const days = context.availableTrainingDays;
    if (
      frequency?.status === 'CONFIRMED' &&
      days?.status === 'CONFIRMED' &&
      days.value.length < frequency.value
    ) {
      return Object.freeze({
        ...context,
        weeklyFrequency: Object.freeze({
          status: 'REQUIRES_CONFIRMATION' as const,
          value: frequency.value,
        }),
      });
    }
    return Object.freeze(context);
  }

  private modality(
    datum: CoachProfileDatum<string>,
  ): WorkoutPlanningValue<WorkoutModality> {
    if (!('value' in datum)) return Object.freeze({ status: 'NOT_SET' });
    const value = Object.values(WORKOUT_MODALITY).find(
      (candidate) => candidate === datum.value,
    );
    if (!value) return Object.freeze({ status: 'NOT_SET' });
    return Object.freeze({ status: this.status(datum.status), value });
  }

  private declaredModality(text: string): WorkoutModality | undefined {
    if (/\bcrossfit\b/u.test(text)) return WORKOUT_MODALITY.CROSSFIT;
    if (/\b(musculacao|academia)\b/u.test(text))
      return WORKOUT_MODALITY.GYM_STRENGTH;
    if (
      /\b(corrida|correr|corro|comecar a correr)\b/u.test(text) ||
      /\b(?:prova de|preparar para)\s*\d+(?:[.,]\d+)?\s*km\b/u.test(text)
    )
      return WORKOUT_MODALITY.RUNNING;
    if (/\b(caminhada|caminhar)\b/u.test(text)) return WORKOUT_MODALITY.WALKING;
    if (/\b(bike|ciclismo|pedalar)\b/u.test(text))
      return WORKOUT_MODALITY.CYCLING;
    if (/\b(cardio|aerobico|aerobica)\b/u.test(text))
      return WORKOUT_MODALITY.CARDIO_CONDITIONING;
    if (/\b(funcional|treino funcional)\b/u.test(text))
      return WORKOUT_MODALITY.FUNCTIONAL;
    if (/\bcalistenia\b/u.test(text)) return WORKOUT_MODALITY.CALISTHENICS;
    if (/\bmobilidade\b/u.test(text)) return WORKOUT_MODALITY.MOBILITY;
    if (/\b(em casa|treino em casa|home workout|peso corporal)\b/u.test(text))
      return WORKOUT_MODALITY.HOME_WORKOUT;
    return undefined;
  }

  private declaredExperience(text: string): WorkoutExperienceLevel | undefined {
    if (/\b(iniciante|comecando|nunca treinei)\b/u.test(text))
      return 'BEGINNER';
    if (/\b(intermediario|intermediaria)\b/u.test(text)) return 'INTERMEDIATE';
    if (/\b(avancado|avancada)\b/u.test(text)) return 'ADVANCED';
    return undefined;
  }

  private declaredObjective(text: string): WorkoutObjective | undefined {
    if (
      /\b(hipertrofia|ganhar massa|ganho de massa|massa magra|massa muscular)\b/u.test(
        text,
      )
    )
      return 'HYPERTROPHY';
    if (/\b(forca|ficar mais forte)\b/u.test(text)) return 'STRENGTH';
    if (
      /\b(emagrecer|perder peso|perder gordura|reducao de gordura)\b/u.test(
        text,
      )
    )
      return 'WEIGHT_LOSS';
    if (
      /\b(cardio|aerobico|aerobica|condicionamento|comecar a correr)\b/u.test(
        text,
      )
    )
      return 'CONDITIONING';
    if (/\b(mobilidade)\b/u.test(text)) return 'MOBILITY';
    if (/\b(recuperacao ativa)\b/u.test(text)) return 'ACTIVE_RECOVERY';
    if (/\b(saude|qualidade de vida|bem-estar|bem estar)\b/u.test(text))
      return 'GENERAL_HEALTH';
    return this.runningDistances(text).target === null
      ? undefined
      : 'COMPLETE_DISTANCE';
  }

  private declaredObjectives(text: string): readonly WorkoutObjective[] {
    const objectives: WorkoutObjective[] = [];
    const add = (objective: WorkoutObjective): void => {
      if (!objectives.includes(objective)) objectives.push(objective);
    };
    if (
      /\b(hipertrofia|ganhar massa|ganho de massa|massa magra|massa muscular)\b/u.test(
        text,
      )
    )
      add('HYPERTROPHY');
    if (
      /\b(emagrecer|perder peso|perder gordura|reducao de gordura)\b/u.test(
        text,
      )
    )
      add('WEIGHT_LOSS');
    if (/\b(forca|ficar mais forte)\b/u.test(text)) add('STRENGTH');
    if (/\b(condicionamento|melhorar o cardio)\b/u.test(text))
      add('CONDITIONING');
    if (/\brecuperacao ativa\b/u.test(text)) add('ACTIVE_RECOVERY');
    if (/\b(saude|qualidade de vida|bem-estar|bem estar)\b/u.test(text))
      add('GENERAL_HEALTH');
    return Object.freeze(objectives);
  }

  private declaredTrainingDays(
    text: string,
  ): WorkoutPlanningValue<readonly string[]> | undefined {
    const weekdays: Array<readonly [string, RegExp]> = [
      ['MONDAY', /\bsegunda(?:-feira)?\b/u],
      ['TUESDAY', /\bterca(?:-feira)?\b/u],
      ['WEDNESDAY', /\bquarta(?:-feira)?\b/u],
      ['THURSDAY', /\bquinta(?:-feira)?\b/u],
      ['FRIDAY', /\bsexta(?:-feira)?\b/u],
      ['SATURDAY', /\bsabado\b/u],
      ['SUNDAY', /\bdomingo\b/u],
    ];
    const positive = new Set<string>();
    const denied = new Set<string>();
    let mentioned = false;
    for (const clause of this.declarationClauses(text)) {
      const uncertain =
        /\b(talvez|acho que|nao sei se|possivelmente|provavelmente|depende|ou)\b/u.test(
          clause,
        );
      const negative =
        /\b(nao posso|nao consigo|nao treino|indisponivel|sem disponibilidade|menos|exceto)\b/u.test(
          clause,
        );
      const available =
        /\b(posso|consigo treinar|treino|disponivel|tenho disponibilidade|da para treinar)\b/u.test(
          clause,
        );
      for (const [weekday, pattern] of weekdays) {
        if (!pattern.test(clause)) continue;
        mentioned = true;
        if (negative) denied.add(weekday);
        else if (available && !uncertain) positive.add(weekday);
      }
    }
    const values = weekdays
      .map(([weekday]) => weekday)
      .filter((weekday) => positive.has(weekday) && !denied.has(weekday));
    if (values.length > 0) {
      return Object.freeze({
        status: 'CONFIRMED' as const,
        value: Object.freeze(values),
      });
    }
    return mentioned
      ? Object.freeze({
          status: 'REQUIRES_CONFIRMATION' as const,
          value: Object.freeze([]),
        })
      : undefined;
  }

  private declaredEquipment(
    text: string,
  ): WorkoutPlanningValue<readonly WorkoutEquipment[]> | undefined {
    const terms: Array<readonly [WorkoutEquipment, RegExp]> = [
      ['DUMBBELL', /\b(halteres?|dumbbells?)\b/u],
      ['RESISTANCE_BAND', /\b(elastico|faixa elastica|resistance band)\b/u],
      ['KETTLEBELL', /\bkettlebell\b/u],
      ['PULL_UP_BAR', /\bbarra fixa\b/u],
      ['BARBELL', /\bbarra(?! fixa)(?: olimpica)?\b/u],
      ['MACHINE', /\b(maquinas?|aparelhos?)\b/u],
      ['CABLE', /\b(cabos?|polia)\b/u],
      ['BENCH', /\bbanco\b/u],
      ['BODYWEIGHT', /\b(peso corporal|sem carga)\b/u],
      ['TREADMILL', /\besteira\b/u],
      ['ROW_ERGOMETER', /\b(remo|ergometro)\b/u],
    ];
    const positive = new Set<WorkoutEquipment>();
    const denied = new Set<WorkoutEquipment>();
    const noEquipment =
      /\b(?:sem (?:equipamentos?|aparelhos?)|(?:nao tenho )?nenhum (?:equipamento|aparelho)|nao tenho aparelhos?(?: de academia)?)\b/u.test(
        text,
      );
    let mentioned = false;
    for (const clause of this.declarationClauses(text)) {
      const uncertain =
        /\b(talvez|acho que|nao sei se|possivelmente|provavelmente)\b/u.test(
          clause,
        );
      const negative =
        /\b(nao tenho|nao tem|nao uso|nao ha|indisponivel|sem|falta)\b/u.test(
          clause,
        );
      const available =
        /\b(tenho|temos|uso|utilizo|com|disponivel|disponiveis|acesso a|conto com|so)\b/u.test(
          clause,
        );
      for (const [equipment, pattern] of terms) {
        if (!pattern.test(clause)) continue;
        mentioned = true;
        if (negative) denied.add(equipment);
        else if (available && !uncertain) positive.add(equipment);
      }
    }
    const equipment = terms
      .map(([value]) => value)
      .filter((value) => positive.has(value) && !denied.has(value));
    if (equipment.length === 0) {
      if (noEquipment) {
        return Object.freeze({
          status: 'CONFIRMED' as const,
          value: Object.freeze(['BODYWEIGHT' as const]),
        });
      }
      return mentioned
        ? Object.freeze({
            status: 'REQUIRES_CONFIRMATION' as const,
            value: Object.freeze([]),
          })
        : undefined;
    }
    if (/\b(em casa|casa)\b/u.test(text) && !denied.has('BODYWEIGHT'))
      equipment.push('BODYWEIGHT');
    return Object.freeze({
      status: 'CONFIRMED' as const,
      value: Object.freeze([...new Set(equipment)]),
    });
  }

  private declarationClauses(text: string): readonly string[] {
    return Object.freeze(
      text
        .split(
          /[.;!?]+|\bmas\b|\bporem\b|\be\s+(?=nao\b)|,\s*(?=(?:nao|so(?: tenho)?|tenho|menos|exceto|posso|consigo)\b)|(?=\bmenos\b)|(?=\bexceto\b)|(?=\bsem\b)/u,
        )
        .map((clause) => clause.trim())
        .filter(Boolean),
    );
  }

  private declaredMuscleFocus(text: string): readonly WorkoutMuscleFocus[] {
    const matches: Array<readonly [WorkoutMuscleFocus, RegExp]> = [
      ['CHEST', /\bpeito\b/u],
      ['BACK', /\bcostas\b/u],
      ['SHOULDERS', /\b(ombros?|deltoides?)\b/u],
      ['BICEPS', /\bbiceps\b/u],
      ['TRICEPS', /\btriceps\b/u],
      ['ARMS', /\bbracos?\b/u],
      ['CORE', /\b(core|abdomen|abdominal)\b/u],
      ['GLUTES', /\b(gluteos?|bumbum)\b/u],
      ['QUADRICEPS', /\bquadriceps\b/u],
      ['HAMSTRINGS', /\b(posterior|posteriores da coxa)\b/u],
      ['CALVES', /\bpanturrilhas?\b/u],
      ['LOWER_BODY', /\b(pernas?|membros inferiores)\b/u],
      [
        'UPPER_BODY',
        /\b(parte superior|tronco superior|membros superiores)\b/u,
      ],
      ['FULL_BODY', /\b(corpo inteiro|full body)\b/u],
    ];
    return Object.freeze(
      matches
        .filter(([, pattern]) => pattern.test(text))
        .map(([focus]) => focus),
    );
  }

  private runningDistances(text: string): {
    readonly current: number | null;
    readonly target: number | null;
  } {
    const current = this.decimal(
      text,
      /\bja corro\s*(\d+(?:[.,]\d+)?)\s*km\b/u,
    );
    const target = this.decimal(
      text,
      /\b(?:chegar a|prova de|preparar para|correr)\s*(\d+(?:[.,]\d+)?)\s*km\b/u,
    );
    return Object.freeze({ current, target });
  }

  private declaredEventDate(text: string): string | null {
    const iso = /\b(20\d{2})-(0[1-9]|1[0-2])-([0-2]\d|3[01])\b/u.exec(text);
    const brazilian =
      /\b(?:prova|evento)?\s*(?:em|no dia|dia)?\s*([0-2]?\d|3[01])[/-](0?\d|1[0-2])[/-](20\d{2})\b/u.exec(
        text,
      );
    const year = Number(iso?.[1] ?? brazilian?.[3]);
    const month = Number(iso?.[2] ?? brazilian?.[2]);
    const day = Number(iso?.[3] ?? brazilian?.[1]);
    if (!year || !month || !day) return null;
    const value = new Date(Date.UTC(year, month - 1, day));
    return value.getUTCFullYear() === year &&
      value.getUTCMonth() === month - 1 &&
      value.getUTCDate() === day
      ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      : null;
  }

  private decimal(text: string, pattern: RegExp): number | null {
    const raw = pattern.exec(text)?.[1];
    if (!raw) return null;
    const value = Number.parseFloat(raw.replace(',', '.'));
    return value > 0 && value <= 500 ? value : null;
  }

  private safetySignals(text: string): readonly WorkoutSafetyFlag[] {
    const flags: WorkoutSafetyFlag[] = [];
    if (/\b(dor|doendo)\b/u.test(text)) flags.push('ACUTE_PAIN');
    if (/\bfebre\b/u.test(text)) flags.push('FEVER');
    if (/\b(mal estar|muito mal|indisposto|indisposta)\b/u.test(text))
      flags.push('SIGNIFICANT_MALAISE');
    if (/\b(nao consigo me mexer|incapaz|incapacidade)\b/u.test(text))
      flags.push('REPORTED_INCAPACITY');
    if (/\b(ate desmaiar|sem descanso|treino extremo)\b/u.test(text))
      flags.push('EXTREME_REQUEST');
    if (/\b(reabilitacao|fisioterapia)\b/u.test(text))
      flags.push('REHABILITATION_REQUEST');
    if (/\b(lesao|lesionei|machuquei)\b/u.test(text))
      flags.push('RECENT_INJURY');
    if (/\b(condicao medica|restricao medica)\b/u.test(text))
      flags.push('CLINICAL_CONTEXT');
    return Object.freeze(flags);
  }

  private movementConstraints(
    text: string,
  ): readonly WorkoutMovementConstraint[] {
    if (!/\b(limitacao|dor|doendo|lesao|machuquei)\b/u.test(text)) {
      return Object.freeze([]);
    }
    const area = [
      ['joelho', 'KNEE_LOAD'],
      ['ombro', 'OVERHEAD'],
      ['coluna', 'SPINAL_LOAD'],
      ['lombar', 'SPINAL_LOAD'],
    ].find(([label]) => text.includes(label));
    if (!area) return Object.freeze([]);
    return Object.freeze([
      Object.freeze({
        label: area[0],
        code: area[1] as WorkoutMovementConstraint['code'],
        status: 'REQUIRES_CONFIRMATION' as const,
      }),
    ]);
  }

  private integer(
    text: string,
    pattern: RegExp,
    minimum: number,
    maximum: number,
  ): number | null {
    const raw = pattern.exec(text)?.[1];
    if (!raw) return null;
    const value = Number.parseInt(raw, 10);
    return value >= minimum && value <= maximum ? value : null;
  }

  private status(
    status: 'KNOWN' | 'INFERRED' | 'REQUIRES_CONFIRMATION',
  ): 'CONFIRMED' | 'INFERRED' | 'REQUIRES_CONFIRMATION' {
    return status === 'KNOWN'
      ? 'CONFIRMED'
      : status === 'INFERRED'
        ? 'INFERRED'
        : 'REQUIRES_CONFIRMATION';
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('pt-BR')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
