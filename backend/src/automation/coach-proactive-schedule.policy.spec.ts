import { CoachProactiveSchedulePolicy } from './coach-proactive-schedule.policy';
import { COACH_PROACTIVE_MIN_GAP_MINUTES } from './coach-proactive.contract';

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
      ['HYDRATION_MORNING', '07:30'],
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
      preferredWakeUpTime: '06:00',
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
          preferredWakeUpTime: '06:00',
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
          preferredWakeUpTime: '06:00',
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
          preferredWakeUpTime: '06:00',
          preferredMealTimes: labeled,
        })
        .find((slot) => slot.slotKey === 'LUNCH')?.localTime,
    ).toBe('13:25');
    expect(
      policy
        .dailySlots(tuesday, {
          timezone: 'America/Sao_Paulo',
          preferredWakeUpTime: '06:00',
          preferredMealTimes: { LUNCH: '12:20', dinner: '20:20' },
        })
        .find((slot) => slot.slotKey === 'DINNER')?.localTime,
    ).toBe('21:05');
  });

  it('falls back safely for invalid simple and labeled meal times', () => {
    const monday = policy.dailySlots(new Date('2026-08-17T12:00:00.000Z'), {
      timezone: 'America/Sao_Paulo',
      preferredWakeUpTime: '06:00',
      preferredMealTimes: ['breakfast', '25:00', 'dinner'],
    });
    const tuesday = policy.dailySlots(new Date('2026-08-18T12:00:00.000Z'), {
      timezone: 'America/Sao_Paulo',
      preferredWakeUpTime: '06:00',
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
      '2026-08-18T07:30:00.000Z',
    );
    expect(invalid).toEqual(fallback);
  });

  it('keeps one hydration slot and never exceeds the daily cap', () => {
    const slots = policy.dailySlots(new Date('2026-08-18T12:00:00.000Z'), {
      timezone: 'America/Sao_Paulo',
    });

    expect(slots).toHaveLength(2);
    expect(slots.map((slot) => slot.slotKey)).toEqual([
      'HYDRATION_MORNING',
      'DINNER',
    ]);
    expect(
      new Set(slots.map((slot) => slot.scheduledFor.toISOString())).size,
    ).toBe(2);
  });

  it('keeps only near-future or grace-window slots and skips a morning backlog at 19h', () => {
    const morning = policy.materializableSlots(
      new Date('2026-08-18T11:00:00.000Z'),
      { timezone: 'America/Sao_Paulo' },
    );
    const evening = policy.materializableSlots(
      new Date('2026-08-18T22:00:00.000Z'),
      { timezone: 'America/Sao_Paulo' },
    );
    const withinGrace = policy.materializableSlots(
      new Date('2026-08-18T11:40:00.000Z'),
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
      'HYDRATION_MORNING',
      'LUNCH',
    ]);
  });

  it('guarantees hydration on every local weekday within the existing cap', () => {
    const days = Array.from({ length: 7 }, (_, offset) =>
      policy.dailySlots(new Date(Date.UTC(2026, 7, 16 + offset, 12)), {
        timezone: 'America/Sao_Paulo',
      }),
    );

    for (const slots of days) {
      expect(
        slots.filter((slot) => slot.intent === 'HYDRATION_CHECK'),
      ).toHaveLength(1);
      expect(slots.length).toBeLessThanOrEqual(3);
      for (let left = 0; left < slots.length; left += 1) {
        for (let right = left + 1; right < slots.length; right += 1) {
          const difference = Math.abs(
            slots[left].scheduledFor.getTime() -
              slots[right].scheduledFor.getTime(),
          );
          expect(difference / 60_000).toBeGreaterThanOrEqual(
            COACH_PROACTIVE_MIN_GAP_MINUTES,
          );
        }
      }
    }
    expect(
      new Set(days.map((slots) => slots.map((slot) => slot.slotKey).join(',')))
        .size,
    ).toBeGreaterThan(1);
  });

  it('keeps GOOD_MORNING and hydration as distinct cooldown-compatible intents', () => {
    const slots = policy.dailySlots(new Date('2026-08-19T12:00:00.000Z'), {
      timezone: 'America/Sao_Paulo',
      preferredWakeUpTime: '08:00',
      preferredSleepTime: '23:00',
    });
    const goodMorning = slots.find((slot) => slot.slotKey === 'GOOD_MORNING');
    const hydration = slots.find(
      (slot) => slot.slotKey === 'HYDRATION_MORNING',
    );

    expect(goodMorning?.intent).toBe('GOOD_MORNING');
    expect(hydration?.intent).toBe('HYDRATION_CHECK');
    expect(
      Math.abs(
        (hydration?.scheduledFor.getTime() ?? 0) -
          (goodMorning?.scheduledFor.getTime() ?? 0),
      ) / 60_000,
    ).toBeGreaterThanOrEqual(COACH_PROACTIVE_MIN_GAP_MINUTES);
  });

  it('never returns the former 165-minute Monday hydration/lunch conflict', () => {
    const slots = policy.dailySlots(new Date('2026-08-17T12:00:00.000Z'), {
      timezone: 'America/Sao_Paulo',
      preferredWakeUpTime: '07:00',
      preferredMealTimes: [{ period: 'LUNCH', time: '12:30' }],
      preferredTrainingTime: '17:30',
    });
    const minutes = slots.map((slot) => slot.scheduledFor.getTime() / 60_000);

    expect(slots.map((slot) => slot.slotKey)).toEqual([
      'HYDRATION_MORNING',
      'LUNCH',
      'WORKOUT',
    ]);
    expect(
      minutes.some((left, index) =>
        minutes
          .slice(index + 1)
          .some(
            (right) => Math.abs(left - right) < COACH_PROACTIVE_MIN_GAP_MINUTES,
          ),
      ),
    ).toBe(false);
  });

  it('keeps hydration mandatory and omits conflicting custom slots', () => {
    const slots = policy.dailySlots(new Date('2026-08-18T12:00:00.000Z'), {
      timezone: 'America/Sao_Paulo',
      preferredWakeUpTime: '17:30',
      preferredSleepTime: '02:00',
      preferredMealTimes: [{ period: 'DINNER', time: '18:00' }],
    });

    expect(
      slots.filter((slot) => slot.slotKey === 'HYDRATION_MORNING'),
    ).toHaveLength(1);
    expect(slots.length).toBeLessThanOrEqual(3);
    expect(slots.every((slot) => slot.localTime >= '18:00')).toBe(true);
  });

  it('uses the same timezone-aware wake window for deferred outreach', () => {
    const preferences = {
      timezone: 'America/Sao_Paulo',
      preferredWakeUpTime: '08:00',
      preferredSleepTime: '23:00',
    };

    expect(
      policy
        .nextAllowedSendAt(new Date('2026-08-18T06:00:00.000Z'), preferences)
        .toISOString(),
    ).toBe('2026-08-18T11:30:00.000Z');
    expect(
      policy.nextAllowedSendAt(
        new Date('2026-08-18T15:00:00.000Z'),
        preferences,
      ),
    ).toEqual(new Date('2026-08-18T15:00:00.000Z'));
    expect(
      policy
        .nextAllowedSendAt(new Date('2026-08-18T06:00:00.000Z'), {
          ...preferences,
          timezone: 'Invalid/Timezone',
        })
        .toISOString(),
    ).toBe('2026-08-18T11:30:00.000Z');
  });

  it('handles DST day boundaries and sleep windows crossing midnight', () => {
    const dstRange = policy.localDayRange(
      new Date('2026-10-25T12:00:00.000Z'),
      'Europe/Lisbon',
    );

    expect(dstRange.start.toISOString()).toBe('2026-10-24T23:00:00.000Z');
    expect(dstRange.end.toISOString()).toBe('2026-10-26T00:00:00.000Z');
    expect(
      policy.nextAllowedSendAt(new Date('2026-08-18T04:00:00.000Z'), {
        timezone: 'America/Sao_Paulo',
        preferredWakeUpTime: '08:00',
        preferredSleepTime: '02:00',
      }),
    ).toEqual(new Date('2026-08-18T04:00:00.000Z'));
    expect(
      policy
        .nextAllowedSendAt(new Date('2026-08-18T07:00:00.000Z'), {
          timezone: 'America/Sao_Paulo',
          preferredWakeUpTime: '08:00',
          preferredSleepTime: '02:00',
        })
        .toISOString(),
    ).toBe('2026-08-18T11:30:00.000Z');
  });
});
