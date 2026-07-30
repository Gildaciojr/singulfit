import { BadGatewayException } from '@nestjs/common';
import {
  WORKOUT_ARTIFACT_TYPE,
  WORKOUT_MODALITY,
  type WorkoutArtifactType,
  type WorkoutModality,
  type WorkoutSafetyFlag,
} from './workout-planning-artifact.contract';
import type {
  GeneratedWorkoutPlanV2Candidate,
  WorkoutActivityV2,
  WorkoutBlockV2,
  WorkoutExerciseSubstitution,
  WorkoutProgressionRule,
  WorkoutSessionV2,
} from './workout-plan-v2.contract';
import type {
  WorkoutEquipment,
  WorkoutMovementConstraint,
} from './workout-planning-context.contract';
import type { WorkoutBlockType } from './workout-planning-strategy.contract';

const EQUIPMENT: readonly WorkoutEquipment[] = [
  'BARBELL',
  'DUMBBELL',
  'KETTLEBELL',
  'MACHINE',
  'CABLE',
  'BENCH',
  'PULL_UP_BAR',
  'RESISTANCE_BAND',
  'BODYWEIGHT',
  'BIKE',
  'TREADMILL',
  'ROW_ERGOMETER',
];
const BLOCKS: readonly WorkoutBlockType[] = [
  'WARM_UP',
  'MOBILITY',
  'TECHNIQUE',
  'STRENGTH',
  'HYPERTROPHY',
  'SKILL',
  'CONDITIONING',
  'INTERVAL',
  'ENDURANCE',
  'CORE',
  'COOLDOWN',
  'RECOVERY',
];
const ARTIFACTS: readonly WorkoutArtifactType[] = Object.values(
  WORKOUT_ARTIFACT_TYPE,
);
const MODALITIES: readonly WorkoutModality[] = Object.values(WORKOUT_MODALITY);
const CONSTRAINT_CODES: readonly WorkoutMovementConstraint['code'][] = [
  'KNEE_LOAD',
  'HIP_HINGE',
  'OVERHEAD',
  'IMPACT',
  'SPINAL_LOAD',
  'CUSTOM',
];
const SAFETY_FLAGS: readonly WorkoutSafetyFlag[] = [
  'ACUTE_PAIN',
  'FEVER',
  'SIGNIFICANT_MALAISE',
  'RECENT_INJURY',
  'REPORTED_INCAPACITY',
  'INSUFFICIENT_RECOVERY',
  'CLINICAL_CONTEXT',
  'PROFILE_CONFLICT',
  'UNCONFIRMED_LIMITATION',
  'EXTREME_REQUEST',
  'REHABILITATION_REQUEST',
  'RETURN_AFTER_LONG_PAUSE',
  'TECHNICAL_MODALITY_WITHOUT_READINESS',
];

