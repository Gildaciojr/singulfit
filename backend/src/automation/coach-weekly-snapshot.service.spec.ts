import {
  CoachWeeklySnapshotService,
  weeklyReportEnabled,
  type CoachWeeklySnapshot,
} from './coach-weekly-snapshot.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { NutritionConsumptionSummaryService } from '../nutrition/nutrition-consumption-summary.service';
import type { CurrentNutritionPlanReaderService } from '../diet/current-nutrition-plan-reader.service';
import { CoachProactiveSchedulePolicy } from './coach-proactive-schedule.policy';

describe('Factual weekly rendering and Sunday cutoff', () => {
  const renderer = new CoachWeeklySnapshotService(
    {} as PrismaService,
    {} as NutritionConsumptionSummaryService,
    {} as CurrentNutritionPlanReaderService,
  );
  const snapshot: CoachWeeklySnapshot = {
    version: 1,
    userId: 'synthetic',
    start: '2026-08-10T03:00:00Z',
    cutoff: '2026-08-16T23:00:00Z',
    timezone: 'America/Sao_Paulo',
    name: 'Teste',
    meals: 2,
    incompleteMeals: 1,
    calories: null,
    protein: null,
    carbs: null,
    fat: null,
    hydration: [{ date: '2026-08-16', volumeMl: 1300 }],
    confirmedWorkoutReports: 1,
    weights: [],
    targets: [{ date: '2026-08-16', planId: 'old', calories: 1800 }],
  };
  it('keeps Basic brief and Premium detailed within the normal WhatsApp publication size', () => {
    const input = {
      ...snapshot,
      name: 'Teste'.repeat(1000),
      previous: {
        meals: 3,
        incompleteMeals: 1,
        calories: null,
        protein: null,
        carbs: null,
        fat: null,
      },
    };
    const basic = renderer.render(input, 'BASIC');
    const premium = renderer.render(input, 'PREMIUM');
    expect(basic.length).toBeLessThanOrEqual(4000);
    expect(premium.length).toBeLessThanOrEqual(4000);
    expect(basic).not.toContain('Proteínas:');
    expect(premium).toContain('Proteínas:');
    expect(premium).toContain('Dados incompletos impedem comparar totais');
    expect(basic).not.toMatch(/fracasso|pulou|emagreceu|compensar/iu);
  });
  it('keeps actual partial coverage and separates planned targets from observed intake', () => {
    const answer = renderer.render(snapshot);
    expect(answer).toContain('2 refeições; 1 com dados incompletos');
    expect(answer).toContain('Calorias: dados incompletos');
    expect(answer).toContain('1.300 ml');
    expect(answer).toContain('1 relatos explícitos');
    expect(answer).toContain('Metas planejadas');
    expect(answer).not.toMatch(/meta atingida|emagreceu|falhou|pulou/iu);
  });
  it('does not turn an empty week into failed adherence or positive achievements', () => {
    const answer = renderer.render({
      ...snapshot,
      meals: 0,
      incompleteMeals: 0,
      hydration: [],
      confirmedWorkoutReports: 0,
      targets: [],
    });
    expect(answer).toContain(
      'Ausência de registro não significa falta de cuidado',
    );
    expect(answer).toContain('Não há volumes informados');
    expect(answer).not.toContain('1.800');
  });
  const clock = new CoachProactiveSchedulePolicy();
  it('sends after local Sunday 20h and catches up on Monday without changing the weekly cutoff', () => {
    const preferences = {
      timezone: 'America/Sao_Paulo',
      preferredWakeUpTime: '08:00',
      preferredSleepTime: '23:00',
    };
    expect(
      clock.weeklySummarySlot(new Date('2026-08-16T22:59:00Z'), preferences),
    ).toBeNull();
    expect(
      clock.weeklySummarySlot(new Date('2026-08-16T23:01:00Z'), preferences),
    ).toMatchObject({
      cutoff: new Date('2026-08-16T23:00:00Z'),
      range: { start: new Date('2026-08-10T03:00:00Z') },
    });
    expect(
      clock.weeklySummarySlot(new Date('2026-08-17T12:00:00Z'), preferences),
    ).toMatchObject({ cutoff: new Date('2026-08-16T23:00:00Z') });
  });
  it('honors quiet hours and computes local Sunday across DST', () => {
    const preferences = {
      timezone: 'America/New_York',
      preferredWakeUpTime: '08:00',
      preferredSleepTime: '19:00',
    };
    expect(
      clock.weeklySummarySlot(new Date('2026-03-09T12:29:00Z'), preferences),
    ).toBeNull();
    expect(
      clock.weeklySummarySlot(new Date('2026-03-09T12:30:00Z'), preferences),
    ).toMatchObject({
      cutoff: new Date('2026-03-09T00:00:00Z'),
      scheduledFor: new Date('2026-03-09T12:30:00Z'),
    });
  });
});

describe('Independent factual weekly rollout', () => {
  const id = '0f6e2d9a-8ad9-4bd7-9a09-661744d332d2';
  it('defaults OFF and permits only explicitly listed internal users', () => {
    expect(weeklyReportEnabled(id)).toBe(false);
    expect(weeklyReportEnabled(id, 'CANARY', id)).toBe(true);
    expect(
      weeklyReportEnabled('bd3acff0-0206-44ca-ae5c-a18732d7f214', 'CANARY', id),
    ).toBe(false);
    expect(weeklyReportEnabled(id, 'GLOBAL')).toBe(false);
    expect(weeklyReportEnabled(id, 'GLOBAL', '', 'true')).toBe(true);
  });
  it.each(['*', 'test@example.com', '12345678900', id + ',invalid', id + ','])(
    'rejects malformed allowlist %s even with global authorization',
    (ids) => {
      expect(weeklyReportEnabled(id, 'CANARY', ids)).toBe(false);
      expect(weeklyReportEnabled(id, 'GLOBAL', ids, 'true')).toBe(false);
    },
  );
  it('fails closed for non-string settings and unsupported modes', () => {
    expect(weeklyReportEnabled(id, true, id)).toBe(false);
    expect(weeklyReportEnabled(id, 'CANARY', [id])).toBe(false);
    expect(weeklyReportEnabled(id, 'GLOBAL', '', true)).toBe(false);
    expect(weeklyReportEnabled(id, 'global', '', 'true')).toBe(false);
  });
});
