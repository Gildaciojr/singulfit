import { WorkoutPlanV2Validator } from './workout-plan-v2.validator';
import { WorkoutPlanV2Parser } from './workout-plan-v2.parser';
import { WorkoutPlanV2Formatter } from './workout-plan-v2.formatter';
import { WorkoutPlanningStrategyService } from './workout-planning-strategy.service';
import {
  workoutPrescriptionIssues,
  reconcileWorkoutPrescriptions,
} from './workout-prescription.policy';
import { workoutPublicTextIssues } from './workout-public-text.policy';
import {
  qualityContext,
  qualitySession,
  qualityCandidate,
  strength,
} from './workout-quality.fixtures';
import type {
  WorkoutActivityV2,
  WorkoutPrescription,
  WorkoutMetricPrescription,
  StrengthActivity,
  WorkoutExecutionPrescription,
} from './workout-plan-v2.contract';
import type { WorkoutPlanningContext } from './workout-planning-context.contract';
import { mandatoryWorkoutMinutes } from './workout-duration-estimator';

const context = qualityContext(['MONDAY']);
const strategy = {
  ...new WorkoutPlanningStrategyService().build(context),
  authorizedEquipment: ['BODYWEIGHT', 'DUMBBELL'] as const,
};
const execution = {
  kind: 'COUNT' as const,
  minimum: 8,
  maximum: 10,
  perSide: false,
  alternating: false,
};
const metric = (
  kind: WorkoutMetricPrescription['kind'],
  value: number,
): WorkoutMetricPrescription => ({
  kind,
  value,
  basis: 'ADJUSTABLE_START',
  referenceId: null,
});
const prescription = (
  changes: Partial<WorkoutPrescription> = {},
): WorkoutPrescription => ({
  execution,
  load: metric('LOAD_KG', 20),
  effort: { kind: 'RPE', value: 7 },
  enduranceMetrics: [],
  ...changes,
});
const activity = (
  changes: Partial<WorkoutPrescription> = {},
): StrengthActivity => ({
  ...strength(),
  repetitions: '8-10',
  equipment: ['DUMBBELL'],
  prescription: prescription(changes),
});

function nativeActivity(
  kind: 'TIMED' | 'ENDURANCE',
  executionKind: WorkoutExecutionPrescription['kind'],
): WorkoutActivityV2 {
  const base = {
    activityKey: 'native',
    name: 'Caminhada na esteira',
    source: 'MODEL_GENERATED' as const,
    movementPattern: 'LOCOMOTION' as const,
    publicIdentity: null,
    equipment: ['TREADMILL'] as const,
    instruction: 'Mantenha ritmo confortável.',
    alerts: [],
    appliedConstraintCodes: [],
    prescription: prescription({
      load: null,
      effort: null,
      execution: {
        kind: executionKind,
        minimum: null,
        maximum: null,
        perSide: false,
        alternating: false,
      },
    }),
  };
  return kind === 'TIMED'
    ? {
        ...base,
        kind,
        durationSeconds: 360,
        workSeconds: null,
        recoverySeconds: null,
        rounds: 1,
        intensity: 'LIGHT',
      }
    : {
        ...base,
        kind,
        mode: 'WALK',
        durationMinutes: 6,
        distanceKm: null,
        intensity: 'LIGHT',
      };
}

