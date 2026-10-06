import type { OpenAIResponseResult } from './interfaces/openai.interface';

export const DURABLE_TEXT_REVISION = 'workout-v9-background-v1' as const;
export interface DurableValidationIssue {
  readonly code: string;
  readonly severity: 'ERROR' | 'WARNING';
  readonly path: string;
}
export interface DurableProviderAttempt {
  attemptKey: string;
  /** Absent only in ledgers written before requested model identity was captured. */
  requestedModel?: string;
  phase: 'CREATING' | 'POLLING' | 'COMPLETED' | 'FAILED';
  responseId: string | null;
  usageRecorded: boolean;
  response: OpenAIResponseResult | null;
  validationIssues?: readonly DurableValidationIssue[];
}
export interface DurableTextOperation {
  revision: typeof DURABLE_TEXT_REVISION;
  requestInput: string;
  executionContext: string;
  deadlineAt: string;
  attempts: DurableProviderAttempt[];
  repairInput: string | null;
  initialValidated: boolean;
  accountingIssue: 'MODEL_MISMATCH' | null;
}
export class DurableTextPendingError extends Error {
  constructor() {
    super('Background response remains recoverable');
  }
}
export function durableTextOperation(
  value: unknown,
): DurableTextOperation | null {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('durableTextOperation' in value)
  )
    return null;
  const state = value.durableTextOperation;
  if (
    state === null ||
    typeof state !== 'object' ||
    !('revision' in state) ||
    state.revision !== DURABLE_TEXT_REVISION ||
    !('requestInput' in state) ||
    typeof state.requestInput !== 'string' ||
    !('executionContext' in state) ||
    typeof state.executionContext !== 'string' ||
    !('deadlineAt' in state) ||
    typeof state.deadlineAt !== 'string' ||
    !Number.isFinite(Date.parse(state.deadlineAt)) ||
    !('attempts' in state) ||
    !Array.isArray(state.attempts) ||
    state.attempts.length > 2 ||
    !('initialValidated' in state) ||
    typeof state.initialValidated !== 'boolean' ||
    !('repairInput' in state) ||
    (state.repairInput !== null && typeof state.repairInput !== 'string') ||
    !('accountingIssue' in state) ||
    (state.accountingIssue !== null &&
      state.accountingIssue !== 'MODEL_MISMATCH')
  )
    return null;
  for (const value of state.attempts as readonly unknown[]) {
    if (value === null || typeof value !== 'object') return null;
    const attempt = value as Record<string, unknown>;
    if (
      attempt === null ||
      typeof attempt !== 'object' ||
      typeof attempt.attemptKey !== 'string' ||
      (attempt.requestedModel !== undefined &&
        (typeof attempt.requestedModel !== 'string' ||
          !attempt.requestedModel.trim())) ||
      typeof attempt.phase !== 'string' ||
      !['CREATING', 'POLLING', 'COMPLETED', 'FAILED'].includes(attempt.phase) ||
      (attempt.responseId !== null && typeof attempt.responseId !== 'string') ||
      typeof attempt.usageRecorded !== 'boolean'
    )
      return null;
    if (
      attempt.validationIssues !== undefined &&
      (!Array.isArray(attempt.validationIssues) ||
        (attempt.validationIssues as readonly unknown[]).some(
          (issue: unknown) =>
            issue === null ||
            typeof issue !== 'object' ||
            !('code' in issue) ||
            typeof issue.code !== 'string' ||
            !('severity' in issue) ||
            (issue.severity !== 'ERROR' && issue.severity !== 'WARNING') ||
            !('path' in issue) ||
            typeof issue.path !== 'string',
        ))
    )
      return null;
    const response: unknown = attempt.response;
    if (
      response !== null &&
      (typeof response !== 'object' ||
        !('responseId' in response) ||
        response.responseId !== attempt.responseId ||
        !('model' in response) ||
        typeof response.model !== 'string' ||
        !('outputText' in response) ||
        typeof response.outputText !== 'string' ||
        !('promptTokens' in response) ||
        !Number.isInteger(response.promptTokens) ||
        Number(response.promptTokens) < 0 ||
        !('completionTokens' in response) ||
        !Number.isInteger(response.completionTokens) ||
        Number(response.completionTokens) < 0 ||
        !('totalTokens' in response) ||
        response.totalTokens !==
          Number(response.promptTokens) + Number(response.completionTokens))
    )
      return null;
  }
  return structuredClone(state) as DurableTextOperation;
}
