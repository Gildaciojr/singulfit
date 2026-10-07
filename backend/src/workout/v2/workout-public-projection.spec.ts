import { WorkoutPlanV2Formatter } from './workout-plan-v2.formatter';
import {
  projectWorkoutActivity,
  projectWorkoutRepetitions,
} from './workout-public-projection';
import { workoutPublicTextIssues } from './workout-public-text.policy';
import { WorkoutPlanV2Validator } from './workout-plan-v2.validator';
import { CurrentWorkoutPlanReaderService } from './current-workout-plan-reader.service';
import { WorkoutPlanV2StoredDocumentParser } from './workout-plan-v2-stored-document.parser';
import { WorkoutPlanningStrategyService } from './workout-planning-strategy.service';
import {
  qualityCandidate,
  qualityContext,
  qualityPlan,
  qualitySession,
  strength,
} from './workout-quality.fixtures';
import type { PrismaService } from '../../prisma/prisma.service';
import type {
  WorkoutPlanV2,
  WorkoutActivityV2,
  WorkoutPublicExerciseIdentity,
  WorkoutBlockV2,
} from './workout-plan-v2.contract';
import { projectWorkoutHumanName } from './workout-human-name.policy';
import { commercialWorkoutPlan } from './workout-commercial-quality.fixtures';
import {
  WORKOUT_PLANNING_V2_PROMPT_V9,
  WORKOUT_PLANNING_V2_PROMPT_V10,
} from './workout-planning-v2.prompt.definition';

