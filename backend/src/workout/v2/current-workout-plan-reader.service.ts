import { Injectable } from '@nestjs/common';
import { AIJobStatus, AIJobType, Prisma, WorkoutWeekday } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CurrentWorkoutPlanReadResult,
  CurrentWorkoutPlanLegacyRelational,
  CurrentWorkoutPlanLegacySession,
  CurrentWorkoutPlanV2,
  WorkoutPlanReadSelection,
} from './current-workout-plan-reader.contract';
import type { WorkoutSessionV2 } from './workout-plan-v2.contract';
import { WorkoutPlanV2StoredDocumentParser } from './workout-plan-v2-stored-document.parser';
import { WORKOUT_PROMPT_BY_GOAL } from '../workout.constants';
import { WORKOUT_PLANNING_V2_PROMPT } from './workout-planning-v2.prompt.definition';

const LEGACY_WORKOUT_PROMPT_NAMES = new Set<string>(
  Object.values(WORKOUT_PROMPT_BY_GOAL),
);

const WEEKDAYS: readonly WorkoutWeekday[] = Object.freeze([
  WorkoutWeekday.SUNDAY,
  WorkoutWeekday.MONDAY,
  WorkoutWeekday.TUESDAY,
  WorkoutWeekday.WEDNESDAY,
  WorkoutWeekday.THURSDAY,
  WorkoutWeekday.FRIDAY,
  WorkoutWeekday.SATURDAY,
]);