export class WorkoutPlanV2Parser {
  parse(text: string): GeneratedWorkoutPlanV2Candidate {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new BadGatewayException(
        'Plano de treino V2 retornou JSON inválido',
      );
    }
    const root = this.record(value, 'plan');
    this.exactKeys(
      root,
      [
        'artifactType',
        'modality',
        'objective',
        'title',
        'sessions',
        'progression',
        'substitutions',
        'adaptationRules',
        'safetyFlags',
      ],
      'plan',
    );
    return Object.freeze({
      artifactType: this.oneOf(root.artifactType, ARTIFACTS, 'artifactType'),
      modality: this.oneOf(root.modality, MODALITIES, 'modality'),
      objective: this.oneOf(
        root.objective,
        [
          'WEIGHT_LOSS',
          'HYPERTROPHY',
          'STRENGTH',
          'CONDITIONING',
          'GENERAL_HEALTH',
          'MOBILITY',
          'ACTIVE_RECOVERY',
          'COMPLETE_DISTANCE',
        ],
        'objective',
      ),
      title: this.text(root.title, 'title'),
      sessions: Object.freeze(
        this.array(root.sessions, 'sessions').map((item, index) =>
          this.session(item, index),
        ),
      ),
      progression: Object.freeze(
        this.array(root.progression, 'progression').map((item, index) =>
          this.progression(item, index),
        ),
      ),
      substitutions: Object.freeze(
        this.array(root.substitutions, 'substitutions').map((item, index) =>
          this.substitution(item, index),
        ),
      ),
      adaptationRules: this.textArray(root.adaptationRules, 'adaptationRules'),
      safetyFlags: Object.freeze(
        this.array(root.safetyFlags, 'safetyFlags').map((item) =>
          this.oneOf(item, SAFETY_FLAGS, 'safetyFlags'),
        ),
      ),
    });
  }

  private session(value: unknown, index: number): WorkoutSessionV2 {
    const item = this.record(value, `sessions.${index}`);
    this.exactKeys(
      item,
      ['sessionKey', 'sequence', 'label', 'estimatedDurationMinutes', 'blocks'],
      `sessions.${index}`,
    );
    return Object.freeze({
      sessionKey: this.key(item.sessionKey, 'sessionKey'),
      sequence: this.integer(item.sequence, 1, 7, 'sequence'),
      label: this.text(item.label, 'label'),
      estimatedDurationMinutes: this.integer(
        item.estimatedDurationMinutes,
        1,
        300,
        'estimatedDurationMinutes',
      ),
      blocks: Object.freeze(
        this.array(item.blocks, 'blocks').map((block, blockIndex) =>
          this.block(block, index, blockIndex),
        ),
      ),
    });
  }

  private block(
    value: unknown,
    session: number,
    index: number,
  ): WorkoutBlockV2 {
    const item = this.record(value, `sessions.${session}.blocks.${index}`);
    this.exactKeys(
      item,
      ['blockKey', 'type', 'title', 'estimatedDurationMinutes', 'activities'],
      `sessions.${session}.blocks.${index}`,
    );
    return Object.freeze({
      blockKey: this.key(item.blockKey, 'blockKey'),
      type: this.oneOf(item.type, BLOCKS, 'block.type'),
      title: this.text(item.title, 'block.title'),
      estimatedDurationMinutes: this.integer(
        item.estimatedDurationMinutes,
        1,
        180,
        'block.duration',
      ),
      activities: Object.freeze(
        this.array(item.activities, 'activities').map(
          (activity, activityIndex) =>
            this.activity(activity, `${session}.${index}.${activityIndex}`),
        ),
      ),
    });
  }

  private activity(value: unknown, path: string): WorkoutActivityV2 {
    const item = this.record(value, `activities.${path}`);
    const base = {
      activityKey: this.key(item.activityKey, 'activityKey'),
      name: this.text(item.name, 'activity.name'),
      source: this.oneOf(item.source, ['MODEL_GENERATED'], 'source'),
      movementPattern: this.oneOf(
        item.movementPattern,
        [
          'SQUAT',
          'HINGE',
          'PUSH',
          'PULL',
          'CARRY',
          'LOCOMOTION',
          'ROTATION',
          'CORE',
          'MOBILITY',
          'OTHER',
        ],
        'movementPattern',
      ),
      equipment: Object.freeze(
        this.array(item.equipment, 'equipment').map((equipment) =>
          this.oneOf(equipment, EQUIPMENT, 'equipment'),
        ),
      ),
      instruction: this.text(item.instruction, 'instruction'),
      alerts: this.textArray(item.alerts, 'alerts'),
      appliedConstraintCodes: Object.freeze(
        this.array(item.appliedConstraintCodes, 'constraintCodes').map((code) =>
          this.oneOf(code, CONSTRAINT_CODES, 'constraintCode'),
        ),
      ),
    };
    const kind = this.oneOf(
      item.kind,
      ['STRENGTH', 'TIMED', 'ENDURANCE', 'MOBILITY'],
      'kind',
    );
    const commonKeys = [
      'activityKey',
      'name',
      'source',
      'movementPattern',
      'equipment',
      'instruction',
      'alerts',
      'appliedConstraintCodes',
      'kind',
    ];
    this.exactKeys(
      item,
      kind === 'STRENGTH'
        ? [...commonKeys, 'sets', 'repetitions', 'restSeconds', 'intensity']
        : kind === 'TIMED'
          ? [
              ...commonKeys,
              'durationSeconds',
              'workSeconds',
              'recoverySeconds',
              'rounds',
              'intensity',
            ]
          : kind === 'ENDURANCE'
            ? [
                ...commonKeys,
                'mode',
                'durationMinutes',
                'distanceKm',
                'intensity',
              ]
            : [...commonKeys, 'repetitions', 'holdSeconds', 'durationSeconds'],
      `activities.${path}`,
    );
    if (kind === 'STRENGTH')
      return Object.freeze({
        ...base,
        kind,
        sets: this.integer(item.sets, 1, 20, 'sets'),
        repetitions: this.text(item.repetitions, 'repetitions'),
        restSeconds: this.integer(item.restSeconds, 0, 600, 'rest'),
        intensity: this.oneOf(
          item.intensity,
          ['LIGHT', 'MODERATE', 'HIGH'],
          'intensity',
        ),
      });
    if (kind === 'TIMED')
      return Object.freeze({
        ...base,
        kind,
        durationSeconds: this.integer(
          item.durationSeconds,
          1,
          7200,
          'duration',
        ),
        workSeconds: this.nullableInteger(item.workSeconds, 1, 3600, 'work'),
        recoverySeconds: this.nullableInteger(
          item.recoverySeconds,
          0,
          3600,
          'recovery',
        ),
        rounds: this.integer(item.rounds, 1, 50, 'rounds'),
        intensity: this.oneOf(
          item.intensity,
          ['LIGHT', 'MODERATE', 'HIGH'],
          'intensity',
        ),
      });
    if (kind === 'ENDURANCE')
      return Object.freeze({
        ...base,
        kind,
        mode: this.oneOf(item.mode, ['RUN', 'WALK', 'CYCLE'], 'mode'),
        durationMinutes: this.integer(item.durationMinutes, 1, 300, 'duration'),
        distanceKm: this.nullableNumber(item.distanceKm, 0, 500, 'distance'),
        intensity: this.oneOf(
          item.intensity,
          ['LIGHT', 'MODERATE', 'HIGH', 'CONVERSATIONAL'],
          'intensity',
        ),
      });
    return Object.freeze({
      ...base,
      kind,
      repetitions:
        item.repetitions === null
          ? null
          : this.text(item.repetitions, 'repetitions'),
      holdSeconds: this.nullableInteger(item.holdSeconds, 1, 600, 'hold'),
      durationSeconds: this.nullableInteger(
        item.durationSeconds,
        1,
        3600,
        'duration',
      ),
    });
  }

  private progression(value: unknown, index: number): WorkoutProgressionRule {
    const item = this.record(value, `progression.${index}`);
    this.exactKeys(
      item,
      [
        'ruleKey',
        'state',
        'conditionCode',
        'actionCode',
        'maximumChangePercent',
      ],
      `progression.${index}`,
    );
    return Object.freeze({
      ruleKey: this.key(item.ruleKey, 'ruleKey'),
      state: this.oneOf(
        item.state,
        ['MAINTAIN', 'PROGRESS', 'REGRESS', 'DELOAD', 'REASSESS', 'PAUSE'],
        'state',
      ),
      conditionCode: this.text(item.conditionCode, 'condition'),
      actionCode: this.text(item.actionCode, 'action'),
      maximumChangePercent: this.integer(
        item.maximumChangePercent,
        0,
        100,
        'change',
      ),
    });
  }
  private substitution(
    value: unknown,
    index: number,
  ): WorkoutExerciseSubstitution {
    const item = this.record(value, `substitutions.${index}`);
    this.exactKeys(
      item,
      [
        'substitutionKey',
        'sourceActivityKey',
        'alternativeActivityKey',
        'reason',
        'functionPreserved',
        'confirmationRequired',
      ],
      `substitutions.${index}`,
    );
    return Object.freeze({
      substitutionKey: this.key(item.substitutionKey, 'substitutionKey'),
      sourceActivityKey: this.key(item.sourceActivityKey, 'sourceActivityKey'),
      alternativeActivityKey: this.key(
        item.alternativeActivityKey,
        'alternativeActivityKey',
      ),
      reason: this.oneOf(
        item.reason,
        ['EQUIPMENT', 'LIMITATION', 'ENVIRONMENT', 'REGRESSION', 'PREFERENCE'],
        'reason',
      ),
      functionPreserved: this.boolean(
        item.functionPreserved,
        'functionPreserved',
      ),
      confirmationRequired: this.boolean(
        item.confirmationRequired,
        'confirmationRequired',
      ),
    });
  }
  private record(value: unknown, path: string): Record<string, unknown> {
    if (!this.isRecord(value)) this.invalid(path);
    return value;
  }
  private array(value: unknown, path: string): readonly unknown[] {
    if (!Array.isArray(value)) this.invalid(path);
    return value;
  }
  private text(value: unknown, path: string): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 500)
      this.invalid(path);
    return value.trim();
  }
  private key(value: unknown, path: string): string {
    const key = this.text(value, path);
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(key)) this.invalid(path);
    return key;
  }
  private integer(
    value: unknown,
    min: number,
    max: number,
    path: string,
  ): number {
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < min ||
      value > max
    )
      this.invalid(path);
    return value;
  }
  private nullableInteger(
    value: unknown,
    min: number,
    max: number,
    path: string,
  ): number | null {
    return value === null ? null : this.integer(value, min, max, path);
  }
  private nullableNumber(
    value: unknown,
    min: number,
    max: number,
    path: string,
  ): number | null {
    if (value === null) return null;
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < min ||
      value > max
    )
      this.invalid(path);
    return value;
  }
  private boolean(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') this.invalid(path);
    return value;
  }
  private textArray(value: unknown, path: string): readonly string[] {
    return Object.freeze(
      this.array(value, path).map((item) => this.text(item, path)),
    );
  }
  private oneOf<T extends string>(
    value: unknown,
    values: readonly T[],
    path: string,
  ): T {
    if (typeof value !== 'string') this.invalid(path);
    const found = values.find((candidate) => candidate === value);
    if (!found) this.invalid(path);
    return found;
  }
  private invalid(path: string): never {
    throw new BadGatewayException(`Plano de treino V2 inválido em ${path}`);
  }
  private exactKeys(
    value: Record<string, unknown>,
    allowed: readonly string[],
    path: string,
  ): void {
    if (Object.keys(value).some((key) => !allowed.includes(key))) {
      this.invalid(`${path}.unexpectedProperty`);
    }
  }
  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
