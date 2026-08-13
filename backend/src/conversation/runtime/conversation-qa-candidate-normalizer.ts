import type { ConversationAnswerCandidate } from './conversation-qa.contract';

const TRAILING_COACH_OFFER =
  /^(?:(?:se (?:voc[eê] )?quiser,\s*(?:eu\s+)?(?:tamb[eé]m\s+|ainda\s+)?posso\b)|(?:quer\s+que\s+eu\b)|(?:posso\s+(?:te|lhe)\b))/iu;
const PARAGRAPH_SEPARATOR = /\r?\n[ \t]*\r?\n/gu;

export interface ConversationQATextCandidate {
  readonly answer: string | null;
  readonly followUpQuestion: string | null;
}

export function normalizeConversationQACandidate(
  candidate: ConversationAnswerCandidate,
): ConversationAnswerCandidate;
export function normalizeConversationQACandidate(
  candidate: ConversationQATextCandidate,
): ConversationQATextCandidate;
export function normalizeConversationQACandidate(
  candidate: ConversationQATextCandidate,
): ConversationQATextCandidate {
  if (candidate.followUpQuestion !== null || candidate.answer === null) {
    return candidate;
  }

  const separators = [...candidate.answer.matchAll(PARAGRAPH_SEPARATOR)];
  const lastSeparator = separators.at(-1);
  if (!lastSeparator || lastSeparator.index === undefined) return candidate;

  const followUpQuestion = candidate.answer.slice(
    lastSeparator.index + lastSeparator[0].length,
  );
  if (!TRAILING_COACH_OFFER.test(followUpQuestion.trimStart())) {
    return candidate;
  }

  return Object.freeze({
    ...candidate,
    answer: candidate.answer.slice(0, lastSeparator.index),
    followUpQuestion,
  });
}