describe('Fail-closed Workout public projection', () => {
  const woodchop: WorkoutActivityV2 = {
    ...strength(),
    name: 'Woodchop no cabo',
    movementPattern: 'CORE',
    equipment: ['CABLE'],
    publicIdentity: {
      targetRegion: 'TRUNK',
      jointAction: 'ROTATION',
      bodyPosition: 'SEATED',
      plane: 'TRANSVERSE',
    },
  };
  it.each(['TRUNK', 'WHOLE_BODY'] as const)(
    'preserves CORE Woodchop with explicit rotation of %s',
    (targetRegion) => {
      const activity = {
        ...woodchop,
        publicIdentity: { ...woodchop.publicIdentity!, targetRegion },
      };
      expect(projectWorkoutActivity(activity).displayName).toBe(
        'Woodchop no cabo',
      );
      const output = new WorkoutPlanV2Formatter().formatActivity(activity);
      expect(output).toContain('Woodchop no cabo');
      expect(output).not.toContain('Estabilização do tronco sentado no cabo');
    },
  );
  it.each<WorkoutActivityV2>([
    { ...woodchop, equipment: ['BODYWEIGHT'] },
    { ...woodchop, publicIdentity: null },
    {
      ...woodchop,
      publicIdentity: {
        ...woodchop.publicIdentity!,
        jointAction: 'STABILIZATION',
      },
    },
    {
      ...woodchop,
      publicIdentity: { ...woodchop.publicIdentity!, targetRegion: 'CHEST' },
    },
    { ...woodchop, movementPattern: 'PUSH' },
  ])('rejects incompatible Woodchop semantics: %j', (activity) => {
    expect(projectWorkoutHumanName(activity)).toBeNull();
    expect(projectWorkoutActivity(activity).displayName).not.toBe(
      'Woodchop no cabo',
    );
  });
  const mobility: WorkoutActivityV2 = {
    ...strength(),
    kind: 'MOBILITY',
    movementPattern: 'MOBILITY',
    name: 'Mobilidade dinâmica geral',
    repetitions: null,
    holdSeconds: null,
    durationSeconds: 120,
    publicIdentity: {
      targetRegion: 'WHOLE_BODY',
      jointAction: null,
      bodyPosition: 'STANDING',
      plane: 'NONE',
    },
  };
  it.each([
    'Mobilidade dinâmica geral',
    'Mobilidade dinâmica',
    'Mobilidade final',
  ])('preserves safe whole-body mobility name: %s', (name) => {
    expect(projectWorkoutActivity({ ...mobility, name }).displayName).toBe(
      name,
    );
    expect(
      new WorkoutPlanV2Formatter().formatActivity({ ...mobility, name }),
    ).toContain(name);
  });
  it.each([
    'Faça qualquer mobilidade',
    'Escolha uma mobilidade',
    'Mobilidade não disponível',
    'Use 20 kg na mobilidade',
    'Mobilidade dinâmica geral e depois faça burpees',
  ])('rejects unsafe mobility name: %s', (name) => {
    expect(projectWorkoutHumanName({ ...mobility, name })).toBeNull();
  });
  it.each<WorkoutActivityV2>([
    { ...mobility, movementPattern: 'CORE' },
    { ...mobility, publicIdentity: null },
    {
      ...mobility,
      publicIdentity: { ...mobility.publicIdentity!, targetRegion: 'CHEST' },
    },
  ])('rejects contradictory or absent mobility identity: %j', (activity) => {
    expect(projectWorkoutHumanName(activity)).toBeNull();
  });
  it.each(['WARM_UP', 'COOLDOWN'] as const)(
    'omits only the single-round continuous heading for %s without changing clocks',
    (type) => {
      const session = qualitySession('presentation', [mobility]);
      const block: WorkoutBlockV2 = {
        ...session.blocks[0],
        type,
        work: {
          format: 'CONTINUOUS',
          rounds: 1,
          durationSeconds: 240,
          intervalSeconds: null,
          movementActivityKeys: [mobility.activityKey],
        },
      };
      const value = { ...session, blocks: [block] };
      const before = JSON.stringify(value);
      const output = new WorkoutPlanV2Formatter().formatSession(value);
      expect(output).not.toContain('Circuito contínuo');
      expect(output).toContain('Mobilidade dinâmica geral');
      expect(output).toContain('Tempo total: 2 min');
      expect(JSON.stringify(value)).toBe(before);
    },
  );
  it.each([
    'AMRAP',
    'EMOM',
    'FOR_TIME',
    'INTERVAL',
    'ROUNDS',
    'CHIPPER',
    'CONTINUOUS',
  ] as const)('retains %s work outside the exact suppressed case', (format) => {
    const session = qualitySession('presentation', [strength()]);
    const block: WorkoutBlockV2 = {
      ...session.blocks[0],
      type: format === 'CONTINUOUS' ? 'STRENGTH' : 'WARM_UP',
      work: {
        format,
        rounds: 1,
        durationSeconds: 240,
        intervalSeconds: null,
        movementActivityKeys: [strength().activityKey],
      },
    };
    expect(
      new WorkoutPlanV2Formatter().formatSession({
        ...session,
        blocks: [block],
      }),
    ).toContain('· 4 min');
  });
  it('retains continuous warm-up with multiple rounds', () => {
    const session = qualitySession('presentation', [strength()]);
    const block: WorkoutBlockV2 = {
      ...session.blocks[0],
      type: 'WARM_UP',
      work: {
        format: 'CONTINUOUS',
        rounds: 2,
        durationSeconds: 240,
        intervalSeconds: null,
        movementActivityKeys: [strength().activityKey],
      },
    };
    expect(
      new WorkoutPlanV2Formatter().formatSession({
        ...session,
        blocks: [block],
      }),
    ).toContain('Circuito contínuo');
  });
  it.each([
    ['HYPERTROPHY', '💪 *Acessórios*'],
    ['CORE', '🧱 *Core*'],
  ] as const)('uses the fixed public label for %s', (type, label) => {
    const session = qualitySession('presentation', [strength()]);
    const output = new WorkoutPlanV2Formatter().formatSession({
      ...session,
      blocks: [{ ...session.blocks[0], type, title: 'Bloco de treino' }],
    });
    expect(output).toContain(label);
    expect(output).not.toContain('💪 *Bloco de treino*');
  });
  const formatter = new WorkoutPlanV2Formatter();
  const context = qualityContext(['MONDAY']);
  const strategy = new WorkoutPlanningStrategyService().build(context);
  const humanNames: readonly Readonly<{
    name: string;
    pattern: WorkoutActivityV2['movementPattern'];
    region: WorkoutPublicExerciseIdentity['targetRegion'];
    position: WorkoutPublicExerciseIdentity['bodyPosition'];
    plane: WorkoutPublicExerciseIdentity['plane'];
    equipment: WorkoutActivityV2['equipment'];
  }>[] = [
    {
      name: 'Flexão de braços',
      pattern: 'PUSH',
      region: 'CHEST',
      position: 'PRONE',
      plane: 'HORIZONTAL',
      equipment: ['BODYWEIGHT'],
    },
    {
      name: 'Avanço alternado',
      pattern: 'SQUAT',
      region: 'HIPS',
      position: 'STANDING',
      plane: 'SAGITTAL',
      equipment: ['BODYWEIGHT'],
    },
    {
      name: 'Ponte de quadril',
      pattern: 'HINGE',
      region: 'HIPS',
      position: 'LYING',
      plane: 'SAGITTAL',
      equipment: ['BODYWEIGHT'],
    },
    {
      name: 'Farmer carry com halteres',
      pattern: 'CARRY',
      region: 'WHOLE_BODY',
      position: 'STANDING',
      plane: 'SAGITTAL',
      equipment: ['DUMBBELL'],
    },
    {
      name: 'Snatch técnico com barra',
      pattern: 'HINGE',
      region: 'WHOLE_BODY',
      position: 'STANDING',
      plane: 'SAGITTAL',
      equipment: ['BARBELL'],
    },
    {
      name: 'Jerk técnico com barra',
      pattern: 'PUSH',
      region: 'SHOULDERS',
      position: 'STANDING',
      plane: 'VERTICAL',
      equipment: ['BARBELL'],
    },
    {
      name: 'Pull-up assistido',
      pattern: 'PULL',
      region: 'BACK',
      position: 'HANGING',
      plane: 'VERTICAL',
      equipment: ['PULL_UP_BAR'],
    },
    {
      name: 'Burpee adaptado',
      pattern: 'LOCOMOTION',
      region: 'WHOLE_BODY',
      position: 'STANDING',
      plane: 'SAGITTAL',
      equipment: ['BODYWEIGHT'],
    },
    {
      name: 'Agachamento goblet com kettlebell',
      pattern: 'SQUAT',
      region: 'HIPS',
      position: 'STANDING',
      plane: 'SAGITTAL',
      equipment: ['KETTLEBELL'],
    },
    {
      name: 'Puxada neutra na polia',
      pattern: 'PULL',
      region: 'BACK',
      position: 'SEATED',
      plane: 'VERTICAL',
      equipment: ['CABLE'],
    },
    {
      name: 'Clean técnico com barra',
      pattern: 'HINGE',
      region: 'WHOLE_BODY',
      position: 'STANDING',
      plane: 'SAGITTAL',
      equipment: ['BARBELL'],
    },
    {
      name: 'Agachamento livre',
      pattern: 'SQUAT',
      region: 'HIPS',
      position: 'STANDING',
      plane: 'SAGITTAL',
      equipment: ['BODYWEIGHT'],
    },
    {
      name: 'Levantamento terra romeno com barra',
      pattern: 'HINGE',
      region: 'HIPS',
      position: 'STANDING',
      plane: 'SAGITTAL',
      equipment: ['BARBELL'],
    },
    {
      name: 'Supino inclinado com barra',
      pattern: 'PUSH',
      region: 'CHEST',
      position: 'INCLINED',
      plane: 'HORIZONTAL',
      equipment: ['BARBELL'],
    },
    {
      name: 'Supino reto com halteres',
      pattern: 'PUSH',
      region: 'CHEST',
      position: 'LYING',
      plane: 'HORIZONTAL',
      equipment: ['DUMBBELL'],
    },
    {
      name: 'Remada unilateral com halter',
      pattern: 'PULL',
      region: 'BACK',
      position: 'INCLINED',
      plane: 'HORIZONTAL',
      equipment: ['DUMBBELL'],
    },
    {
      name: 'Remada baixa no cabo',
      pattern: 'PULL',
      region: 'BACK',
      position: 'SEATED',
      plane: 'HORIZONTAL',
      equipment: ['CABLE'],
    },
    {
      name: 'Leg press',
      pattern: 'SQUAT',
      region: 'KNEES',
      position: 'SEATED',
      plane: 'SAGITTAL',
      equipment: ['MACHINE'],
    },
    {
      name: 'Prancha frontal',
      pattern: 'CORE',
      region: 'TRUNK',
      position: 'LYING',
      plane: 'NONE',
      equipment: ['BODYWEIGHT'],
    },
    {
      name: 'Prancha lateral',
      pattern: 'CORE',
      region: 'TRUNK',
      position: 'SIDE_LYING',
      plane: 'NONE',
      equipment: ['BODYWEIGHT'],
    },
    {
      name: 'Dead bug',
      pattern: 'CORE',
      region: 'TRUNK',
      position: 'LYING',
      plane: 'NONE',
      equipment: ['BODYWEIGHT'],
    },
    {
      name: 'Woodchop no cabo',
      pattern: 'ROTATION',
      region: 'TRUNK',
      position: 'STANDING',
      plane: 'TRANSVERSE',
      equipment: ['CABLE'],
    },
    {
      name: 'Desenvolvimento em pé com barra',
      pattern: 'PUSH',
      region: 'SHOULDERS',
      position: 'STANDING',
      plane: 'VERTICAL',
      equipment: ['BARBELL'],
    },
  ];
  it.each(humanNames)(
    'presents approved human name $name instead of anatomical fallback',
    (entry) => {
      const activity: WorkoutActivityV2 = {
        ...strength(),
        name: entry.name,
        movementPattern: entry.pattern,
        equipment: entry.equipment,
        publicIdentity: {
          plane: entry.plane,
          targetRegion: entry.region,
          bodyPosition: entry.position,
          jointAction: null,
        },
      };
      const projected = projectWorkoutActivity(activity);
      expect(projected.displayName).toBe(entry.name);
      expect(projected.omittedUnverifiedText).toBe(false);
      expect(formatter.formatActivity(activity)).toContain(entry.name);
    },
  );
  it.each(humanNames)(
    'rejects contradictory family identity for $name',
    (entry) => {
      expect(
        projectWorkoutHumanName({
          ...strength(),
          name: entry.name,
          equipment: entry.equipment,
          movementPattern: entry.pattern,
          publicIdentity: {
            targetRegion: 'ELBOWS',
            bodyPosition: entry.position,
            plane: entry.plane,
            jointAction: null,
          },
        }),
      ).toBeNull();
    },
  );
  it('keeps the last fallback human without inventing a named exercise', () => {
    const activity = {
      ...strength(),
      name: 'Escolha um exercício',
      publicIdentity: null,
      movementPattern: 'HINGE' as const,
    };
    const output = formatter.formatActivity(activity);
    expect(output).toContain('Extensão de quadril');
    expect(output).not.toMatch(/Padrão de|dobradiça|Escolha um exercício/u);
    expect(projectWorkoutActivity(activity).omittedUnverifiedText).toBe(true);
  });
  it.each([
    'Bicicleta não disponível',
    'Exercício não definido',
    'Use 100 kg no agachamento',
    'Escolha qualquer exercício',
    'Agachamento placeholder',
    'Agachamento com HyperCable9000',
    'Agachamento com barra',
    'Leg press',
    'Prancha frontal',
    'Supino reto',
    'Agachamento 170 bpm',
    'Agachamento 250 W',
    'Agachamento a 4:30/km',
  ])(
    'falls back for unknown, unsafe or contradictory human name %s',
    (name) => {
      const projection = projectWorkoutActivity({ ...strength(), name });
      expect(projection.displayName).not.toBe(name);
      expect(projection.displayName).toBe(
        projectWorkoutActivity({ ...strength(), name: 'Unknown' }).displayName,
      );
      expect(projection.omittedUnverifiedText).toBe(true);
    },
  );
  it('rejects a contradictory public position while preserving structured endurance', () => {
    const bench = humanNames.find(
      (entry) => entry.name === 'Supino inclinado com barra',
    );
    if (!bench) throw new Error('Missing bench fixture');
    expect(
      projectWorkoutActivity({
        ...strength(),
        name: bench.name,
        movementPattern: bench.pattern,
        equipment: bench.equipment,
        publicIdentity: {
          plane: 'HORIZONTAL',
          targetRegion: 'CHEST',
          bodyPosition: 'LYING',
          jointAction: null,
        },
      }).displayName,
    ).not.toBe(bench.name);
    expect(
      projectWorkoutActivity({
        ...strength(),
        kind: 'ENDURANCE',
        mode: 'WALK',
        name: 'Bicicleta não disponível',
        durationMinutes: 5,
        distanceKm: null,
        intensity: 'CONVERSATIONAL',
      }).displayName,
    ).toBe('Caminhada');
  });
  it.each([
    ['8', '8'],
    ['8-10', '8-10'],
    ['8-10 por lado', '8-10 por lado'],
    ['8 reps', '8'],
    ['10 repetições por perna', '10 por perna'],
    ['30 s', '30 s'],
    ['30-45 s', '30-45 s'],
    ['30 s por lado', '30 s por lado'],
    ['30-40 s por lado', '30-40 s por lado'],
    ['30 segundos', '30 s'],
    ['30-45 segundos por lado', '30-45 s por lado'],
    [' 30 – 45 SEGUNDOS por lado ', '30-45 s por lado'],
  ])(
    'projects only structured numeric prescriptions: %s',
    (input, expected) => {
      expect(projectWorkoutRepetitions(input)).toBe(expected);
    },
  );

  it.each([
    'até falhar',
    '30 s até falhar',
    '30 segundos com carga máxima',
    'segure o máximo possível',
    '30 s e depois faça burpees',
    '0 s',
    '-30 s',
    '45-30 s',
    '30.5 s',
    '30 min',
    '9007199254740992 s',
    '30-9007199254740992 s',
  ])('rejects free text or invalid timed prescriptions: %s', (input) => {
    expect(projectWorkoutRepetitions(input)).toBeNull();
  });

  const incidentPrescriptions = [
    ['CF1_M3', 'Prancha com toque de ombro', 'CORE', '20 toques', 'BODYWEIGHT'],
    ['CF2_M1', 'Farmer carry com halteres', 'CARRY', '40-60 m', 'DUMBBELL'],
    [
      'CF3_M1',
      'Suitcase carry com halter',
      'CARRY',
      '30-40 m por lado',
      'DUMBBELL',
    ],
    ['CF3_SK_1', 'Dead bug', 'CORE', '8-10 alternando lados', 'BODYWEIGHT'],
  ] as const;
  const incidentActivities: readonly WorkoutActivityV2[] =
    incidentPrescriptions.map(
      ([activityKey, name, movementPattern, repetitions, equipment]) => ({
        ...strength(activityKey),
        name,
        movementPattern,
        repetitions,
        equipment: [equipment],
        publicIdentity: {
          targetRegion: movementPattern === 'CORE' ? 'TRUNK' : 'WHOLE_BODY',
          plane: 'NONE',
          bodyPosition: movementPattern === 'CORE' ? 'LYING' : 'STANDING',
          jointAction: movementPattern === 'CORE' ? 'STABILIZATION' : null,
        },
      }),
    );
  it.each(incidentActivities)(
    'projects production prescription $activityKey: $repetitions',
    (activity) => {
      if (activity.kind !== 'STRENGTH')
        throw new Error('Expected strength fixture');
      expect(projectWorkoutActivity(activity).repetitions).toBe(
        activity.repetitions,
      );
      expect(formatter.formatActivity(activity).replace(/–/gu, '-')).toContain(
        activity.repetitions,
      );
    },
  );
  it('validates the four CrossFit incident prescriptions through the shared public policy', () => {
    const crossfitContext = {
      ...context,
      modality: { status: 'CONFIRMED' as const, value: 'CROSSFIT' as const },
    };
    const crossfitStrategy = {
      ...new WorkoutPlanningStrategyService().build(crossfitContext),
      authorizedEquipment: ['BODYWEIGHT', 'DUMBBELL'] as const,
    };
    const candidate = {
      ...qualityCandidate([
        qualitySession('crossfit-incident', incidentActivities),
      ]),
      modality: 'CROSSFIT' as const,
    };
    expect(
      new WorkoutPlanV2Validator().validate(
        candidate,
        crossfitContext,
        crossfitStrategy,
        true,
      ).issues,
    ).not.toContainEqual(
      expect.objectContaining({ code: 'PUBLIC_REPETITIONS_REQUIRED' }),
    );
  });
  it.each([
    ['CORE', '20 toque', '20 toques'],
    ['CORE', '12-16 toques', '12-16 toques'],
    ['CORE', '8 alternando lados', '8 alternando lados'],
    ['CORE', '8 – 10 ALTERNANDO LADOS', '8-10 alternando lados'],
    ['CARRY', '40 m', '40 m'],
  ] as const)(
    'normalizes closed prescriptions %s / %s',
    (movementPattern, repetitions, expected) => {
      expect(
        projectWorkoutActivity({ ...strength(), movementPattern, repetitions })
          .repetitions,
      ).toBe(expected);
    },
  );
  it.each([
    ['PUSH', '40-60 m'],
    ['SQUAT', '30 m'],
    ['CORE', '20 qualquer coisa'],
    ['CORE', '20 explosivos'],
    ['CORE', '20 pesados'],
    ['CORE', '20 movimentos livres'],
    ['CORE', '8-10 rápido'],
    ['CORE', '8-10 até falhar'],
    ['CARRY', '40-60 kg'],
    ['CARRY', '80% 1RM'],
    ['CARRY', '40 lb'],
    ['CARRY', '40 lbs'],
    ['CARRY', '40 km/h'],
    ['CARRY', '40 mph'],
    ['CARRY', '40 watts'],
    ['CARRY', '40 W'],
    ['CARRY', '40 bpm'],
    ['CORE', 'ritmo forte'],
    ['CORE', 'o máximo possível'],
    ['CORE', '8-10 alternando lados e depois 20 kg'],
    ['CARRY', '60-40 m'],
    ['CARRY', '0 m'],
    ['CARRY', '9007199254740992 m'],
    ['CORE', '0 toques'],
    ['CORE', '10-8 alternando lados'],
  ] as const)(
    'rejects incompatible or unstructured prescriptions %s / %s',
    (movementPattern, repetitions) => {
      const activity = { ...strength(), movementPattern, repetitions };
      expect(projectWorkoutActivity(activity).repetitions).toBeNull();
      expect(
        new WorkoutPlanV2Validator().validate(
          qualityCandidate([qualitySession('rejected', [activity])]),
          context,
          strategy,
          true,
        ).issues,
      ).toContainEqual(
        expect.objectContaining({
          code: 'PUBLIC_REPETITIONS_REQUIRED',
          severity: 'ERROR',
        }),
      );
    },
  );
  it.each(['40 m', '40-60 m', '30-40 m por lado'])(
    'rejects distance without explicit CARRY context: %s',
    (value) => {
      expect(projectWorkoutRepetitions(value)).toBeNull();
    },
  );

  it.each(['30-45 s', '30-40 s por lado'])(
    'validates safe timed STRENGTH without removing the repetitions guard: %s',
    (repetitions) => {
      const candidate = qualityCandidate([
        {
          ...qualitySession('s1', [{ ...strength(), repetitions }]),
          weekday: 'MONDAY',
        },
      ]);
      const validator = new WorkoutPlanV2Validator();
      const result = validator.validate(candidate, context, strategy, true);
      expect(
        result.issues.filter((issue) => issue.severity === 'ERROR'),
      ).toEqual([]);
      expect(result.issues).not.toContainEqual(
        expect.objectContaining({ code: 'PUBLIC_REPETITIONS_REQUIRED' }),
      );
      const unsafe = qualityCandidate([
        {
          ...qualitySession('s1', [
            { ...strength(), repetitions: '30 s até falhar' },
          ]),
          weekday: 'MONDAY',
        },
      ]);
      expect(
        validator.validate(unsafe, context, strategy, true).issues,
      ).toContainEqual(
        expect.objectContaining({
          code: 'PUBLIC_REPETITIONS_REQUIRED',
          severity: 'ERROR',
        }),
      );
    },
  );

  it('composes distinct presses, rows and hinges from AI-authored execution facts', () => {
    const bench = {
      ...strength(),
      name: 'Supino reto com halteres',
      movementPattern: 'PUSH' as const,
      equipment: ['DUMBBELL' as const],
      publicIdentity: {
        plane: 'HORIZONTAL' as const,
        targetRegion: 'CHEST' as const,
        bodyPosition: 'LYING' as const,
        jointAction: null,
      },
    };
    const overhead = {
      ...bench,
      name: 'Desenvolvimento sentado com halteres',
      publicIdentity: {
        plane: 'VERTICAL' as const,
        targetRegion: 'SHOULDERS' as const,
        bodyPosition: 'SEATED' as const,
        jointAction: null,
      },
    };
    const authorized = {
      ...strategy,
      authorizedEquipment: ['DUMBBELL' as const],
    };
    for (const activity of [bench, overhead]) {
      expect(
        new WorkoutPlanV2Validator()
          .validate(
            qualityCandidate([
              { ...qualitySession('s1', [activity]), weekday: 'MONDAY' },
            ]),
            context,
            authorized,
            true,
          )
          .issues.filter((issue) => issue.severity === 'ERROR'),
      ).toEqual([]);
      expect(formatter.formatActivity(activity, 1, authorized)).toContain(
        'halteres',
      );
      expect(formatter.formatActivity(activity, 1, strategy)).not.toContain(
        'halteres',
      );
    }
    expect(projectWorkoutActivity(bench).displayName).toMatch(
      /supino.*reto.*halteres/iu,
    );
    expect(projectWorkoutActivity(overhead).displayName).toMatch(
      /desenvolvimento.*sentado.*halteres/iu,
    );
    expect(projectWorkoutActivity(bench).displayName).not.toBe(
      projectWorkoutActivity(overhead).displayName,
    );
    const row = {
      ...bench,
      movementPattern: 'PULL' as const,
      publicIdentity: {
        ...bench.publicIdentity,
        targetRegion: 'BACK' as const,
      },
    };
    const hinge = {
      ...bench,
      movementPattern: 'HINGE' as const,
      publicIdentity: {
        ...bench.publicIdentity,
        targetRegion: 'HIPS' as const,
        bodyPosition: 'STANDING' as const,
      },
    };
    expect(projectWorkoutActivity(row).displayName).not.toBe(
      projectWorkoutActivity(hinge).displayName,
    );
  });
  it('preserves specific identity for all 24 commercial non-endurance activities', () => {
    const activities = commercialWorkoutPlan()
      .sessions.flatMap((session) =>
        session.blocks.flatMap((block) => block.activities),
      )
      .filter((activity) => activity.kind !== 'ENDURANCE');
    expect(activities).toHaveLength(24);
    for (const activity of activities) {
      expect(activity.publicIdentity).toBeDefined();
      expect(projectWorkoutActivity(activity).displayName).not.toMatch(
        /plano sagital|plano frontal|plano transversal/u,
      );
      expect(projectWorkoutActivity(activity).displayName).not.toMatch(
        /Movimento do bloco|Movimento de empurrar/u,
      );
    }
  });
  it('keeps structured interval/easy running and gymnastics/weightlifting distinguishable', () => {
    const source = commercialWorkoutPlan().sessions[0].blocks[0].activities[0];
    if (source.kind !== 'ENDURANCE')
      throw new Error('Expected endurance fixture');
    const run = {
      ...source,
      mode: 'RUN' as const,
      equipment: ['BODYWEIGHT' as const],
      name: 'Corrida',
      intensity: 'CONVERSATIONAL' as const,
    };
    const base = qualitySession('run', [run]);
    const easy = formatter.formatSession(base);
    const interval = formatter.formatSession({
      ...base,
      blocks: [
        {
          ...base.blocks[0],
          work: {
            format: 'INTERVAL',
            durationSeconds: 600,
            rounds: 5,
            intervalSeconds: 120,
            movementActivityKeys: [run.activityKey],
          },
          activities: [{ ...run, intensity: 'MODERATE' }],
        },
      ],
    });
    expect(easy).toMatch(/Corrida.*|conversacional/su);
    expect(interval).toContain('Intervalado');
    expect(interval).toContain('moderada');
    expect(interval).not.toBe(easy);
    const gym = formatter.formatSession({
      ...base,
      blocks: [
        {
          ...base.blocks[0],
          type: 'GYMNASTICS',
          activities: [
            {
              ...strength(),
              movementPattern: 'PULL',
              publicIdentity: {
                plane: 'VERTICAL',
                targetRegion: 'BACK',
                bodyPosition: 'HANGING',
                jointAction: null,
              },
            },
          ],
        },
      ],
    });
    const lift = formatter.formatSession({
      ...base,
      blocks: [
        {
          ...base.blocks[0],
          type: 'WEIGHTLIFTING',
          activities: [
            {
              ...strength(),
              movementPattern: 'HINGE',
              publicIdentity: {
                plane: 'SAGITTAL',
                targetRegion: 'WHOLE_BODY',
                bodyPosition: 'STANDING',
                jointAction: null,
              },
            },
          ],
        },
      ],
    });
    expect(gym).toMatch(/Ginástica.*Puxada.*suspenso/su);
    expect(lift).toMatch(/Levantamento olímpico.*Extensão de quadril.*em pé/su);
    expect(gym).not.toBe(lift);
  });
  it.each([
    [
      'Mantenha coluna neutra e controle a descida',
      /coluna neutra.*controle a descida/iu,
    ],
    ['Evite compensar com a lombar', /evite compensar com a lombar/iu],
    ['Mantenha a respiração controlada', /respiração controlada/iu],
    ['Preserve a técnica', /preserve a técnica/iu],
    ['Pare se sentir dor', /pare se sentir dor/iu],
    ['Mantenha coluna neutra e use SkiErg em 250 W', /coluna neutra/iu],
    ['Controle a descida e use 20 kg', /controle a descida/iu],
    ['Corra a 4:30/km mantendo postura relaxada', /postura relaxada/iu],
  ])(
    'publishes only positively classified coaching clauses: %s',
    (instruction, safe) => {
      const output = formatter.formatActivity({
        ...strength(),
        instruction,
        alerts: [instruction],
      });
      expect(output).toMatch(safe);
      expect(output).not.toMatch(/SkiErg|250 W|20 kg|4:30\/km/iu);
    },
  );
  it('requires execution identity only for newly validated V10 activities', () => {
    const candidate = qualityCandidate([
      {
        ...qualitySession('s1', [{ ...strength(), publicIdentity: undefined }]),
        weekday: 'MONDAY',
      },
    ]);
    const validator = new WorkoutPlanV2Validator();
    expect(
      validator.validate(candidate, context, strategy, true).issues,
    ).toContainEqual(
      expect.objectContaining({
        code: 'PUBLIC_IDENTITY_REQUIRED',
        severity: 'ERROR',
      }),
    );
    expect(
      validator.validate(candidate, context, strategy, false, false).issues,
    ).not.toContainEqual(
      expect.objectContaining({ code: 'PUBLIC_IDENTITY_REQUIRED' }),
    );
  });
  it.each([
    'SkiErg',
    'XTrainerPro',
    'medicine ball',
    'wall ball',
    'plyo box',
    'TRX',
    'rings',
    'battle rope',
    'HyperCable9000',
    `InventedResource_${'x'.repeat(33)}`,
  ])('never publishes unknown objective modifiers: %s', (term) => {
    const activity = {
      ...strength(),
      name: `Agachamento com ${term}`,
      instruction: `Use ${term}`,
      alerts: [`Faça no ${term}`],
    };
    const output = formatter.formatActivity(activity);
    expect(output).not.toContain(term);
    expect(output).toMatch(/agachamento/iu);
    expect(output).toContain('4 séries × 8–12 repetições');
    expect(projectWorkoutActivity(activity).omittedUnverifiedText).toBe(true);
    expect(activity.name).toContain(term);
    const plan = qualityPlan();
    expect(
      formatter
        .format({
          ...plan,
          title: term,
          sessions: [
            {
              ...qualitySession('s1', [activity]),
              label: term,
              blocks: [
                { ...qualitySession('s1', [activity]).blocks[0], title: term },
              ],
            },
          ],
        })
        .join('\n'),
    ).not.toContain(term);
  });
  it.each([
    ['20 kg', 'UNAUTHORIZED_EXACT_LOAD'],
    ['44 lb', 'UNAUTHORIZED_EXACT_LOAD'],
    ['100 libras', 'UNAUTHORIZED_EXACT_LOAD'],
    ['85% de 1RM', 'UNAUTHORIZED_EXACT_LOAD'],
    ['70% do seu máximo', 'UNAUTHORIZED_EXACT_LOAD'],
    ['5:00 min/km', 'UNAUTHORIZED_EXACT_PACE'],
    ['4:30/km', 'UNAUTHORIZED_EXACT_PACE'],
    ['12 km/h', 'UNAUTHORIZED_EXACT_PACE'],
    ['250 W', 'UNAUTHORIZED_EXACT_POWER'],
    ['300 watts', 'UNAUTHORIZED_EXACT_POWER'],
    ['170 bpm', 'UNAUTHORIZED_EXACT_HEART_RATE'],
  ])(
    'repairs objective free-text prescription %s and never publishes it',
    (term, code) => {
      for (const field of [
        'name',
        'instruction',
        'alerts',
        'repetitions',
      ] as const) {
        const activity = {
          ...strength(),
          ...(field === 'alerts'
            ? { alerts: [`Use ${term}`] }
            : { [field]: `Use ${term}` }),
        };
        const candidate = qualityCandidate([
          { ...qualitySession('s1', [activity]), weekday: 'MONDAY' },
        ]);
        expect(
          new WorkoutPlanV2Validator().validate(
            candidate,
            context,
            strategy,
            true,
          ).issues,
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code, severity: 'ERROR' }),
          ]),
        );
        expect(formatter.formatActivity(activity)).not.toContain(term);
      }
    },
  );
  it.each([
    'Mantenha a coluna neutra.',
    'Controle a descida.',
    'Mantenha ritmo confortável.',
    'Pare se sentir dor.',
  ])('retains positively approved coaching: %s', (instruction) => {
    expect(formatter.formatActivity({ ...strength(), instruction })).toContain(
      instruction,
    );
    expect(
      formatter.formatActivity({
        ...strength(),
        instruction: `${instruction} Use HyperCable9000.`,
      }),
    ).not.toContain('HyperCable9000');
  });
  it('distinguishes structured prescriptions from unverified text', () => {
    const endurance = {
      ...strength(),
      kind: 'ENDURANCE' as const,
      mode: 'RUN' as const,
      durationMinutes: 30,
      distanceKm: 5,
      intensity: 'CONVERSATIONAL' as const,
      instruction: 'Mantenha ritmo confortável.',
    };
    const output = formatter.formatActivity(endurance);
    expect(output).toContain('Tempo: 30 min');
    expect(output).toContain('Distância: 5 km');
    expect(output).toContain('ritmo conversacional');
    expect(
      formatter.formatActivity({
        ...strength(),
        repetitions: '10 HyperCable9000',
      }),
    ).not.toContain('HyperCable9000');
    expect(
      workoutPublicTextIssues(
        'RPE 7; 3 séries; 10 repetições; 30 min; 5 km',
        strategy,
        'test',
      ),
    ).toEqual([]);
  });
});

