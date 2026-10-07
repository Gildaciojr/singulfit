import { GenerateWorkoutPlanV2InputBuilder } from './generate-workout-plan-v2-input.builder';
import { createHash } from 'node:crypto';
import type { CoachProfileSnapshot } from '../../context/coach-profile-snapshot.contract';
import {
  knownDatum,
  routingSnapshot,
} from '../../conversation/tests/conversation-routing.fixtures';
import { WorkoutPlanningEngineV2Service } from './workout-planning-engine-v2.service';
import { WorkoutArtifactResolverService } from './workout-artifact-resolver.service';
import { WorkoutPlanningReadinessService } from './workout-planning-readiness.service';
import { WorkoutPlanningContextBuilder } from './workout-planning-context.builder';
import { WorkoutPlanningSafetyService } from './workout-planning-safety.service';
import { WorkoutPlanV2Parser } from './workout-plan-v2.parser';
import { WorkoutPlanV2Validator } from './workout-plan-v2.validator';
import { WorkoutPlanV2Formatter } from './workout-plan-v2.formatter';
import { WorkoutPlanningStrategyService } from './workout-planning-strategy.service';
import { estimateWorkoutSession } from './workout-duration-estimator';
import {
  qualityCandidate,
  qualityContext,
  qualitySession,
  strength,
} from './workout-quality.fixtures';
import type { WorkoutBlockV2 } from './workout-plan-v2.contract';