@Injectable()
export class CurrentWorkoutPlanReaderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: WorkoutPlanV2StoredDocumentParser,
  ) {}

  async present(
    userId: string,
    message: string,
    referenceDate: Date,
  ): Promise<string> {
    const result = await this.read(userId);
    if (result.status === 'NO_PLAN') {
      return 'Você ainda não tem um plano de treino ativo. Se quiser, posso montar um com base na sua rotina.';
    }
    if (result.status === 'INVALID_V2_PLAN') {
      return 'Não consegui consultar seu plano de treino com segurança agora. Não vou usar um plano antigo ou escolher uma sessão por aproximação.';
    }
    if (result.status === 'LEGACY_RELATIONAL') {
      return this.presentLegacy(result.plan, message, referenceDate);
    }
    const selection = this.select(result.plan, message, referenceDate);
    if (
      selection.kind === 'CLARIFICATION' ||
      selection.kind === 'CALENDAR_UNAVAILABLE'
    ) {
      return selection.message;
    }
    if (selection.kind === 'REST_DAY') {
      return `Não há sessão programada para ${this.weekdayLabel(selection.weekday)} no seu plano atual. É um dia de descanso.`;
    }
    if (selection.kind === 'SESSION')
      return this.formatSession(selection.session);
    return [
      result.plan.document.title,
      ...result.plan.document.sessions.map((session) => {
        const calendar = result.plan.calendar.find(
          (entry) => entry.sessionSequence === session.sequence,
        );
        const day = calendar?.weekday
          ? ` — ${this.weekdayLabel(calendar.weekday)}`
          : '';
        return `Sessão ${session.sequence}${day}: ${session.label} (${session.estimatedDurationMinutes} min)`;
      }),
      '',
      'Peça por hoje, amanhã, dia da semana ou número da sessão para ver os exercícios.',
    ].join('\n');
  }

  async read(userId: string): Promise<CurrentWorkoutPlanReadResult> {
    if (!userId.trim()) return Object.freeze({ status: 'NO_PLAN', plan: null });
    const record = await this.prisma.workoutPlan.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
      include: {
        aiJob: { include: { promptVersion: { select: { name: true } } } },
        days: {
          orderBy: { dayNumber: 'asc' },
          include: { exercises: { orderBy: { id: 'asc' } } },
        },
        user: {
          select: { preferences: { select: { timezone: true } } },
        },
      },
    });
    if (!record) return Object.freeze({ status: 'NO_PLAN', plan: null });
    const aiJob = record.aiJob;
    if (
      !aiJob ||
      aiJob.userId !== userId ||
      aiJob.type !== AIJobType.WORKOUT ||
      aiJob.status !== AIJobStatus.COMPLETED
    ) {
      return Object.freeze({ status: 'INVALID_V2_PLAN', plan: null });
    }
    const stored = this.record(aiJob.result) ? aiJob.result : null;
    const document = stored
      ? this.parser.parse(stored.acceptedOutput ?? null, aiJob.id)
      : null;
    const timezone = record.user.preferences?.timezone ?? 'America/Sao_Paulo';
    if (document) {
      if (!this.validTimezone(timezone)) {
        return Object.freeze({ status: 'INVALID_V2_PLAN', plan: null });
      }
      const sequences = new Set(document.sessions.map((item) => item.sequence));
      if (record.days.some((day) => !sequences.has(day.dayNumber))) {
        return Object.freeze({ status: 'INVALID_V2_PLAN', plan: null });
      }
      const plan: CurrentWorkoutPlanV2 = Object.freeze({
        implementation: 'V2',
        aggregateId: record.id,
        userId: record.userId,
        aiJobId: aiJob.id,
        document,
        timezone,
        calendar: Object.freeze(
          record.days.map((day) =>
            Object.freeze({
              sessionSequence: day.dayNumber,
              weekday: day.weekday,
            }),
          ),
        ),
      });
      return Object.freeze({ status: 'AVAILABLE', plan });
    }
    const promptName = aiJob.promptVersion?.name;
    if (this.identifiesAsV2(promptName, stored)) {
      return Object.freeze({ status: 'INVALID_V2_PLAN', plan: null });
    }
    if (
      !promptName ||
      !LEGACY_WORKOUT_PROMPT_NAMES.has(promptName) ||
      !this.validTimezone(timezone)
    ) {
      return Object.freeze({ status: 'INVALID_V2_PLAN', plan: null });
    }
    const sessions = this.legacySessions(record.days);
    if (!sessions || !this.validText(record.title, 200)) {
      return Object.freeze({ status: 'INVALID_V2_PLAN', plan: null });
    }
    const plan: CurrentWorkoutPlanLegacyRelational = Object.freeze({
      implementation: 'LEGACY_RELATIONAL',
      aggregateId: record.id,
      userId: record.userId,
      aiJobId: aiJob.id,
      title: record.title.trim(),
      timezone,
      sessions,
      calendar: Object.freeze(
        record.days.map((day) =>
          Object.freeze({
            sessionSequence: day.dayNumber,
            weekday: day.weekday,
          }),
        ),
      ),
    });
    return Object.freeze({ status: 'LEGACY_RELATIONAL', plan });
  }

  private presentLegacy(
    plan: CurrentWorkoutPlanLegacyRelational,
    message: string,
    referenceDate: Date,
  ): string {
    const normalized = this.normalize(message);
    const ordinal = this.ordinal(normalized);
    if (ordinal !== null) {
      const session = plan.sessions.find((item) => item.sequence === ordinal);
      return session
        ? this.formatLegacySession(session)
        : `Seu plano atual não possui uma sessão ${ordinal}. Qual sessão você quer consultar?`;
    }
    const temporal = this.temporalWeekday(
      normalized,
      referenceDate,
      plan.timezone,
    );
    if (temporal) {
      const weekdays = plan.calendar.map((entry) => entry.weekday);
      if (
        plan.calendar.length !== plan.sessions.length ||
        weekdays.some((weekday) => weekday === null) ||
        new Set(weekdays).size !== weekdays.length
      ) {
        return 'Seu plano atual não possui um calendário confirmado. Posso mostrar as sessões por número, sem inventar um dia da semana.';
      }
      const scheduled = plan.calendar.find(
        (entry) => entry.weekday === temporal,
      );
      if (!scheduled) {
        return `Não há sessão programada para ${this.weekdayLabel(temporal)} no seu plano atual. É um dia de descanso.`;
      }
      const session = plan.sessions.find(
        (item) => item.sequence === scheduled.sessionSequence,
      );
      return session
        ? this.formatLegacySession(session)
        : 'O calendário do treino atual está inconsistente. Não vou escolher uma sessão arbitrariamente.';
    }
    return [
      plan.title,
      ...plan.sessions.map(
        (session) => `Sessão ${session.sequence}: ${session.title}`,
      ),
      '',
      'Peça pelo número da sessão para ver os exercícios.',
    ].join('\n');
  }

  private legacySessions(
    days: readonly {
      readonly dayNumber: number;
      readonly title: string;
      readonly exercises: readonly {
        readonly exerciseName: string;
        readonly sets: number;
        readonly reps: string;
        readonly restSeconds: number;
        readonly notes: string | null;
      }[];
    }[],
  ): readonly CurrentWorkoutPlanLegacySession[] | null {
    if (days.length < 1 || days.length > 7) return null;
    const numbers = new Set<number>();
    const sessions: CurrentWorkoutPlanLegacySession[] = [];
    for (const day of days) {
      if (
        !Number.isInteger(day.dayNumber) ||
        day.dayNumber < 1 ||
        day.dayNumber > 7 ||
        numbers.has(day.dayNumber) ||
        !this.validText(day.title, 200) ||
        day.exercises.length < 1 ||
        day.exercises.length > 20
      ) {
        return null;
      }
      numbers.add(day.dayNumber);
      const exercises = day.exercises.map((exercise) => {
        if (
          !this.validText(exercise.exerciseName, 200) ||
          !Number.isInteger(exercise.sets) ||
          exercise.sets < 1 ||
          exercise.sets > 20 ||
          !this.validText(exercise.reps, 100) ||
          !Number.isInteger(exercise.restSeconds) ||
          exercise.restSeconds < 0 ||
          exercise.restSeconds > 600 ||
          (exercise.notes !== null && !this.validText(exercise.notes, 1_000))
        ) {
          return null;
        }
        return Object.freeze({
          exerciseName: exercise.exerciseName.trim(),
          sets: exercise.sets,
          reps: exercise.reps.trim(),
          restSeconds: exercise.restSeconds,
          notes: exercise.notes?.trim() ?? null,
        });
      });
      if (exercises.some((exercise) => exercise === null)) return null;
      sessions.push(
        Object.freeze({
          sequence: day.dayNumber,
          title: day.title.trim(),
          exercises: Object.freeze(
            exercises.filter(
              (exercise): exercise is NonNullable<typeof exercise> =>
                exercise !== null,
            ),
          ),
        }),
      );
    }
    return Object.freeze(
      sessions.sort((left, right) => left.sequence - right.sequence),
    );
  }

  private formatLegacySession(
    session: CurrentWorkoutPlanLegacySession,
  ): string {
    return [
      `Sessão ${session.sequence}: ${session.title}`,
      ...session.exercises.map((exercise) => {
        const notes = exercise.notes ? ` — ${exercise.notes}` : '';
        return `• ${exercise.exerciseName}: ${exercise.sets} séries de ${exercise.reps}, descanso de ${exercise.restSeconds}s${notes}`;
      }),
    ]
      .join('\n')
      .slice(0, 3_500)
      .trimEnd();
  }

  private identifiesAsV2(
    promptName: string | undefined,
    result: Record<string, Prisma.JsonValue> | null,
  ): boolean {
    return (
      promptName === WORKOUT_PLANNING_V2_PROMPT.name ||
      (result !== null &&
        ('acceptedOutput' in result || this.v2DocumentMarker(result)))
    );
  }

  private v2DocumentMarker(value: Record<string, Prisma.JsonValue>): boolean {
    return value.schemaVersion === 2 || this.record(value.generationMetadata);
  }

  private validText(value: string, maxLength: number): boolean {
    const normalized = value.trim();
    return normalized.length > 0 && normalized.length <= maxLength;
  }

  select(
    plan: CurrentWorkoutPlanV2,
    message: string,
    referenceDate: Date,
  ): WorkoutPlanReadSelection {
    const normalized = this.normalize(message);
    const ordinal = this.ordinal(normalized);
    if (ordinal !== null) {
      const session = plan.document.sessions.find(
        (item) => item.sequence === ordinal,
      );
      return session
        ? Object.freeze({ kind: 'SESSION', session })
        : Object.freeze({
            kind: 'CLARIFICATION',
            message: `Seu plano atual não possui uma sessão ${ordinal}. Qual sessão você quer consultar?`,
          });
    }
    const temporal = this.temporalWeekday(
      normalized,
      referenceDate,
      plan.timezone,
    );
    if (temporal) return this.byWeekday(plan, temporal);
    const muscle = this.muscle(normalized);
    if (muscle) {
      const matches = plan.document.sessions.filter((session) =>
        muscle.test(this.sessionText(session)),
      );
      if (matches.length === 1)
        return Object.freeze({ kind: 'SESSION', session: matches[0] });
      return Object.freeze({
        kind: 'CLARIFICATION',
        message:
          matches.length === 0
            ? 'Não encontrei uma sessão com esse foco no seu plano atual. Quer consultar por número ou dia da semana?'
            : 'Encontrei mais de uma sessão com esse foco. Qual número ou dia da semana você quer ver?',
      });
    }
    return Object.freeze({ kind: 'FULL_PLAN' });
  }

  private byWeekday(
    plan: CurrentWorkoutPlanV2,
    weekday: WorkoutWeekday,
  ): WorkoutPlanReadSelection {
    if (
      plan.calendar.length !== plan.document.sessions.length ||
      plan.calendar.some((entry) => entry.weekday === null)
    ) {
      return Object.freeze({
        kind: 'CALENDAR_UNAVAILABLE',
        message:
          'Seu plano atual não possui um calendário confirmado. Posso mostrar as sessões por número, sem inventar um dia da semana.',
      });
    }
    const scheduled = plan.calendar.find((entry) => entry.weekday === weekday);
    if (!scheduled) return Object.freeze({ kind: 'REST_DAY', weekday });
    const session = plan.document.sessions.find(
      (item) => item.sequence === scheduled.sessionSequence,
    );
    return session
      ? Object.freeze({ kind: 'SESSION', session })
      : Object.freeze({
          kind: 'CALENDAR_UNAVAILABLE',
          message:
            'O calendário do treino atual está inconsistente. Não vou escolher uma sessão arbitrariamente.',
        });
  }

  private temporalWeekday(
    message: string,
    referenceDate: Date,
    timezone: string,
  ): WorkoutWeekday | null {
    const explicit: readonly (readonly [WorkoutWeekday, RegExp])[] = [
      [WorkoutWeekday.MONDAY, /\bsegunda(?:-feira)?\b/u],
      [WorkoutWeekday.TUESDAY, /\bterca(?:-feira)?\b/u],
      [WorkoutWeekday.WEDNESDAY, /\bquarta(?:-feira)?\b/u],
      [WorkoutWeekday.THURSDAY, /\bquinta(?:-feira)?\b/u],
      [WorkoutWeekday.FRIDAY, /\bsexta(?:-feira)?\b/u],
      [WorkoutWeekday.SATURDAY, /\bsabado\b/u],
      [WorkoutWeekday.SUNDAY, /\bdomingo\b/u],
    ];
    const selected = explicit.find((entry) => entry[1].test(message));
    if (selected) return selected[0];
    if (!/\bhoje\b|\bamanha\b/u.test(message)) return null;
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
    })
      .format(referenceDate)
      .toUpperCase() as WorkoutWeekday;
    if (!WEEKDAYS.includes(weekday)) return null;
    return /\bamanha\b/u.test(message)
      ? WEEKDAYS[(WEEKDAYS.indexOf(weekday) + 1) % WEEKDAYS.length]
      : weekday;
  }

  private ordinal(message: string): number | null {
    const digit = message.match(/\b(?:treino|sessao)\s*(?:numero\s*)?(\d)\b/u);
    if (digit) return Number(digit[1]);
    const words: Readonly<Record<string, number>> = Object.freeze({
      um: 1,
      dois: 2,
      tres: 3,
      quatro: 4,
      cinco: 5,
      seis: 6,
      sete: 7,
    });
    const word = message.match(
      /\b(?:treino|sessao)\s+(um|dois|tres|quatro|cinco|seis|sete)\b/u,
    );
    return word ? words[word[1]] : null;
  }

  private muscle(message: string): RegExp | null {
    if (/\bpernas?|quadriceps|gluteos?|posterior(?:es)?\b/u.test(message))
      return /perna|quadr[ií]ceps|gl[uú]teo|posterior|leg|squat|agachamento/i;
    if (/\bpeito|peitoral\b/u.test(message))
      return /peito|peitoral|chest|supino/i;
    if (/\bcostas?|dorsal\b/u.test(message))
      return /costas|dorsal|back|remada|puxada/i;
    if (/\bbracos?|biceps|triceps\b/u.test(message))
      return /bra[cç]o|b[ií]ceps|tr[ií]ceps/i;
    if (/\bcorpo inteiro|full body\b/u.test(message))
      return /corpo inteiro|full body/i;
    return null;
  }

  private sessionText(session: WorkoutSessionV2): string {
    return [
      session.label,
      ...session.blocks.flatMap((block) => [
        block.title,
        ...block.activities.map((activity) => activity.name),
      ]),
    ].join(' ');
  }

  private formatSession(session: WorkoutSessionV2): string {
    return [
      `Sessão ${session.sequence}: ${session.label} (${session.estimatedDurationMinutes} min)`,
      ...session.blocks.flatMap((block) => [
        block.title,
        ...block.activities.map(
          (activity) => `• ${activity.name}: ${activity.instruction}`,
        ),
      ]),
    ]
      .join('\n')
      .slice(0, 3_500)
      .trimEnd();
  }

  private weekdayLabel(weekday: WorkoutWeekday): string {
    const labels: Readonly<Record<WorkoutWeekday, string>> = Object.freeze({
      MONDAY: 'segunda-feira',
      TUESDAY: 'terça-feira',
      WEDNESDAY: 'quarta-feira',
      THURSDAY: 'quinta-feira',
      FRIDAY: 'sexta-feira',
      SATURDAY: 'sábado',
      SUNDAY: 'domingo',
    });
    return labels[weekday];
  }

  private validTimezone(timezone: string | null | undefined): boolean {
    try {
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone ?? 'America/Sao_Paulo',
      }).format(new Date(0));
      return true;
    } catch {
      return false;
    }
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private record(value: unknown): value is Record<string, Prisma.JsonValue> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
