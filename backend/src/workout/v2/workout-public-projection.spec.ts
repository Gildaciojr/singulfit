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
import type { WorkoutPlanV2 } from './workout-plan-v2.contract';
import { commercialWorkoutPlan } from './workout-commercial-quality.fixtures';
import {
  WORKOUT_PLANNING_V2_PROMPT_V9,
  WORKOUT_PLANNING_V2_PROMPT_V10,
} from './workout-planning-v2.prompt.definition';

describe('Fail-closed Workout public projection', () => {
  const formatter = new WorkoutPlanV2Formatter();
  const context = qualityContext(['MONDAY']);
  const strategy = new WorkoutPlanningStrategyService().build(context);
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
