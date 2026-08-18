import { CoachProactiveSchedulePolicy } from './coach-proactive-schedule.policy';

describe('CoachProactiveSchedulePolicy', () => {
  const policy = new CoachProactiveSchedulePolicy();

  it('uses local Sao Paulo time, preferred times and deterministic exact slots', () => {
    const at = new Date('2026-08-17T12:00:00.000Z');
    const preferences = {
      timezone: 'America/Sao_Paulo',
      preferredWakeUpTime: '07:00',
      preferredSleepTime: '23:00',
      preferredTrainingTime: '17:30',
      preferredMealTimes: [
        { period: 'LUNCH', time: '12:30' },
        { period: 'DINNER', time: '19:30' },
      ],
    };

    const first = policy.dailySlots(at, preferences);
    const repeated = policy.dailySlots(at, preferences);

    expect(first.map((slot) => [slot.slotKey, slot.localTime])).toEqual([
      ['GOOD_MORNING', '07:30'],
      ['LUNCH', '13:15'],
      ['WORKOUT', '18:30'],
    ]);
    expect(first.map((slot) => slot.scheduledFor.toISOString())).toEqual([
      '2026-08-17T10:30:00.000Z',
      '2026-08-17T16:15:00.000Z',
      '2026-08-17T21:30:00.000Z',
    ]);
    expect(repeated).toEqual(first);
  });

  it('converts another timezone and falls back deterministically when invalid', () => {
    const at = new Date('2026-08-18T08:00:00.000Z');
    const lisbon = policy.dailySlots(at, { timezone: 'Europe/Lisbon' });
    const invalid = policy.dailySlots(at, { timezone: 'Invalid/Timezone' });
    const fallback = policy.dailySlots(at, {
      timezone: 'America/Sao_Paulo',
    });

    expect(lisbon[0]?.scheduledFor.toISOString()).toBe(
      '2026-08-18T09:30:00.000Z',
    );
    expect(invalid).toEqual(fallback);
  });

  it('allows two legitimate hydration slots and never exceeds the daily cap', () => {
    const slots = policy.dailySlots(new Date('2026-08-18T12:00:00.000Z'), {
      timezone: 'America/Sao_Paulo',
    });

    expect(slots).toHaveLength(3);
    expect(slots.map((slot) => slot.slotKey)).toEqual([
      'HYDRATION_MORNING',
      'HYDRATION_AFTERNOON',
      'DINNER',
    ]);
    expect(
      new Set(slots.map((slot) => slot.scheduledFor.toISOString())).size,
    ).toBe(3);
  });

  it('keeps only near-future or grace-window slots and skips a morning backlog at 19h', () => {
    const morning = policy.materializableSlots(
      new Date('2026-08-18T13:00:00.000Z'),
      { timezone: 'America/Sao_Paulo' },
    );
    const evening = policy.materializableSlots(
      new Date('2026-08-18T22:00:00.000Z'),
      { timezone: 'America/Sao_Paulo' },
    );
    const withinGrace = policy.materializableSlots(
      new Date('2026-08-18T13:40:00.000Z'),
      { timezone: 'America/Sao_Paulo' },
    );

    expect(morning.map((slot) => slot.slotKey)).toEqual(['HYDRATION_MORNING']);
    expect(evening.map((slot) => slot.slotKey)).toEqual(['DINNER']);
    expect(withinGrace.map((slot) => slot.slotKey)).toEqual([
      'HYDRATION_MORNING',
    ]);
  });

  it('removes slots that would enter the configured sleep window', () => {
    const slots = policy.dailySlots(new Date('2026-08-17T12:00:00.000Z'), {
      timezone: 'America/Sao_Paulo',
      preferredSleepTime: '19:00',
      preferredTrainingTime: '18:00',
    });

    expect(slots.map((slot) => slot.slotKey)).toEqual([
      'GOOD_MORNING',
      'LUNCH',
    ]);
  });
});
