import { Injectable } from '@nestjs/common';
import {
  AUTOMATION_RULE_CODES,
  type AutomationRuleCode,
} from './automation.constants';
import {
  COACH_PROACTIVE_INTENTS,
  type CoachProactiveIntent,
  type CoachProactivePreferences,
  type CoachProactiveSlot,
} from './coach-proactive.contract';

export const COACH_PROACTIVE_DEFAULT_TIMEZONE = 'America/Sao_Paulo';
export const COACH_PROACTIVE_DAILY_CAP = 3;
export const COACH_PROACTIVE_GRACE_MINUTES = 15;
export const COACH_PROACTIVE_FUTURE_MINUTES = 60;

interface LocalDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly weekday: number;
}

interface SlotDefinition {
  readonly intent: CoachProactiveIntent;
  readonly slotKey: string;
  readonly ruleCode: AutomationRuleCode;
  readonly minute: number;
}

@Injectable()
export class CoachProactiveSchedulePolicy {
  dailySlots(
    at: Date,
    preferences: CoachProactivePreferences,
  ): readonly CoachProactiveSlot[] {
    const timezone = this.timezone(preferences.timezone);
    const localDate = this.localDate(at, timezone);
    const wake = this.time(preferences.preferredWakeUpTime, 8 * 60);
    let sleep = this.time(preferences.preferredSleepTime, 23 * 60);
    if (sleep <= wake) sleep += 24 * 60;
    const training = this.time(preferences.preferredTrainingTime, 18 * 60);
    const lunch = this.mealTime(
      preferences.preferredMealTimes,
      'LUNCH',
      12 * 60,
    );
    const dinner = this.mealTime(
      preferences.preferredMealTimes,
      'DINNER',
      19 * 60,
    );
    const definitions = this.definitions(localDate.weekday, {
      wake,
      sleep,
      training,
      lunch,
      dinner,
    });

    return Object.freeze(
      definitions
        .filter((definition) =>
          this.outsideSleep(definition.minute, wake, sleep),
        )
        .slice(0, COACH_PROACTIVE_DAILY_CAP)
        .map((definition) => {
          const dayOffset = Math.floor(definition.minute / (24 * 60));
          const minute = definition.minute % (24 * 60);
          const scheduledFor = this.localToUtc(
            localDate,
            minute,
            timezone,
            dayOffset,
          );
          return Object.freeze({
            intent: definition.intent,
            slotKey: definition.slotKey,
            ruleCode: definition.ruleCode,
            scheduledFor,
            localTime: `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`,
          });
        }),
    );
  }

  materializableSlots(
    at: Date,
    preferences: CoachProactivePreferences,
  ): readonly CoachProactiveSlot[] {
    const earliest = at.getTime() - COACH_PROACTIVE_GRACE_MINUTES * 60_000;
    const latest = at.getTime() + COACH_PROACTIVE_FUTURE_MINUTES * 60_000;
    return Object.freeze(
      this.dailySlots(at, preferences).filter((slot) => {
        const value = slot.scheduledFor.getTime();
        return value >= earliest && value <= latest;
      }),
    );
  }