describe('Phase 2.1 objective boundaries', () => {
  const context = qualityContext(['MONDAY']);
  const strategy = new WorkoutPlanningStrategyService().build(context);
  const validator = new WorkoutPlanV2Validator();
  const formatter = new WorkoutPlanV2Formatter();
  it.each([
    ['name', 'Agachamento com kettlebell', 'UNAUTHORIZED_EQUIPMENT_REFERENCE'],
    ['instruction', 'Use bike e remo', 'UNAUTHORIZED_EQUIPMENT_REFERENCE'],
    [
      'instruction',
      'Finalize com elástico',
      'UNAUTHORIZED_EQUIPMENT_REFERENCE',
    ],
    ['instruction', 'Use 20 kg', 'UNAUTHORIZED_EXACT_LOAD'],
    ['instruction', 'Corra a 5:00 min/km', 'UNAUTHORIZED_EXACT_PACE'],
    ['instruction', 'Pedale a 250 W', 'UNAUTHORIZED_EXACT_POWER'],
    ['alerts', 'Use 20 kg', 'UNAUTHORIZED_EXACT_LOAD'],
  ])(
    'blocks public %s: %s in validation and direct projection',
    (field, text, code) => {
      const activity = {
        ...strength(),
        ...(field === 'alerts' ? { alerts: [text] } : { [field]: text }),
      };
      const candidate = qualityCandidate([
        { ...qualitySession('s1', [activity]), weekday: 'MONDAY' },
      ]);
      expect(
        validator.validate(candidate, context, strategy, true).issues,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code, severity: 'ERROR' }),
        ]),
      );
      expect(formatter.formatActivity(activity)).not.toContain(text);
    },
  );
  it.each([
    'Mantenha ritmo confortável',
    'Use carga moderada',
    'Trabalhe em esforço conversacional',
    'Escolha peso que preserve a técnica',
  ])('preserves qualitative coaching: %s', (instruction) => {
    const activity = { ...strength(), instruction };
    const candidate = qualityCandidate([
      { ...qualitySession('s1', [activity]), weekday: 'MONDAY' },
    ]);
    expect(
      validator
        .validate(candidate, context, strategy, true)
        .issues.filter((issue) => issue.severity === 'ERROR'),
    ).toEqual([]);
    expect(formatter.formatActivity(activity)).toContain(instruction);
  });
  it('uses longest equipment aliases and word boundaries', () => {
    const activity = {
      ...strength(),
      equipment: ['PULL_UP_BAR' as const],
      name: 'Barra fixa',
      movementPattern: 'PULL' as const,
      instruction: 'Mantenha a técnica, não a cabine.',
      publicIdentity: undefined,
    };
    expect(formatter.formatActivity(activity)).toContain('Barra fixa');
  });
  const builder = new GenerateWorkoutPlanV2InputBuilder(
    {} as never,
    {} as never,
  );
  it('pins historical V9 no-requestId identity to the independently audited production base', async () => {
    const base = routingSnapshot();
    const snapshot: CoachProfileSnapshot = {
      ...base,
      training: {
        ...base.training,
        primaryGoal: knownDatum('WEIGHT_LOSS'),
        preferredModality: knownDatum('RUNNING'),
        experienceLevel: knownDatum('INTERMEDIATE'),
        environment: knownDatum('FULL_GYM'),
        weeklyFrequency: knownDatum(5),
        sessionDurationMinutes: knownDatum(60),
        availableEquipment: knownDatum(['DUMBBELL']),
      },
      restrictions: {
        ...base.restrictions,
        physicalLimitations: knownDatum([]),
      },
    };
    const input = (
      await builder.build({
        userId: 'audit-user',
        profileId: 'audit-profile',
        snapshot,
        currentMessage: 'Monte Crossfit 3x, segunda, quarta e sexta',
        referenceDate: new Date(snapshot.referenceDate),
      })
    ).generationInput;
    const engine = new WorkoutPlanningEngineV2Service(
      new WorkoutArtifactResolverService(),
      new WorkoutPlanningReadinessService(),
      new WorkoutPlanningContextBuilder(),
      new WorkoutPlanningStrategyService(),
      new WorkoutPlanningSafetyService(),
      new WorkoutPlanV2Validator(),
      {} as never,
      undefined,
      { ensureActive: jest.fn() } as never,
    );
    const legacy = engine.prepare({
      ...input,
      recognizedContext:
        input.legacyV9RecognizedContext ?? input.recognizedContext,
    });
    function canonical(value: unknown): string {
      if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
        .join(',')}}`;
    }
    const identity = canonical({
      schemaVersion: 2,
      currentRequest: input.currentRequest,
      context: legacy.context,
      strategy: legacy.strategy,
      safetyPolicy: {
        noDiagnosis: true,
        noRehabilitation: true,
        noExactLoad: true,
        noExactPace: true,
        noExactPower: true,
      },
    });
    expect(
      createHash('sha256')
        .update(`audit-user:9:ai-first-v9-bounded-repair-v1:${identity}`)
        .digest('hex'),
    ).toBe('db38324f2920c6ba3160bd2bb7ae4e77c67232ee1b7d605f07ffcc4b3cb1f48c');
    expect(
      engine.prepare(input).context?.training.scheduledTrainingDays,
    ).toMatchObject({ status: 'CONFIRMED' });
    expect(legacy.context?.training.scheduledTrainingDays).toBeUndefined();
  });
  it.each([
    {
      text: 'quero segunda, quarta, sexta',
      kind: 'EXPLICIT',
      days: ['MONDAY', 'WEDNESDAY', 'FRIDAY'],
    },
    {
      text: 'quero treinar segunda, quarta e sexta',
      kind: 'EXPLICIT',
      days: ['MONDAY', 'WEDNESDAY', 'FRIDAY'],
    },
    {
      text: 'monte meu treino para segunda, quarta e sexta',
      kind: 'EXPLICIT',
      days: ['MONDAY', 'WEDNESDAY', 'FRIDAY'],
    },
    {
      text: 'Monte Crossfit 3x, segunda, quarta e sexta',
      kind: 'EXPLICIT',
      days: ['MONDAY', 'WEDNESDAY', 'FRIDAY'],
    },
    {
      text: 'posso treinar segunda, quarta e sexta',
      kind: 'AVAILABLE',
      days: ['MONDAY', 'WEDNESDAY', 'FRIDAY'],
    },
    {
      text: 'tenho disponibilidade segunda a sexta',
      kind: 'AVAILABLE',
      days: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
    },
    {
      text: 'consigo treinar segunda, terça e sábado',
      kind: 'AVAILABLE',
      days: ['MONDAY', 'TUESDAY', 'SATURDAY'],
    },
    {
      text: 'tenho disponibilidade de segunda a sexta, mas quero treinar segunda, quarta, sexta e sábado',
      kind: 'MIXED',
      days: ['MONDAY', 'WEDNESDAY', 'FRIDAY', 'SATURDAY'],
    },
    {
      text: 'monte treino 3x segunda, quarta e sexta; posso usar halteres',
      kind: 'MIXED',
      days: ['MONDAY', 'WEDNESDAY', 'FRIDAY'],
    },
  ])(
    'classifies $kind only in the weekday clause: $text',
    ({ text, kind, days }) => {
      const result = builder.recognizeDeclaredContext(text);
      expect(result.availableTrainingDays).toEqual({
        status: 'CONFIRMED',
        value: days,
      });
      expect(result.scheduledTrainingDays).toEqual(
        kind === 'AVAILABLE' ? undefined : days,
      );
    },
  );
  it.each(['AMRAP', 'EMOM', 'FOR_TIME'] as const)(
    'represents and renders a multi-movement %s with a single clock',
    (format) => {
      const block: WorkoutBlockV2 = {
        blockKey: 'wod',
        type: 'CONDITIONING',
        title: 'Condicionamento',
        estimatedDurationMinutes: 10,
        activities: [strength('a'), strength('b')],
        work: {
          format,
          durationSeconds: 600,
          rounds: format === 'EMOM' ? 10 : null,
          intervalSeconds: format === 'EMOM' ? 60 : null,
          movementActivityKeys: ['b', 'a'],
        },
      };
      const session = {
        ...qualitySession('s1'),
        weekday: 'MONDAY' as const,
        blocks: [block],
        estimatedDurationMinutes: 10,
      };
      const candidate = new WorkoutPlanV2Parser().parse(
        JSON.stringify(qualityCandidate([session])),
      );
      expect(
        validator
          .validate(candidate, context, strategy, true)
          .issues.filter((issue) => issue.severity === 'ERROR'),
      ).toEqual([]);
      expect(estimateWorkoutSession(session)).toMatchObject({
        minimumMinutes: 10,
        maximumMinutes: 10,
      });
      expect(formatter.formatSession(candidate.sessions[0])).toContain(
        format === 'FOR_TIME' ? 'Por tempo' : format,
      );
      expect(
        candidate.sessions[0].blocks[0].work?.movementActivityKeys,
      ).toEqual(['b', 'a']);
    },
  );
  it.each(['GYMNASTICS', 'WEIGHTLIFTING'] as const)(
    'parses and renders optional %s role',
    (type) => {
      const session = {
        ...qualitySession('s1', [strength()]),
        blocks: [{ ...qualitySession('s1', [strength()]).blocks[0], type }],
      };
      const parsed = new WorkoutPlanV2Parser().parse(
        JSON.stringify(qualityCandidate([session])),
      );
      expect(parsed.sessions[0].blocks[0].type).toBe(type);
      expect(formatter.formatSession(parsed.sessions[0])).toContain(
        type === 'GYMNASTICS' ? 'Ginástica' : 'Levantamento olímpico',
      );
    },
  );
  it('rejects invalid movement references and contradictory EMOM clocks', () => {
    const candidate = qualityCandidate([
      {
        ...qualitySession('s1', [strength('a')]),
        weekday: 'MONDAY',
        blocks: [
          {
            ...qualitySession('s1', [strength('a')]).blocks[0],
            work: {
              format: 'EMOM',
              durationSeconds: 600,
              rounds: 9,
              intervalSeconds: 60,
              movementActivityKeys: ['missing'],
            },
          },
        ],
      },
    ]);
    expect(
      validator.validate(candidate, context, strategy, true).issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'WORK_STRUCTURE_INVALID' }),
      ]),
    );
  });
});
