import type {
  TimedActivity,
  WorkoutActivityV2,
} from './workout-plan-v2.contract';
import { canonicalizeWorkoutTimedDurations } from './workout-timed-duration.canonicalizer';
import { WorkoutPlanV2Validator } from './workout-plan-v2.validator';
import { WorkoutPlanningStrategyService } from './workout-planning-strategy.service';
import {
  qualityCandidate,
  qualityContext,
  qualitySession,
  strength,
} from './workout-quality.fixtures';

describe('canonicalizeWorkoutTimedDurations', () => {
  function timed(overrides: Partial<TimedActivity> = {}): TimedActivity {
    return {
      ...strength('FRIDAY_STRENGTH_3'),
      kind: 'TIMED',
      name: 'Farmer walk com halteres',
      durationSeconds: 40,
      workSeconds: 40,
      recoverySeconds: 60,
      rounds: 4,
      ...overrides,
    };
  }

  it.each([
    [{}, 340],
    [{ durationSeconds: 340 }, 340],
    [{ rounds: 1, recoverySeconds: null, durationSeconds: 20 }, 40],
    [{ rounds: 1, recoverySeconds: 60, durationSeconds: 20 }, 40],
    [
      {
        workSeconds: null,
        recoverySeconds: null,
        rounds: 3,
        durationSeconds: 30,
      },
      30,
    ],
    [{ recoverySeconds: null }, 40],
    [{ workSeconds: 3600, rounds: 3, recoverySeconds: 60 }, 40],
    [{ workSeconds: 3600, rounds: 2, recoverySeconds: 0 }, 7200],
  ] satisfies readonly (readonly [Partial<TimedActivity>, number])[])(
    'derives only a known clock within the domain: %j',
    (overrides, expected) => {
      const activity = Object.freeze(timed(overrides));
      const block = Object.freeze({
        ...qualitySession().blocks[0],
        activities: Object.freeze([activity]),
      });
      const session = Object.freeze({
        ...qualitySession(),
        blocks: Object.freeze([block]),
      });
      const candidate = Object.freeze(qualityCandidate([session]));
      const before = JSON.stringify(candidate);
      const result = canonicalizeWorkoutTimedDurations(candidate);
      expect(result.sessions[0].blocks[0].activities[0]).toEqual({
        ...activity,
        durationSeconds: expected,
      });
      expect(JSON.stringify(candidate)).toBe(before);
      expect(canonicalizeWorkoutTimedDurations(result)).toBe(result);
      if (activity.durationSeconds === expected) expect(result).toBe(candidate);
      else {
        expect(result).not.toBe(candidate);
        expect(result.sessions[0]).not.toBe(session);
        expect(result.sessions[0].blocks[0]).not.toBe(block);
        expect(
          Object.isFrozen(result.sessions[0].blocks[0].activities[0]),
        ).toBe(true);
      }
    },
  );

  it('shares untouched sessions, blocks and non-TIMED activities', () => {
    const lift = strength();
    const endurance: WorkoutActivityV2 = {
      ...lift,
      kind: 'ENDURANCE',
      name: 'Caminhada',
      mode: 'WALK',
      durationMinutes: 10,
      distanceKm: null,
    };
    const mobility: WorkoutActivityV2 = {
      ...lift,
      kind: 'MOBILITY',
      name: 'Mobilidade',
      repetitions: null,
      holdSeconds: null,
      durationSeconds: 60,
    };
    const first = qualitySession('first', [timed(), lift, endurance, mobility]);
    const untouchedBlock = qualitySession('untouched').blocks[0];
    const changed = { ...first, blocks: [...first.blocks, untouchedBlock] };
    const untouchedSession = qualitySession('second');
    const result = canonicalizeWorkoutTimedDurations(
      qualityCandidate([changed, untouchedSession]),
    );
    expect(result.sessions[1]).toBe(untouchedSession);
    expect(result.sessions[0].blocks[1]).toBe(untouchedBlock);
    expect(result.sessions[0].blocks[0].activities.slice(1)).toEqual([
      lift,
      endurance,
      mobility,
    ]);
    [lift, endurance, mobility].forEach((activity, index) =>
      expect(result.sessions[0].blocks[0].activities[index + 1]).toBe(activity),
    );
  });

  it('does not clamp an excessive clock or hide the validator ERROR', () => {
    const ctx = qualityContext(['MONDAY']);
    const candidate = qualityCandidate([
      qualitySession('excessive', [timed({ workSeconds: 3600, rounds: 3 })]),
    ]);
    const normalized = canonicalizeWorkoutTimedDurations(candidate);
    expect(normalized).toBe(candidate);
    const result = new WorkoutPlanV2Validator().validate(
      normalized,
      ctx,
      new WorkoutPlanningStrategyService().build(ctx),
    );
    expect(result.status).toBe('INVALID');
    expect(result.issues).toContainEqual({
      code: 'TIMED_DURATION_IMPOSSIBLE',
      severity: 'ERROR',
      path: 'FRIDAY_STRENGTH_3',
    });
  });
});
