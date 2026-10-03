import { WorkoutPlanV2Formatter } from './workout-plan-v2.formatter';
import { presentWorkoutSeconds } from './workout-duration.presenter';
import {
  qualityPlan,
  qualitySession,
  strength,
} from './workout-quality.fixtures';

describe('Workout human presentation', () => {
  it('presents all TIMED clocks humanly without modifying their values', () => {
    const activity = {
      ...strength(),
      kind: 'TIMED' as const,
      rounds: 2,
      durationSeconds: 300,
      workSeconds: 90,
      recoverySeconds: 40,
    };
    const before = JSON.stringify(activity);
    const text = new WorkoutPlanV2Formatter().formatActivity(activity);
    expect(text).toContain('5 min no total');
    expect(text).toContain('Trabalho: 1 min 30 s');
    expect(text).toContain('Recuperação: 40 s');
    expect(JSON.stringify(activity)).toBe(before);
  });
  it.each([
    [300, '5 min'],
    [90, '1 min 30 s'],
    [30, '30 s'],
  ])('presents %s seconds as %s', (seconds, expected) => {
    expect(presentWorkoutSeconds(seconds)).toBe(expected);
  });
  it('retains total, hold and repetitions together', () => {
    const text = new WorkoutPlanV2Formatter().formatActivity({
      ...strength(),
      kind: 'MOBILITY',
      durationSeconds: 300,
      holdSeconds: 30,
      repetitions: '3 por lado',
    });
    expect(text).toContain(
      '5 min no total · sustente 30 s por posição · 3 por lado',
    );
    expect(text).not.toContain('300s.');
  });
  it('opens once, uses the name once and keeps five sessions and prescriptions', () => {
    const plan = qualityPlan();
    const text = new WorkoutPlanV2Formatter()
      .format(plan, {
        preferredName: 'Gildacio',
        weekdays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
      })
      .join('\n\n');
    expect(text.split(plan.title)).toHaveLength(2);
    expect(text.split('Gildacio')).toHaveLength(2);
    expect(text.split('Modalidade:')).toHaveLength(2);
    expect(text.split('Objetivo:')).toHaveLength(2);
    for (const day of ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'])
      expect(text).toContain(`*${day} —`);
    expect(text).toContain('4 × 8–12');
    expect(text).toContain('Descanso: 90 s');
    expect(text).toContain('peso corporal');
    expect(text).toContain('Intensidade: moderada');
  });
  it('keeps a natural unnamed opening and does not claim unconfirmed weekdays', () => {
    const text = new WorkoutPlanV2Formatter()
      .format(qualityPlan())
      .join('\n\n');
    expect(text).toMatch(/^Preparei/u);
    expect(text).toContain('*Sessão 1');
    expect(text).not.toContain('undefined');
  });
  it('preserves long sessions for subsequent semantic chunking', () => {
    const session = qualitySession(
      'long',
      Array.from({ length: 20 }, (_, index) => ({
        ...strength(`activity-${index}`),
        instruction: 'Mantenha o movimento confortável. '.repeat(8),
      })),
    );
    const text = new WorkoutPlanV2Formatter().formatSession(session);
    expect(text.length).toBeGreaterThan(4000);
    expect(text).toContain('Agachamento controlado');
    expect(text).not.toContain('Não consegui');
  });
});