describe('production V12 compatibility: jobs 20756ef4 and 98456476 prescription excerpts', () => {
  it('retains an authorized pull-up cue but does not authorize a loaded bar in that cue', () => {
    const value = {
      ...activity({ load: null }),
      name: 'Barra fixa com pausa no topo',
      equipment: ['PULL_UP_BAR'] as const,
      movementPattern: 'PULL' as const,
      instruction: 'Segure a barra com controle.',
      publicIdentity: {
        plane: 'VERTICAL' as const,
        targetRegion: 'BACK' as const,
        bodyPosition: 'HANGING' as const,
        jointAction: null,
      },
    };
    expect(new WorkoutPlanV2Formatter().formatActivity(value)).toContain(
      value.instruction,
    );
    expect(
      new WorkoutPlanV2Formatter().formatActivity({
        ...value,
        instruction: 'Segure a barra olímpica.',
      }),
    ).not.toContain('barra olímpica');
  });
  const available = {
    ...strategy,
    authorizedEquipment: [
      'BODYWEIGHT',
      'DUMBBELL',
      'PULL_UP_BAR',
      'TREADMILL',
    ] as const,
  };
  const candidateFor = (value: WorkoutActivityV2) =>
    qualityCandidate([
      { ...qualitySession('real', [value]), weekday: 'MONDAY' as const },
    ]);
  const normalized = (value: WorkoutActivityV2) =>
    reconcileWorkoutPrescriptions(
      new WorkoutPlanV2Parser().parse(JSON.stringify(candidateFor(value))),
    );
  it.each([
    ['3-5', 'COUNT', 3, 5, false, false],
    ['6', 'COUNT', 6, 6, false, false],
    ['6 por lado', 'COUNT', 6, 6, true, false],
    ['30-40 s', 'SECONDS', 30, 40, false, false],
    ['30-40 s por lado', 'SECONDS', 30, 40, true, false],
    ['8-10 alternando lados', 'COUNT', 8, 10, false, true],
  ] as const)(
    'recovers %s exclusively from the existing redundant dose',
    (repetitions, kind, minimum, maximum, perSide, alternating) => {
      const value = {
        ...activity({
          load: null,
          effort: null,
          execution: {
            kind,
            minimum: null,
            maximum: null,
            perSide: false,
            alternating: false,
          },
        }),
        repetitions,
      };
      const before = JSON.stringify(value);
      const result = normalized(value);
      expect(
        result.sessions[0].blocks[0].activities[0].prescription?.execution,
      ).toEqual({ kind, minimum, maximum, perSide, alternating });
      expect(
        new WorkoutPlanV2Validator()
          .validate(result, context, available, true, true, true)
          .issues.filter((issue) => issue.severity === 'ERROR'),
      ).toEqual([]);
      expect(JSON.stringify(value)).toBe(before);
      expect(reconcileWorkoutPrescriptions(result)).toBe(result);
      const output = new WorkoutPlanV2Formatter().formatActivity(
        result.sessions[0].blocks[0].activities[0],
      );
      if (perSide) expect(output).toContain('por lado');
      if (alternating) expect(output).toContain('alternando lados');
    },
  );
  it.each([
    {
      ...activity({
        load: null,
        execution: { ...execution, minimum: 4, maximum: null },
      }),
      repetitions: '3-5',
    },
    {
      ...activity({
        load: null,
        execution: {
          ...execution,
          kind: 'SECONDS',
          minimum: null,
          maximum: null,
        },
      }),
      repetitions: '6',
    },
    {
      ...activity({
        load: null,
        execution: { ...execution, minimum: 6, maximum: 6 },
      }),
      repetitions: '6 por lado',
    },
    {
      ...activity({
        load: null,
        execution: { ...execution, minimum: null, maximum: null },
      }),
      repetitions: 'até falhar',
    },
  ])('keeps ambiguous or conflicting dose invalid: %j', (value) => {
    expect(reconcileWorkoutPrescriptions(candidateFor(value))).toEqual(
      candidateFor(value),
    );
    expect(
      new WorkoutPlanV2Validator().validate(
        normalized(value),
        context,
        available,
        true,
        true,
        true,
      ).issues,
    ).toContainEqual(
      expect.objectContaining({ code: 'INVALID_PARAMETER', severity: 'ERROR' }),
    );
  });
  it.each([
    ['TIMED', 'COUNT'],
    ['TIMED', 'SECONDS'],
    ['ENDURANCE', 'COUNT'],
    ['ENDURANCE', 'SECONDS'],
  ] as const)(
    'uses the native %s clock instead of a null %s execution',
    (kind, executionKind) => {
      const value = nativeActivity(kind, executionKind);
      const result = normalized(value);
      const projected = result.sessions[0].blocks[0].activities[0];
      expect(projected.prescription?.execution).toBeNull();
      expect(
        new WorkoutPlanV2Validator()
          .validate(result, context, available, true, true, true)
          .issues.filter((issue) => issue.severity === 'ERROR'),
      ).toEqual([]);
      expect(new WorkoutPlanV2Formatter().formatActivity(projected)).toContain(
        'Caminhada',
      );
      expect(new WorkoutPlanV2Formatter().formatActivity(projected)).toContain(
        '6 min',
      );
    },
  );
  it.each(['TIMED', 'ENDURANCE'] as const)(
    'rejects an explicit conflicting second %s clock',
    (kind) => {
      const value = nativeActivity(kind, 'SECONDS');
      const different = {
        ...value,
        prescription: prescription({
          load: null,
          execution: {
            ...execution,
            kind: 'SECONDS',
            minimum: 30,
            maximum: 40,
          },
        }),
      };
      expect(
        new WorkoutPlanV2Validator().validate(
          normalized(different),
          context,
          available,
          true,
          true,
          true,
        ).issues,
      ).toContainEqual(expect.objectContaining({ code: 'INVALID_PARAMETER' }));
      const same = {
        ...value,
        prescription: prescription({
          load: null,
          execution: {
            ...execution,
            kind: 'SECONDS',
            minimum: 360,
            maximum: 360,
          },
        }),
      };
      expect(
        normalized(same).sessions[0].blocks[0].activities[0].prescription
          ?.execution,
      ).toBeNull();
    },
  );
  it('does not invent a missing native TIMED clock or waive identity for ambiguous activities', () => {
    const value = nativeActivity('TIMED', 'SECONDS');
    if (value.kind !== 'TIMED') throw new Error('Expected TIMED');
    const invalid = { ...value, durationSeconds: 0 };
    expect(() =>
      new WorkoutPlanV2Parser().parse(JSON.stringify(candidateFor(invalid))),
    ).toThrow();
    expect(reconcileWorkoutPrescriptions(candidateFor(invalid))).toEqual(
      candidateFor(invalid),
    );
    expect(() => normalized({ ...value, instruction: '' })).toThrow();
    for (const ambiguous of [
      { ...value, name: 'Atividade a definir' },
      { ...value, name: 'Caminhada na bike', equipment: ['BIKE' as const] },
      { ...activity({ load: null }), publicIdentity: null },
    ]) {
      expect(
        new WorkoutPlanV2Validator().validate(
          normalized(ambiguous),
          context,
          available,
          true,
          true,
          true,
        ).issues,
      ).toContainEqual(
        expect.objectContaining({ code: 'PUBLIC_IDENTITY_REQUIRED' }),
      );
    }
  });
  it.each([
    ['Caminhada progressiva na esteira', ['TREADMILL']],
    ['Caminhada ao ar livre', []],
    ['Corrida ao ar livre', []],
    ['Deslocamento contínuo ao ar livre', []],
  ] as const)(
    'preserves executable model-authored locomotion without an anatomical identity: %s',
    (name, equipment) => {
      const value = {
        ...nativeActivity('TIMED', 'SECONDS'),
        name,
        equipment,
        instruction:
          'Ajuste o ritmo gradualmente e mantenha passadas confortáveis.',
        alerts: ['Interrompa se sentir dor.'],
      };
      const result = normalized(value);
      expect(
        new WorkoutPlanV2Validator()
          .validate(result, context, available, true, true, true)
          .issues.filter((issue) => issue.severity === 'ERROR'),
      ).toEqual([]);
      const projected = result.sessions[0].blocks[0].activities[0];
      for (const presented of [
        projected,
        { ...projected, prescription: null },
      ]) {
        const output = new WorkoutPlanV2Formatter().formatActivity(presented);
        expect(output).toContain(name);
        expect(output).toContain(value.instruction);
        expect(output).toContain(value.alerts[0]);
        expect(output).toContain('6 min');
      }
    },
  );
  it('retains locomotion conflicts even when an anatomical identity is present', () => {
    const value = nativeActivity('TIMED', 'SECONDS');
    const contradictory = {
      ...value,
      name: 'Caminhada na bicicleta',
      equipment: ['BIKE'] as const,
      publicIdentity: strength().publicIdentity,
    };
    expect(
      new WorkoutPlanV2Validator().validate(
        normalized(contradictory),
        context,
        {
          ...available,
          authorizedEquipment: [...available.authorizedEquipment, 'BIKE'],
        },
        true,
        true,
        true,
      ).issues,
    ).toContainEqual(
      expect.objectContaining({
        code: 'ENDURANCE_MODE_CONFLICT',
        severity: 'ERROR',
      }),
    );
    const unavailable = {
      ...value,
      name: 'Caminhada progressiva na esteira',
    };
    expect(
      new WorkoutPlanV2Validator().validate(
        normalized(unavailable),
        context,
        { ...available, authorizedEquipment: ['BODYWEIGHT'] },
        true,
        true,
        true,
      ).issues,
    ).toContainEqual(
      expect.objectContaining({
        code: 'EQUIPMENT_UNAVAILABLE',
        severity: 'ERROR',
      }),
    );
    const impossible = { ...value, durationSeconds: 60, workSeconds: 120 };
    if (value.kind !== 'TIMED') throw new Error('Expected TIMED');
    expect(
      new WorkoutPlanV2Validator().validate(
        normalized(impossible),
        context,
        available,
        true,
        true,
        true,
      ).issues,
    ).toContainEqual(
      expect.objectContaining({
        code: 'TIMED_DURATION_IMPOSSIBLE',
        severity: 'ERROR',
      }),
    );
  });
  it.each(['name', 'instruction', 'alerts'] as const)(
    'resolves authorized pull-up equipment in %s while preserving Olympic bar errors',
    (field) => {
      const positive = [
        'Barra fixa com pausa no topo',
        'Barra fixa strict ou remo invertido na barra',
      ];
      for (const text of positive) {
        expect(workoutPublicTextIssues(text, available, 'real')).toEqual([]);
        const value = {
          ...activity({ load: null }),
          equipment: ['PULL_UP_BAR', 'BODYWEIGHT'] as const,
          movementPattern: 'PULL' as const,
          publicIdentity: {
            plane: 'VERTICAL' as const,
            targetRegion: 'BACK' as const,
            bodyPosition: 'HANGING' as const,
            jointAction: null,
          },
          ...(field === 'alerts' ? { alerts: [text] } : { [field]: text }),
        };
        expect(
          new WorkoutPlanV2Validator()
            .validate(normalized(value), context, available, true, true, true)
            .issues.filter((issue) => issue.severity === 'ERROR'),
        ).toEqual([]);
      }
      for (const text of [
        'Barra olímpica',
        'Barra fixa; segure a barra olímpica',
        'Barra fixa; segure a barra com anilhas',
        'Agachamento com barra',
        'Use ergômetro de remo',
      ]) {
        expect(workoutPublicTextIssues(text, available, 'real')).toContainEqual(
          expect.objectContaining({ code: 'UNAUTHORIZED_EQUIPMENT_REFERENCE' }),
        );
      }
      const unavailable = {
        ...activity({ load: null }),
        equipment: ['BARBELL'] as const,
      };
      expect(
        new WorkoutPlanV2Validator().validate(
          normalized(unavailable),
          context,
          available,
          true,
          true,
          true,
        ).issues,
      ).toContainEqual(
        expect.objectContaining({ code: 'EQUIPMENT_UNAVAILABLE' }),
      );
    },
  );
});
function validate(
  value: WorkoutActivityV2,
  ctx: WorkoutPlanningContext = context,
) {
  const session = {
    ...qualitySession('typed', [value]),
    weekday: 'MONDAY' as const,
  };
  return new WorkoutPlanV2Validator().validate(
    qualityCandidate([session]),
    ctx,
    strategy,
    true,
  ).issues;
}

