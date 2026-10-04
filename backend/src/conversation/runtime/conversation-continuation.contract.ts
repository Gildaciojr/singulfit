import type { Prisma } from '@prisma/client';

export const CONTINUATION_VERSION = 'conversation-continuation:v1';
export const CONTINUATION_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const CONTINUATION_KINDS = {
  WORKOUT_COMPLETION_CHECK: 'WORKOUT_COMPLETION_CHECK',
  WORKOUT_FEEDBACK: 'WORKOUT_FEEDBACK',
  WORKOUT_DAY_QUERY: 'WORKOUT_DAY_QUERY',
  MEAL_COMPLETION_CHECK: 'MEAL_COMPLETION_CHECK',
  MEAL_CONTENT_REQUEST: 'MEAL_CONTENT_REQUEST',
  HYDRATION_CHECK: 'HYDRATION_CHECK',
  GENERAL_FOLLOW_UP: 'GENERAL_FOLLOW_UP',
} as const;
export type ContinuationKind = keyof typeof CONTINUATION_KINDS;
export type ContinuationDomain =
  | 'WORKOUT'
  | 'NUTRITION'
  | 'HYDRATION'
  | 'GENERAL';
export type ContinuationMeal =
  | 'BREAKFAST'
  | 'LUNCH'
  | 'DINNER'
  | 'SNACK'
  | 'UNKNOWN';
export interface ConversationContinuation {
  readonly version: typeof CONTINUATION_VERSION;
  readonly domain: ContinuationDomain;
  readonly kind: ContinuationKind;
  readonly meal: ContinuationMeal;
  readonly expectedInput: 'YES_NO' | 'MEAL_DESCRIPTION_OR_MEDIA' | 'FREE_TEXT';
  readonly source: 'AUTOMATION' | 'USER_QUERY' | 'FOLLOW_UP';
  readonly expiresAt: string;
  readonly resolvedLocalDate?: string;
}
export interface PendingContinuation {
  readonly scheduledMessageId: string;
  readonly question: string;
  readonly continuation: ConversationContinuation;
  readonly reportedContent?: string;
  readonly receiptMessageId?: string;
  readonly reportedContentEstimated?: boolean;
}
export type MealAdherence =
  | 'ALIGNED'
  | 'PARTIALLY_ALIGNED'
  | 'NOT_ALIGNED'
  | 'INSUFFICIENT_INFORMATION';
export interface ContinuationReply {
  readonly content: string;
  readonly domain: ContinuationDomain;
  readonly next: ConversationContinuation | null;
  readonly pending: PendingContinuation | null;
  readonly outcome: 'COMPLETED' | 'SKIPPED' | 'DEFERRED' | 'UNKNOWN';
  readonly evidence: Prisma.InputJsonObject;
}
export function continuation(
  kind: ContinuationKind,
  at: Date,
  meal: ContinuationMeal = 'UNKNOWN',
  source: ConversationContinuation['source'] = 'FOLLOW_UP',
  resolvedLocalDate?: string,
): ConversationContinuation {
  const domain: ContinuationDomain = kind.startsWith('WORKOUT_')
    ? 'WORKOUT'
    : kind.startsWith('MEAL_')
      ? 'NUTRITION'
      : kind === 'HYDRATION_CHECK'
        ? 'HYDRATION'
        : 'GENERAL';
  return {
    version: CONTINUATION_VERSION,
    domain,
    kind,
    meal,
    source,
    expectedInput:
      kind === 'MEAL_CONTENT_REQUEST'
        ? 'MEAL_DESCRIPTION_OR_MEDIA'
        : kind.endsWith('COMPLETION_CHECK') || kind === 'HYDRATION_CHECK'
          ? 'YES_NO'
          : 'FREE_TEXT',
    expiresAt: new Date(at.getTime() + CONTINUATION_WINDOW_MS).toISOString(),
    ...(resolvedLocalDate ? { resolvedLocalDate } : {}),
  };
}
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function parseContinuation(
  value: unknown,
  at: Date,
): ConversationContinuation | null {
  if (
    !record(value) ||
    value.version !== CONTINUATION_VERSION ||
    typeof value.kind !== 'string' ||
    !Object.hasOwn(CONTINUATION_KINDS, value.kind) ||
    typeof value.expiresAt !== 'string'
  )
    return null;
  const kind = value.kind as ContinuationKind;
  if (
    value.resolvedLocalDate !== undefined &&
    (kind !== 'WORKOUT_DAY_QUERY' ||
      typeof value.resolvedLocalDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(value.resolvedLocalDate) ||
      !Number.isFinite(Date.parse(`${value.resolvedLocalDate}T12:00:00Z`)) ||
      new Date(`${value.resolvedLocalDate}T12:00:00Z`)
        .toISOString()
        .slice(0, 10) !== value.resolvedLocalDate)
  )
    return null;
  const expires = new Date(value.expiresAt);
  if (
    !Number.isFinite(at.getTime()) ||
    !Number.isFinite(expires.getTime()) ||
    expires <= at ||
    expires.getTime() > at.getTime() + CONTINUATION_WINDOW_MS ||
    !['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK', 'UNKNOWN'].includes(
      String(value.meal),
    ) ||
    !['AUTOMATION', 'USER_QUERY', 'FOLLOW_UP'].includes(String(value.source))
  )
    return null;
  const canonical = continuation(
    kind,
    new Date(expires.getTime() - CONTINUATION_WINDOW_MS),
    value.meal as ContinuationMeal,
    value.source as ConversationContinuation['source'],
    value.resolvedLocalDate,
  );
  return canonical.domain === value.domain &&
    canonical.expectedInput === value.expectedInput
    ? canonical
    : null;
}
export function continuationJson(
  value: ConversationContinuation | null,
): Prisma.InputJsonValue | null {
  return value ? { ...value } : null;
}
