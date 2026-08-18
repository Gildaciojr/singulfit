import { Injectable, NotFoundException } from '@nestjs/common';
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
  WorkoutEnvironment,
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
    const recognizedContext = this.recognizedContext(
      source.recognizedContext,
      snapshot,
      source.currentMessage,
    );

    return Object.freeze({
      profileId,
      generationInput: Object.freeze({
        userId: source.userId,
        decision,
        recognizedContext,
        snapshot,
        referenceDate: source.referenceDate,
        progressEvidence: source.progressEvidence,
        previousPlan: source.previousPlan,
      }),
    });
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
    if (decision?.goal === CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN) {
      return decision;
    }
    return Object.freeze({
      recognizedIntent: CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_REQUEST,
      goal: CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN,
      reason: 'WORKOUT_PROFILE_READY' as const,
      targetPlan: 'WORKOUT' as const,
      profileCompletionState: snapshot.completion.overall,
      canExecute: true,
      confidence: decision?.confidence ?? ('HIGH' as const),
      selectedProfileField: decision?.selectedProfileField ?? null,
      metPreconditions: decision?.metPreconditions ?? Object.freeze([]),
      missingPreconditions: decision?.missingPreconditions ?? Object.freeze([]),
      pendingDependencies: decision?.pendingDependencies ?? Object.freeze([]),
    });
  }

  private recognizedContext(
    current: WorkoutRecognizedContext | undefined,
    snapshot: CoachProfileSnapshot,
    currentMessage: string | undefined,
  ): WorkoutRecognizedContext {
    const declared = this.declaredContext(currentMessage);
    return Object.freeze({
      ...current,
      ...declared,
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
      purpose: current?.purpose ?? 'CREATION',
    });
  }

  private declaredContext(
    message: string | undefined,
  ): WorkoutRecognizedContext {
    if (!message?.trim()) return Object.freeze({});
    const text = this.normalize(message);
    const modality = this.declaredModality(text);
    const environment = this.declaredEnvironment(text);
    const experience = this.declaredExperience(text);
    const objective = this.declaredObjective(text);
    const muscleFocus = this.declaredMuscleFocus(text);
    const distances = this.runningDistances(text);
    const frequency = this.integer(
      text,
      /\b(\d)\s*(?:x|vezes?|dias?)\s*(?:por|na)?\s*semana\b/u,
      1,
      7,
    );
    const duration = this.integer(
      text,
      /\b(\d{1,3})\s*(?:minutos?|min)\b/u,
      10,
      240,
    );
    const safetySignals = this.safetySignals(text);
    const movementConstraints = this.movementConstraints(text);

    return Object.freeze({
      modality: modality
        ? Object.freeze({ status: 'CONFIRMED' as const, value: modality })
        : undefined,
      environment: environment
        ? Object.freeze({ status: 'CONFIRMED' as const, value: environment })
        : undefined,
      experience: experience
        ? Object.freeze({ status: 'CONFIRMED' as const, value: experience })
        : undefined,
      objective: objective
        ? Object.freeze({ status: 'CONFIRMED' as const, value: objective })
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
      equipment: /\b(sem equipamento|nenhum equipamento)\b/u.test(text)
        ? Object.freeze({
            status: 'CONFIRMED' as const,
            value: Object.freeze([]),
          })
        : undefined,
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
      movementConstraints,
      safetySignals,
    });
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
    if (/\b(musculacao|academia)\b/u.test(text))
      return WORKOUT_MODALITY.GYM_STRENGTH;
    if (/\bcrossfit\b/u.test(text)) return WORKOUT_MODALITY.CROSSFIT;
    if (
      /\b(corrida|correr|corro|comecar a correr)\b/u.test(text) ||
      /\bprova de\s*\d+(?:[.,]\d+)?\s*km\b/u.test(text)
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
    if (/\b(em casa|treino em casa|home workout)\b/u.test(text))
      return WORKOUT_MODALITY.HOME_WORKOUT;
    return undefined;
  }

  private declaredEnvironment(text: string): WorkoutEnvironment | undefined {
    if (/\b(em casa|treino em casa)\b/u.test(text)) return 'HOME';
    if (/\bacademia\b/u.test(text)) return 'FULL_GYM';
    if (/\bcrossfit\b/u.test(text)) return 'CROSSFIT_BOX';
    if (/\btrilha\b/u.test(text)) return 'TRAIL';
    if (/\bpista\b/u.test(text)) return 'TRACK';
    if (/\bestrada\b/u.test(text)) return 'ROAD';
    if (/\brua\b/u.test(text)) return 'STREET';
    if (/\b(ao ar livre|parque)\b/u.test(text)) return 'OUTDOOR';
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
    if (/\b(hipertrofia|ganhar massa|massa muscular)\b/u.test(text))
      return 'HYPERTROPHY';
    if (/\b(forca|ficar mais forte)\b/u.test(text)) return 'STRENGTH';
    if (/\b(emagrecer|perder peso)\b/u.test(text)) return 'WEIGHT_LOSS';
    if (
      /\b(cardio|aerobico|aerobica|condicionamento|comecar a correr)\b/u.test(
        text,
      )
    )
      return 'CONDITIONING';
    if (/\b(mobilidade)\b/u.test(text)) return 'MOBILITY';
    return this.runningDistances(text).target === null
      ? undefined
      : 'COMPLETE_DISTANCE';
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
      /\b(?:chegar a|prova de|correr)\s*(\d+(?:[.,]\d+)?)\s*km\b/u,
    );
    return Object.freeze({ current, target });
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