describe('Canonical reader rollout compatibility', () => {
  function persistedPlan(): WorkoutPlanV2 {
    const plan = qualityPlan();
    // The estimator fixture spreads STRENGTH fields into ENDURANCE objects.
    // Persisted/provider documents must obey the parser's discriminated schema.
    return {
      ...plan,
      sessions: plan.sessions.map((session) => ({
        ...session,
        blocks: session.blocks.map((block) => ({
          ...block,
          activities: block.activities.map((activity) =>
            activity.kind !== 'ENDURANCE'
              ? activity
              : {
                  activityKey: activity.activityKey,
                  name: activity.name,
                  source: activity.source,
                  movementPattern: activity.movementPattern,
                  equipment: activity.equipment,
                  instruction: activity.instruction,
                  alerts: activity.alerts,
                  appliedConstraintCodes: activity.appliedConstraintCodes,
                  kind: activity.kind,
                  mode: activity.mode,
                  durationMinutes: activity.durationMinutes,
                  distanceKm: activity.distanceKm,
                  intensity: activity.intensity,
                },
          ),
        })),
      })),
    };
  }
  const weekdays = [
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY',
  ] as const;
  function subject(name: string, document: WorkoutPlanV2) {
    const record = {
      id: 'aggregate',
      userId: 'user',
      generatedAt: new Date(),
      aiJob: {
        id: 'job',
        userId: 'user',
        type: 'WORKOUT',
        status: 'COMPLETED',
        result: { acceptedOutput: document },
        promptVersion: { name },
      },
      days: weekdays.map((weekday, index) => ({
        dayNumber: index + 1,
        weekday,
      })),
      user: { preferences: { timezone: 'America/Sao_Paulo' } },
    };
    const findFirst = jest.fn(
      (query: {
        where: {
          aiJob?: { promptVersion: { name: { in: readonly string[] } } };
        };
      }) =>
        Promise.resolve(
          query.where.aiJob?.promptVersion.name.in.includes(name)
            ? record
            : null,
        ),
    );
    const reader = new CurrentWorkoutPlanReaderService(
      { workoutPlan: { findFirst } } as unknown as PrismaService,
      new WorkoutPlanV2StoredDocumentParser(),
    );
    return { reader, findFirst };
  }
  it('accepts active V9 without adding weekday, work or roles', async () => {
    const document = persistedPlan();
    const { reader } = subject(WORKOUT_PLANNING_V2_PROMPT_V9.name, document);
    const result = await reader.read('user', true);
    expect(result.status).toBe('AVAILABLE');
    if (result.status !== 'AVAILABLE') throw new Error('V9 unavailable');
    expect(result.plan.document.sessions[0].weekday).toBeUndefined();
    expect(result.plan.document.sessions[0].blocks[0].work).toBeUndefined();
    expect(result.plan.calendar[0].weekday).toBe('MONDAY');
    expect(
      await reader.present(
        'user',
        'segunda',
        new Date('2026-10-05T15:00:00Z'),
        true,
      ),
    ).toContain('Agachamento');
  });
  it('accepts active V10 and preserves the AI weekday and structured work', async () => {
    const plan = persistedPlan();
    const work = {
      format: 'AMRAP' as const,
      durationSeconds: 600,
      rounds: null,
      intervalSeconds: null,
      movementActivityKeys: [
        plan.sessions[0].blocks[0].activities[0].activityKey,
      ],
    };
    const document = {
      ...plan,
      sessions: plan.sessions.map((session, i) => ({
        ...session,
        weekday: weekdays[i],
        blocks:
          i === 0
            ? [{ ...session.blocks[0], work }, ...session.blocks.slice(1)]
            : session.blocks,
      })),
    };
    const { reader, findFirst } = subject(
      WORKOUT_PLANNING_V2_PROMPT_V10.name,
      document,
    );
    const result = await reader.read('user', true);
    expect(result.status).toBe('AVAILABLE');
    if (result.status !== 'AVAILABLE') throw new Error('V10 unavailable');
    expect(result.plan.document.sessions[0].weekday).toBe('MONDAY');
    expect(result.plan.document.sessions[0].blocks[0].work).toEqual(work);
    expect(
      await reader.present(
        'user',
        'segunda',
        new Date('2026-10-05T15:00:00Z'),
        true,
      ),
    ).toContain('AMRAP');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });
  it('projects unknown V10 overview headings rather than exposing raw text', async () => {
    const plan = persistedPlan();
    const { reader } = subject(WORKOUT_PLANNING_V2_PROMPT_V10.name, {
      ...plan,
      title: 'Treino no HyperCable9000',
      sessions: plan.sessions.map((session) => ({
        ...session,
        label: 'Use XTrainerPro',
      })),
    });
    const output = await reader.present('user', 'meu plano', new Date(), true);
    expect((await reader.read('user', true)).status).toBe('AVAILABLE');
    expect(output).not.toMatch(/HyperCable9000|XTrainerPro/u);
  });
});
