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

  it('maps the chronological four-meal format persisted in production', () => {
    const preferences = {
      timezone: 'America/Sao_Paulo',
      preferredMealTimes: ['08:00', '12:00', '16:00', '21:00'],
    };

    const monday = policy.dailySlots(
      new Date('2026-08-17T12:00:00.000Z'),
      preferences,
    );
    const tuesday = policy.dailySlots(
      new Date('2026-08-18T12:00:00.000Z'),
      preferences,
    );

    expect(monday.find((slot) => slot.slotKey === 'LUNCH')?.localTime).toBe(
      '12:45',
    );
    expect(tuesday.find((slot) => slot.slotKey === 'DINNER')?.localTime).toBe(
      '21:45',
    );
  });

  it('supports chronological string lists with one, two, three or five meals', () => {
    const monday = new Date('2026-08-17T12:00:00.000Z');
    const tuesday = new Date('2026-08-18T12:00:00.000Z');
    const localTime = (
      at: Date,
      preferredMealTimes: readonly string[],
      slotKey: string,
    ) =>
      policy
        .dailySlots(at, {
          timezone: 'America/Sao_Paulo',
          preferredMealTimes,
        })
        .find((slot) => slot.slotKey === slotKey)?.localTime;

    expect(localTime(monday, ['12:15'], 'LUNCH')).toBe('13:00');
    expect(localTime(tuesday, ['12:15'], 'DINNER')).toBe('19:45');
    expect(localTime(monday, ['12:15', '20:15'], 'LUNCH')).toBe('13:00');
    expect(localTime(tuesday, ['12:15', '20:15'], 'DINNER')).toBe('21:00');
    expect(localTime(monday, ['08:00', '12:30', '19:30'], 'LUNCH')).toBe(
      '13:15',
    );
    expect(localTime(tuesday, ['08:00', '12:30', '19:30'], 'DINNER')).toBe(
      '20:15',
    );
    expect(
      localTime(monday, ['07:30', '10:00', '12:30', '16:00', '20:00'], 'LUNCH'),
    ).toBe('13:15');
    expect(
      localTime(
        tuesday,
        ['07:30', '10:00', '12:30', '16:00', '20:00'],
        'DINNER',
      ),
    ).toBe('20:45');
  });

  it('maps three or more simple times by semantic meal windows', () => {
    const monday = new Date('2026-08-17T12:00:00.000Z');
    const tuesday = new Date('2026-08-18T12:00:00.000Z');
    const localTime = (
      at: Date,
      preferredMealTimes: readonly string[],
      slotKey: string,
    ) =>
      policy
        .dailySlots(at, {
          timezone: 'America/Sao_Paulo',
          preferredMealTimes,
        })
        .find((slot) => slot.slotKey === slotKey)?.localTime;

    const lateLunch = ['06:30', '09:30', '13:00', '19:30'];
    expect(localTime(monday, lateLunch, 'LUNCH')).toBe('13:45');
    expect(localTime(tuesday, lateLunch, 'DINNER')).toBe('20:15');

    const invalidBetweenValidTimes = ['08:00', 'invalid', '12:30', '20:00'];
    expect(localTime(monday, invalidBetweenValidTimes, 'LUNCH')).toBe('13:15');
    expect(localTime(tuesday, invalidBetweenValidTimes, 'DINNER')).toBe(
      '20:45',
    );

    expect(localTime(monday, ['06:30', '09:30', '16:00'], 'LUNCH')).toBe(
      '12:45',
    );
  });

  it('preserves labeled aliases and indexed objects', () => {
    const monday = new Date('2026-08-17T12:00:00.000Z');
    const tuesday = new Date('2026-08-18T12:00:00.000Z');
    const labeled = [
      { name: 'LUNCH', suggestedTime: '12:40' },
      { period: 'DINNER', time: '20:10' },
    ];

    expect(
      policy
        .dailySlots(monday, {
          timezone: 'America/Sao_Paulo',
          preferredMealTimes: labeled,
        })
        .find((slot) => slot.slotKey === 'LUNCH')?.localTime,
    ).toBe('13:25');
    expect(
      policy
        .dailySlots(tuesday, {
          timezone: 'America/Sao_Paulo',
          preferredMealTimes: { LUNCH: '12:20', dinner: '20:20' },
        })
        .find((slot) => slot.slotKey === 'DINNER')?.localTime,
    ).toBe('21:05');
  });

  it('falls back safely for invalid simple and labeled meal times', () => {
    const monday = policy.dailySlots(new Date('2026-08-17T12:00:00.000Z'), {
      timezone: 'America/Sao_Paulo',
      preferredMealTimes: ['breakfast', '25:00', 'dinner'],
    });
    const tuesday = policy.dailySlots(new Date('2026-08-18T12:00:00.000Z'), {
      timezone: 'America/Sao_Paulo',
      preferredMealTimes: [{ period: 'DINNER', time: '19:99' }],
    });

    expect(monday.find((slot) => slot.slotKey === 'LUNCH')?.localTime).toBe(
      '12:45',
    );
    expect(tuesday.find((slot) => slot.slotKey === 'DINNER')?.localTime).toBe(
      '19:45',
    );
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