  timezone(value?: string | null): string {
    const candidate = value?.trim() || COACH_PROACTIVE_DEFAULT_TIMEZONE;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(0);
      return candidate;
    } catch {
      return COACH_PROACTIVE_DEFAULT_TIMEZONE;
    }
  }

  localDayRange(
    at: Date,
    timezoneValue?: string | null,
  ): {
    readonly start: Date;
    readonly end: Date;
  } {
    const timezone = this.timezone(timezoneValue);
    const localDate = this.localDate(at, timezone);
    return Object.freeze({
      start: this.localToUtc(localDate, 0, timezone, 0),
      end: this.localToUtc(localDate, 0, timezone, 1),
    });
  }

  private definitions(
    weekday: number,
    times: {
      readonly wake: number;
      readonly sleep: number;
      readonly training: number;
      readonly lunch: number;
      readonly dinner: number;
    },
  ): readonly SlotDefinition[] {
    const goodMorning = this.slot(
      COACH_PROACTIVE_INTENTS.GOOD_MORNING,
      'GOOD_MORNING',
      AUTOMATION_RULE_CODES.GOOD_MORNING,
      times.wake + 30,
    );
    const hydrationMorning = this.slot(
      COACH_PROACTIVE_INTENTS.HYDRATION_CHECK,
      'HYDRATION_MORNING',
      AUTOMATION_RULE_CODES.HYDRATION_REMINDER,
      Math.max(times.wake + 150, 10 * 60 + 30),
    );
    const hydrationAfternoon = this.slot(
      COACH_PROACTIVE_INTENTS.HYDRATION_CHECK,
      'HYDRATION_AFTERNOON',
      AUTOMATION_RULE_CODES.HYDRATION_REMINDER,
      15 * 60 + 30,
    );
    const lunch = this.slot(
      COACH_PROACTIVE_INTENTS.LUNCH_CHECK,
      'LUNCH',
      AUTOMATION_RULE_CODES.MEAL_REMINDER,
      times.lunch + 45,
    );
    const dinner = this.slot(
      COACH_PROACTIVE_INTENTS.DINNER_CHECK,
      'DINNER',
      AUTOMATION_RULE_CODES.MEAL_REMINDER,
      times.dinner + 45,
    );
    const mealPlan = this.slot(
      COACH_PROACTIVE_INTENTS.MEAL_PLAN_CHECK,
      'MEAL_PLAN',
      AUTOMATION_RULE_CODES.MEAL_REMINDER,
      14 * 60,
    );
    const workout = this.slot(
      COACH_PROACTIVE_INTENTS.WORKOUT_CHECK,
      'WORKOUT',
      AUTOMATION_RULE_CODES.DAILY_WORKOUT,
      times.training + 60,
    );
    const checkIn = this.slot(
      COACH_PROACTIVE_INTENTS.DAILY_CHECK_IN,
      'DAILY_CHECK_IN',
      AUTOMATION_RULE_CODES.DAILY_CHECK_IN,
      Math.min(19 * 60, times.sleep - 90),
    );
    const schedule: Readonly<Record<number, readonly SlotDefinition[]>> = {
      0: [goodMorning, mealPlan, checkIn],
      1: [goodMorning, lunch, workout],
      2: [hydrationMorning, hydrationAfternoon, dinner],
      3: [goodMorning, mealPlan, workout],
      4: [hydrationMorning, lunch, checkIn],
      5: [goodMorning, dinner, workout],
      6: [hydrationMorning, lunch, checkIn],
    };
    return schedule[weekday] ?? schedule[0];
  }

  private slot(
    intent: CoachProactiveIntent,
    slotKey: string,
    ruleCode: AutomationRuleCode,
    minute: number,
  ): SlotDefinition {
    return Object.freeze({ intent, slotKey, ruleCode, minute });
  }

  private outsideSleep(minute: number, wake: number, sleep: number): boolean {
    const comparable = minute < wake ? minute + 24 * 60 : minute;
    return comparable >= wake + 30 && comparable <= sleep - 60;
  }

  private time(value: string | null | undefined, fallback: number): number {
    const match = value?.trim().match(/^(\d{1,2}):(\d{2})$/u);
    if (!match) return fallback;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    return hour <= 23 && minute <= 59 ? hour * 60 + minute : fallback;
  }

  private mealTime(
    value: unknown,
    period: 'LUNCH' | 'DINNER',
    fallback: number,
  ): number {
    if (Array.isArray(value)) {
      const records = value.filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === 'object' && entry !== null && !Array.isArray(entry),
      );
      const match = records.find((entry) => {
        const label = entry.period ?? entry.name;
        return typeof label === 'string' && label.toUpperCase() === period;
      });
      const candidate = match?.time ?? match?.suggestedTime;
      if (typeof candidate === 'string') return this.time(candidate, fallback);
      const strings = value.filter(
        (entry): entry is string => typeof entry === 'string',
      );
      const candidateString = strings[period === 'LUNCH' ? 0 : 1];
      return this.time(candidateString, fallback);
    }
    if (typeof value === 'object' && value !== null) {
      const record = value as Record<string, unknown>;
      const candidate = record[period] ?? record[period.toLowerCase()];
      if (typeof candidate === 'string') return this.time(candidate, fallback);
    }
    return fallback;
  }

  private localDate(at: Date, timezone: string): LocalDateParts {
    const parts = this.parts(at, timezone);
    const weekday = new Date(
      Date.UTC(parts.year, parts.month - 1, parts.day),
    ).getUTCDay();
    return Object.freeze({ ...parts, weekday });
  }

  private localToUtc(
    localDate: LocalDateParts,
    minute: number,
    timezone: string,
    dayOffset: number,
  ): Date {
    const desired = new Date(
      Date.UTC(
        localDate.year,
        localDate.month - 1,
        localDate.day + dayOffset,
        Math.floor(minute / 60),
        minute % 60,
      ),
    );
    let result = desired;
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const actual = this.parts(result, timezone);
      const actualUtc = Date.UTC(
        actual.year,
        actual.month - 1,
        actual.day,
        actual.hour,
        actual.minute,
      );
      result = new Date(result.getTime() + desired.getTime() - actualUtc);
    }
    return result;
  }

  private parts(
    at: Date,
    timezone: string,
  ): {
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly hour: number;
    readonly minute: number;
  } {
    const values = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .reduce<Record<string, string>>((result, part) => {
        if (part.type !== 'literal') result[part.type] = part.value;
        return result;
      }, {});
    return Object.freeze({
      year: Number(values.year),
      month: Number(values.month),
      day: Number(values.day),
      hour: Number(values.hour),
      minute: Number(values.minute),
    });
  }
}
