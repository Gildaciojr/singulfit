import {
  estimateWorkoutActivity,
  estimateWorkoutSession,
} from './workout-duration-estimator';
import { qualitySession, strength } from './workout-quality.fixtures';

describe('workout duration interval', () => {
  it('covers a representative 60-minute session without pretending exact timing', () => {
    const estimate = estimateWorkoutSession(qualitySession());
    expect(estimate.minimumMinutes).toBeLessThan(60);
    expect(estimate.maximumMinutes).toBeGreaterThan(60);
    expect(estimate.confidence).toBe('HIGH');
  });
  it('counts rest only between sets', () => {
    const estimate = estimateWorkoutActivity({
      ...strength(),
      sets: 1,
      restSeconds: 600,
    });
    expect(estimate.maximumMinutes).toBe(1.2);
  });
  it('does not multiply total timed duration or add its work/recovery again', () => {
    expect(
      estimateWorkoutActivity({
        ...strength(),
        kind: 'TIMED',
        durationSeconds: 300,
        workSeconds: 30,
        recoverySeconds: 30,
        rounds: 5,
      }),
    ).toEqual({ minimumMinutes: 5, maximumMinutes: 5, confidence: 'HIGH' });
  });
  it('reduces confidence for ambiguous repetitions and inconsistent timed clocks', () => {
    expect(
      estimateWorkoutActivity({
        ...strength(),
        repetitions: 'até fadiga técnica',
      }).confidence,
    ).toBe('LOW');
    expect(
      estimateWorkoutActivity({
        ...strength(),
        kind: 'TIMED',
        durationSeconds: 60,
        workSeconds: 30,
        recoverySeconds: 30,
        rounds: 5,
      }).confidence,
    ).toBe('LOW');
  });
  it('uses mobility total once while retaining uncertainty without a total', () => {
    expect(
      estimateWorkoutActivity({
        ...strength(),
        kind: 'MOBILITY',
        durationSeconds: 300,
        holdSeconds: 30,
        repetitions: '4',
      }).maximumMinutes,
    ).toBe(5);
    expect(
      estimateWorkoutActivity({
        ...strength(),
        kind: 'MOBILITY',
        durationSeconds: null,
        holdSeconds: 30,
        repetitions: null,
      }).confidence,
    ).toBe('LOW');
  });
});