describe('AI-first contextual capabilities, without a coaching catalog', () => {
  it.each(['ADJUSTABLE_START', 'USER_REPORTED', 'OBSERVED'] as const)(
    'presents %s provenance without turning a reference into a target',
    (basis) => {
      const load = { ...metric('LOAD_KG', 20), basis };
      const heartRate = { ...metric('HEART_RATE_BPM', 150), basis };
      const values: readonly WorkoutActivityV2[] = [
        activity({ load }),
        {
          ...strength(),
          kind: 'ENDURANCE',
          mode: 'RUN',
          durationMinutes: 10,
          distanceKm: null,
          intensity: 'CONVERSATIONAL',
          prescription: prescription({
            execution: null,
            load: null,
            enduranceMetrics: [heartRate],
          }),
        },
      ];
      for (const value of values) {
        const before = JSON.stringify(value);
        const output = new WorkoutPlanV2Formatter().formatActivity(value);
        if (basis === 'ADJUSTABLE_START') {
          expect(output).toContain(
            value.kind === 'STRENGTH' ? 'Carga sugerida' : 'Meta sugerida',
          );
          expect(output).toContain('ponto inicial ajustável');
          expect(output).not.toContain('Referência registrada');
        } else {
          expect(output).toContain(
            basis === 'USER_REPORTED'
              ? 'Referência informada por você'
              : 'Referência registrada',
          );
          expect(output).not.toMatch(/Meta|sugerida|ponto inicial ajustável/u);
        }
        expect(output).toContain(
          value.kind === 'STRENGTH' ? '20 kg' : '150 bpm',
        );
        expect(JSON.stringify(value)).toBe(before);
      }
    },
  );
  it.each([5, 20, 40])(
    'allows a conservative exploratory load of %s kg with confirmed experience',
    (value) => {
      expect(
        validate(activity({ load: metric('LOAD_KG', value) })).filter(
          (issue) => issue.severity === 'ERROR',
        ),
      ).toEqual([]);
    },
  );
  it.each([80, 500, 5000])(
    'rejects unanchored adjustable %s kg despite positive values and RPE',
    (value) => {
      expect(
        validate(activity({ load: metric('LOAD_KG', value) })),
      ).toContainEqual(expect.objectContaining({ code: 'INVALID_PARAMETER' }));
    },
  );
  it('requires relevant capacity evidence for larger recommendations, without prescribing a fixed load', () => {
    const value = activity({
      load: { ...metric('LOAD_KG', 80), referenceId: 'capacity' },
    });
    const ctx = {
      ...context,
      metricEvidence: [
        {
          id: 'capacity',
          kind: 'LOAD_KG' as const,
          value: 100,
          source: 'USER_REPORTED' as const,
        },
      ],
    };
    expect(
      validate(value, ctx).filter((issue) => issue.severity === 'ERROR'),
    ).toEqual([]);
    const exactContext = {
      ...ctx,
      metricEvidence: [{ ...ctx.metricEvidence[0], value: 80 }],
    };
    expect(
      validate(activity({ load: metric('LOAD_KG', 80) }), exactContext).filter(
        (issue) => issue.severity === 'ERROR',
      ),
    ).toEqual([]);
    expect(
      validate(value, {
        ...ctx,
        metricEvidence: [{ ...ctx.metricEvidence[0], value: 60 }],
      }),
    ).toContainEqual(expect.objectContaining({ code: 'INVALID_PARAMETER' }));
    expect(
      validate(value, {
        ...ctx,
        metricEvidence: [{ ...ctx.metricEvidence[0], kind: 'POWER_WATTS' }],
      }),
    ).toContainEqual(expect.objectContaining({ code: 'INVALID_PARAMETER' }));
  });
  it('uses uncertainty, beginner experience and effort to constrain exploratory loading', () => {
    expect(
      validate(activity(), {
        ...context,
        training: { ...context.training, experience: { status: 'NOT_SET' } },
      }),
    ).toContainEqual(expect.objectContaining({ code: 'INVALID_PARAMETER' }));
    const beginner = {
      ...context,
      training: {
        ...context.training,
        experience: {
          status: 'CONFIRMED' as const,
          value: 'BEGINNER' as const,
        },
      },
    };
    expect(validate(activity(), beginner)).toContainEqual(
      expect.objectContaining({ code: 'INVALID_PARAMETER' }),
    );
    expect(
      validate(
        activity({
          load: metric('LOAD_KG', 5),
          effort: { kind: 'RPE', value: 5 },
        }),
        beginner,
      ).filter((issue) => issue.severity === 'ERROR'),
    ).toEqual([]);
    expect(
      validate(activity({ effort: { kind: 'RPE', value: 9 } })),
    ).toContainEqual(expect.objectContaining({ code: 'INVALID_PARAMETER' }));
    expect(
      validate(activity({ effort: { kind: 'RIR', value: 3 } })).filter(
        (issue) => issue.severity === 'ERROR',
      ),
    ).toEqual([]);
    expect(
      validate(activity({ effort: { kind: 'RIR', value: 0 } })),
    ).toContainEqual(expect.objectContaining({ code: 'INVALID_PARAMETER' }));
  });
  it('requires HR evidence for a recommendation and does not prescribe high recorded HR', () => {
    const value: WorkoutActivityV2 = {
      ...strength(),
      kind: 'ENDURANCE',
      mode: 'RUN',
      durationMinutes: 10,
      distanceKm: null,
      intensity: 'CONVERSATIONAL',
      prescription: prescription({
        execution: null,
        load: null,
        enduranceMetrics: [metric('HEART_RATE_BPM', 150)],
      }),
    };
    const block = qualitySession().blocks[1];
    expect(
      workoutPrescriptionIssues(value, block, context, strategy),
    ).toContainEqual(expect.objectContaining({ code: 'INVALID_PARAMETER' }));
    const ctx = {
      ...context,
      metricEvidence: [
        {
          id: 'hr',
          kind: 'HEART_RATE_BPM' as const,
          value: 160,
          source: 'OBSERVED' as const,
        },
      ],
    };
    const anchored = {
      ...value,
      prescription: prescription({
        execution: null,
        load: null,
        enduranceMetrics: [
          { ...metric('HEART_RATE_BPM', 150), referenceId: 'hr' },
        ],
      }),
    };
    expect(workoutPrescriptionIssues(anchored, block, ctx, strategy)).toEqual(
      [],
    );
    expect(
      workoutPrescriptionIssues(
        anchored,
        block,
        { ...ctx, metricEvidence: [{ ...ctx.metricEvidence[0], value: 140 }] },
        strategy,
      ),
    ).toContainEqual(expect.objectContaining({ code: 'INVALID_PARAMETER' }));
    const highContext = {
      ...ctx,
      metricEvidence: [{ ...ctx.metricEvidence[0], value: 250 }],
    };
    const high = {
      ...anchored,
      prescription: prescription({
        execution: null,
        load: null,
        enduranceMetrics: [
          { ...metric('HEART_RATE_BPM', 250), referenceId: 'hr' },
        ],
      }),
    };
    expect(
      workoutPrescriptionIssues(high, block, highContext, strategy),
    ).toContainEqual(expect.objectContaining({ code: 'INVALID_PARAMETER' }));
    const recorded = {
      ...high,
      prescription: prescription({
        execution: null,
        load: null,
        enduranceMetrics: [
          {
            ...metric('HEART_RATE_BPM', 250),
            referenceId: 'hr',
            basis: 'OBSERVED',
          },
        ],
      }),
    };
    expect(
      workoutPrescriptionIssues(recorded, block, highContext, strategy),
    ).toEqual([]);
    const output = new WorkoutPlanV2Formatter().formatActivity(recorded);
    expect(output).toContain('Referência registrada: 250 bpm');
    expect(output).not.toContain('Meta');
  });
  it('compares decimal clocks and per-side aliases without requiring the legacy grammar', () => {
    const timed = {
      ...activity({
        load: null,
        execution: {
          ...execution,
          kind: 'SECONDS',
          minimum: 30.5,
          maximum: null,
        },
      }),
      repetitions: '30,5 s',
    };
    expect(
      validate(timed).filter((issue) => issue.severity === 'ERROR'),
    ).toEqual([]);
    expect(validate({ ...timed, repetitions: '35,5 s' })).toContainEqual(
      expect.objectContaining({ code: 'INVALID_PARAMETER' }),
    );
    const sided = {
      ...activity({ load: null, execution: { ...execution, perSide: true } }),
      repetitions: '8-10 de cada perna',
    };
    expect(
      validate(sided).filter((issue) => issue.severity === 'ERROR'),
    ).toEqual([]);
  });
  it.each(['12-16', '8-10 s', '8-10 por lado', '8-10 alternando lados'])(
    'rejects contradictory redundant execution: %s',
    (repetitions) => {
      expect(validate({ ...activity(), repetitions })).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_PARAMETER',
          severity: 'ERROR',
        }),
      );
    },
  );
  it.each(['8–10', '8-10 reps', '8-10 repetições'])(
    'accepts equivalent human execution text: %s',
    (repetitions) => {
      expect(
        validate({ ...activity(), repetitions }).filter(
          (issue) => issue.severity === 'ERROR',
        ),
      ).toEqual([]);
    },
  );
  it('checks named loads without rejecting legitimate human exercise names', () => {
    expect(
      validate({ ...activity(), name: 'Agachamento com halteres — 30 kg' }),
    ).toContainEqual(expect.objectContaining({ code: 'INVALID_PARAMETER' }));
    expect(
      validate({
        ...activity(),
        name: 'Agachamento com halteres — 20 kg',
      }).filter((issue) => issue.severity === 'ERROR'),
    ).toEqual([]);
    expect(
      validate({ ...activity(), name: 'Elevação em Y' }).filter(
        (issue) => issue.severity === 'ERROR',
      ),
    ).toEqual([]);
  });
  it.each([
    ['LOAD_KG', 10000, 'RUN'],
    ['HEART_RATE_BPM', 500, 'RUN'],
    ['HEART_RATE_BPM', 5, 'RUN'],
    ['POWER_WATTS', 10000, 'CYCLE'],
    ['PACE_SECONDS_PER_KM', 1, 'RUN'],
    ['PACE_SECONDS_PER_KM', 120, 'WALK'],
  ] as const)(
    'rejects implausible %s=%s in %s even with matching evidence',
    (kind, value, mode) => {
      const evidenceContext = {
        ...context,
        metricEvidence: [
          { id: 'known', kind, value, source: 'USER_REPORTED' as const },
        ],
      };
      const target = {
        kind,
        value,
        basis: 'USER_REPORTED' as const,
        referenceId: 'known',
      };
      const candidate: WorkoutActivityV2 =
        kind === 'LOAD_KG'
          ? activity({ load: target })
          : {
              ...strength(),
              kind: 'ENDURANCE',
              mode,
              durationMinutes: 10,
              distanceKm: null,
              intensity: 'CONVERSATIONAL',
              prescription: prescription({
                execution: null,
                load: null,
                enduranceMetrics: [target],
              }),
            };
      expect(
        workoutPrescriptionIssues(
          candidate,
          qualitySession().blocks[1],
          evidenceContext,
          strategy,
        ),
      ).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_PARAMETER',
          severity: 'ERROR',
        }),
      );
    },
  );
  it('checks named pace, heart rate and power against typed metrics', () => {
    const ctx = {
      ...context,
      metricEvidence: [
        {
          id: 'hr-observed',
          kind: 'HEART_RATE_BPM' as const,
          value: 150,
          source: 'OBSERVED' as const,
        },
      ],
    };
    for (const [kind, value, goodName, badName, mode] of [
      ['PACE_SECONDS_PER_KM', 330, 'Corrida 5:30/km', 'Corrida 4:30/km', 'RUN'],
      ['HEART_RATE_BPM', 150, 'Corrida 150 bpm', 'Corrida 180 bpm', 'RUN'],
      ['POWER_WATTS', 250, 'Bike 250 W', 'Bike 500 W', 'CYCLE'],
    ] as const) {
      const candidate: WorkoutActivityV2 = {
        ...strength(),
        kind: 'ENDURANCE',
        mode,
        durationMinutes: 10,
        distanceKm: null,
        intensity: 'CONVERSATIONAL',
        name: goodName,
        prescription: prescription({
          execution: null,
          load: null,
          enduranceMetrics: [metric(kind, value)],
        }),
      };
      expect(
        workoutPrescriptionIssues(
          candidate,
          qualitySession().blocks[1],
          ctx,
          strategy,
        ),
      ).toEqual([]);
      expect(
        workoutPrescriptionIssues(
          { ...candidate, name: badName },
          qualitySession().blocks[1],
          ctx,
          strategy,
        ),
      ).toContainEqual(expect.objectContaining({ code: 'INVALID_PARAMETER' }));
    }
  });
  it('requires typed execution for V12, while legacy count text and native clocks remain valid', () => {
    const legacy = {
      ...qualitySession('legacy', [strength()]),
      weekday: 'MONDAY' as const,
    };
    const candidate = qualityCandidate([legacy]);
    const validator = new WorkoutPlanV2Validator();
    expect(
      validator.validate(candidate, context, strategy, true, true, true).issues,
    ).toContainEqual(
      expect.objectContaining({
        code: 'PUBLIC_REPETITIONS_REQUIRED',
        severity: 'ERROR',
      }),
    );
    expect(
      validator
        .validate(candidate, context, strategy, true, true, false)
        .issues.filter((issue) => issue.severity === 'ERROR'),
    ).toEqual([]);
    const typed = qualityCandidate([
      {
        ...legacy,
        blocks: legacy.blocks.map((block) => ({
          ...block,
          activities: block.activities.map((value) =>
            value.kind === 'STRENGTH' ? activity() : value,
          ),
        })),
      },
    ]);
    expect(
      validator
        .validate(typed, context, strategy, true, true, true)
        .issues.filter((issue) => issue.severity === 'ERROR'),
    ).toEqual([]);
  });
  it('presents a safe model-authored name and cue without adding an exercise alias', () => {
    const value = {
      ...activity({ load: null }),
      name: 'Hollow body com alcance alternado',
      instruction: 'Alterne os alcances mantendo a técnica confortável.',
    };
    expect(
      validate(value).filter((issue) => issue.severity === 'ERROR'),
    ).toEqual([]);
    expect(new WorkoutPlanV2Formatter().formatActivity(value)).toContain(
      value.name,
    );
    expect(new WorkoutPlanV2Formatter().formatActivity(value)).toContain(
      value.instruction,
    );
  });
  it('counts typed seconds as an explicit clock rather than treating them as reps', () => {
    const value = {
      ...activity({
        load: null,
        execution: {
          ...execution,
          kind: 'SECONDS',
          minimum: 30,
          maximum: 45,
          perSide: true,
        },
      }),
      repetitions: '30-45 s por lado',
    };
    if (value.kind !== 'STRENGTH') throw new Error('Expected strength');
    expect(mandatoryWorkoutMinutes(value)).toBe(
      (value.sets * 30 * 2 + (value.sets - 1) * value.restSeconds) / 60,
    );
  });
  it('rejects malformed typed fields at parsing instead of accepting arbitrary strings', () => {
    const candidate = qualityCandidate([
      qualitySession('malformed', [activity()]),
    ]);
    const serialized = JSON.stringify(candidate).replace(
      '"value":20',
      '"value":"20 kg"',
    );
    expect(() => new WorkoutPlanV2Parser().parse(serialized)).toThrow();
  });
  it('preserves explicit requested modality as a structural error', () => {
    const candidate = {
      ...qualityCandidate([qualitySession('wrong', [activity()])]),
      modality: 'CROSSFIT' as const,
    };
    expect(
      new WorkoutPlanV2Validator().validate(candidate, context, strategy)
        .issues,
    ).toContainEqual(
      expect.objectContaining({ code: 'MODALITY_MISMATCH', severity: 'ERROR' }),
    );
  });
  it('parses, validates and presents an adjustable load with effort, without hiding load in repetitions', () => {
    const value = {
      ...activity(),
      instruction: 'Comece com 20 kg; ajuste conforme técnica e esforço.',
    };
    const candidate = new WorkoutPlanV2Parser().parse(
      JSON.stringify(qualityCandidate([qualitySession('typed', [value])])),
    );
    expect(
      candidate.sessions[0].blocks[0].activities[0].prescription?.load?.value,
    ).toBe(20);
    expect(
      validate(value).filter((issue) => issue.severity === 'ERROR'),
    ).toEqual([]);
    expect(
      new WorkoutPlanV2Formatter().formatActivity(value, 1, strategy),
    ).toContain('20 kg');
    expect(
      new WorkoutPlanV2Formatter().formatActivity(value, 1, strategy),
    ).toContain('ponto inicial ajustável');
  });
  it.each(['USER_REPORTED', 'OBSERVED'] as const)(
    'requires backend evidence for %s, never trusts the model claim alone',
    (basis) => {
      const value = activity({
        load: { ...metric('LOAD_KG', 20), basis, referenceId: 'evidence' },
      });
      expect(validate(value)).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_PARAMETER',
          severity: 'ERROR',
        }),
      );
      expect(
        validate(value, {
          ...context,
          metricEvidence: [
            { id: 'evidence', kind: 'LOAD_KG', value: 20, source: basis },
          ],
        }).filter((issue) => issue.severity === 'ERROR'),
      ).toEqual([]);
      expect(
        validate(value, {
          ...context,
          metricEvidence: [
            { id: 'evidence', kind: 'LOAD_KG', value: 25, source: basis },
          ],
        }),
      ).toContainEqual(expect.objectContaining({ code: 'INVALID_PARAMETER' }));
    },
  );
  it('allows a percentage of a known 1RM, rejects missing 1RM', () => {
    const value = activity({
      load: { ...metric('PERCENT_1RM', 80), referenceId: 'one-rm' },
    });
    expect(validate(value)).toContainEqual(
      expect.objectContaining({ code: 'INVALID_PARAMETER' }),
    );
    expect(
      validate(value, {
        ...context,
        metricEvidence: [
          {
            id: 'one-rm',
            kind: 'ONE_REP_MAX_KG',
            value: 50,
            source: 'USER_REPORTED',
          },
        ],
      }).filter((issue) => issue.severity === 'ERROR'),
    ).toEqual([]);
  });
  it('allows technical failure for an authorized experienced context, without a lexical blacklist', () => {
    const value = {
      ...activity({
        load: null,
        effort: { kind: 'TECHNICAL_FAILURE', value: null },
      }),
      instruction: 'Última série até a falha técnica.',
    };
    expect(
      validate(value).filter((issue) => issue.severity === 'ERROR'),
    ).toEqual([]);
    expect(new WorkoutPlanV2Formatter().formatActivity(value)).toContain(
      'falha técnica',
    );
    expect(
      workoutPrescriptionIssues(value, qualitySession().blocks[1], context, {
        ...strategy,
        technicalMovementsAllowed: false,
      }),
    ).toContainEqual(expect.objectContaining({ code: 'INVALID_PARAMETER' }));
  });
  it('supports maximum technical repetitions in a time-bounded AMRAP', () => {
    const value = {
      ...activity({
        load: null,
        execution: {
          ...execution,
          kind: 'MAXIMUM_TECHNICAL_REPS' as const,
          minimum: null,
          maximum: null,
        },
        effort: { kind: 'MAXIMUM_TECHNICAL_REPS' as const, value: null },
      }),
      repetitions: 'o máximo possível',
      instruction: 'Máximo de repetições mantendo técnica.',
    };
    const block = {
      ...qualitySession().blocks[1],
      activities: [value],
      work: {
        format: 'AMRAP' as const,
        durationSeconds: 480,
        rounds: null,
        intervalSeconds: null,
        movementActivityKeys: [value.activityKey],
      },
    };
    expect(workoutPrescriptionIssues(value, block, context, strategy)).toEqual(
      [],
    );
    expect(new WorkoutPlanV2Formatter().formatActivity(value)).toContain(
      'máximo de repetições mantendo técnica',
    );
    expect(
      workoutPrescriptionIssues(
        value,
        { ...block, work: null },
        context,
        strategy,
      ),
    ).toContainEqual(expect.objectContaining({ code: 'INVALID_PARAMETER' }));
  });
  it.each([
    ['RUN', 'PACE_SECONDS_PER_KM', 330],
    ['RUN', 'HEART_RATE_BPM', 150],
    ['CYCLE', 'POWER_WATTS', 250],
  ] as const)(
    'allows contextual %s / %s instead of rejecting the unit',
    (mode, kind, target) => {
      const ctx = {
        ...context,
        metricEvidence: [
          {
            id: 'hr-observed',
            kind: 'HEART_RATE_BPM' as const,
            value: 150,
            source: 'OBSERVED' as const,
          },
        ],
      };
      const value: WorkoutActivityV2 = {
        ...strength(),
        kind: 'ENDURANCE',
        mode,
        movementPattern: 'LOCOMOTION',
        durationMinutes: 10,
        distanceKm: null,
        intensity: 'CONVERSATIONAL',
        prescription: prescription({
          execution: null,
          load: null,
          enduranceMetrics: [metric(kind, target)],
        }),
      };
      const enabled = {
        ...strategy,
        intensityPolicy: {
          ...strategy.intensityPolicy,
          exactPaceAllowed: true,
          exactHeartRateAllowed: true,
          exactPowerAllowed: true,
        },
      };
      expect(
        workoutPrescriptionIssues(
          value,
          qualitySession().blocks[1],
          ctx,
          enabled,
        ),
      ).toEqual([]);
      expect(new WorkoutPlanV2Formatter().formatActivity(value)).toContain(
        kind === 'PACE_SECONDS_PER_KM'
          ? '5:30/km'
          : kind === 'HEART_RATE_BPM'
            ? '150 bpm'
            : '250 W',
      );
      expect(
        workoutPrescriptionIssues(
          { ...value, mode: mode === 'CYCLE' ? 'RUN' : 'CYCLE' },
          qualitySession().blocks[1],
          ctx,
          enabled,
        ).length,
      ).toBe(kind === 'HEART_RATE_BPM' ? 0 : 1);
    },
  );
  it.each([
    { ...activity(), repetitions: '20 kg' },
    { ...activity(), instruction: 'Use 30 kg' },
    activity({ execution: { ...execution, minimum: 10, maximum: 8 } }),
    activity({ execution: { ...execution, kind: 'METERS' } }),
    activity({ load: metric('HEART_RATE_BPM', 150) }),
    activity({ effort: null }),
  ])(
    'rejects wrong fields, unsupported provenance, impossible execution or contradictions: %j',
    (value) => {
      expect(validate(value)).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_PARAMETER',
          severity: 'ERROR',
        }),
      );
    },
  );
  it('retains real safety and equipment/limitation errors', () => {
    const value = activity();
    expect(
      new WorkoutPlanV2Validator().validate(
        qualityCandidate([qualitySession('x', [value])]),
        context,
        { ...strategy, authorizedEquipment: ['BODYWEIGHT'] },
        true,
      ).issues,
    ).toContainEqual(
      expect.objectContaining({
        code: 'EQUIPMENT_UNAVAILABLE',
        severity: 'ERROR',
      }),
    );
    expect(
      validate(value, {
        ...context,
        movementConstraints: [
          { code: 'KNEE_LOAD', label: 'Confirmada', status: 'CONFIRMED' },
        ],
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: 'LIMITATION_CONFLICT',
        severity: 'ERROR',
      }),
    );
    expect(
      validate(value, { ...context, safetySignals: ['ACUTE_PAIN'] }),
    ).toContainEqual(
      expect.objectContaining({ code: 'INVALID_PARAMETER', severity: 'ERROR' }),
    );
  });
});
