import { createHash } from 'node:crypto';
import { WorkoutPlanV2Parser } from './workout-plan-v2.parser';
import { WorkoutPlanV2Validator } from './workout-plan-v2.validator';
import { WorkoutPlanningStrategyService } from './workout-planning-strategy.service';
import {
  qualityCandidate,
  qualityContext,
  qualitySession,
  strength,
} from './workout-quality.fixtures';
import {
  WORKOUT_PLANNING_V2_PROMPT_V9,
  WORKOUT_PLANNING_V2_PROMPT_V10,
} from './workout-planning-v2.prompt.definition';

describe('Workout V10 internal calendar contract', () => {
  const context = qualityContext([
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY',
  ]);
  const strategy = {
    ...new WorkoutPlanningStrategyService().build(context),
    sessionCount: 2,
  };
  const validator = new WorkoutPlanV2Validator();
  function candidate(
    days: readonly ('MONDAY' | 'THURSDAY' | 'SUNDAY' | undefined)[],
  ) {
    return qualityCandidate(
      days.map((weekday, index) => ({
        ...qualitySession(`session-${index}`, [strength(`activity-${index}`)]),
        sequence: index + 1,
        ...(weekday ? { weekday } : {}),
      })),
    );
  }
  it('keeps the complete V9 definition immutable and adds the V10 weekday requirement independently', () => {
    expect(
      createHash('sha256')
        .update(JSON.stringify(WORKOUT_PLANNING_V2_PROMPT_V9))
        .digest('hex'),
    ).toBe('502333d34b5a7c1d25433b17cda9d5515d220bcb29d9df0aeffdaa659a2324c5');
    expect(WORKOUT_PLANNING_V2_PROMPT_V10.version).toBe(10);
    expect(WORKOUT_PLANNING_V2_PROMPT_V10.model).toBe(
      WORKOUT_PLANNING_V2_PROMPT_V9.model,
    );
    expect(
      WORKOUT_PLANNING_V2_PROMPT_V10.schema.schema.properties.sessions.items
        .required,
    ).toContain('weekday');
    expect(
      WORKOUT_PLANNING_V2_PROMPT_V9.schema.schema.properties.sessions.items
        .required,
    ).not.toContain('weekday');
  });
  it('accepts a model-selected subset rather than the first available days', () => {
    const result = validator.validate(
      candidate(['MONDAY', 'THURSDAY']),
      context,
      strategy,
      true,
    );
    expect(result.issues.filter((issue) => issue.severity === 'ERROR')).toEqual(
      [],
    );
  });
  it.each([
    { days: ['MONDAY', 'MONDAY'] as const, code: 'DUPLICATE_WEEKDAY' },
    { days: ['MONDAY', 'SUNDAY'] as const, code: 'WEEKDAY_UNAVAILABLE' },
    { days: ['MONDAY', undefined] as const, code: 'WEEKDAY_REQUIRED' },
  ])('blocks $code as an objective constraint', ({ days, code }) => {
    expect(
      validator.validate(candidate(days), context, strategy, true).issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code, severity: 'ERROR' }),
      ]),
    );
  });
  it('parses legacy V9 without weekday while rejecting an invalid enum', () => {
    const parser = new WorkoutPlanV2Parser();
    const legacy = parser.parse(
      JSON.stringify(candidate([undefined, undefined])),
    );
    expect(
      validator
        .validate(legacy, context, strategy)
        .issues.some((issue) => issue.code === 'WEEKDAY_REQUIRED'),
    ).toBe(false);
    const malformed = {
      ...legacy,
      sessions: legacy.sessions.map((session) => ({
        ...session,
        weekday: 'FUNDAY',
      })),
    };
    expect(() => parser.parse(JSON.stringify(malformed))).toThrow('weekday');
  });
  it('does not reduce an explicit three-day schedule to a two-day subset', () => {
    const explicit = {
      ...context,
      training: {
        ...context.training,
        scheduledTrainingDays: {
          status: 'CONFIRMED' as const,
          value: ['MONDAY', 'WEDNESDAY', 'THURSDAY'],
        },
      },
    };
    expect(
      validator.validate(
        candidate(['MONDAY', 'THURSDAY']),
        explicit,
        strategy,
        true,
      ).issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'WEEKDAY_UNAVAILABLE',
          severity: 'ERROR',
        }),
      ]),
    );
  });
});
