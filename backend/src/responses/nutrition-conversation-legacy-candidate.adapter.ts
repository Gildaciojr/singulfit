import type { LanguageRealizationResult } from './conversation-language-realization.contract';
import type { LegacyCandidateComparisonEnvelope } from './conversation-response-comparison.contract';

export class NutritionConversationLegacyCandidateAdapter {
  adapt(
    legacyText: string,
    candidate: LanguageRealizationResult | null,
  ): LegacyCandidateComparisonEnvelope {
    const candidateText = candidate?.candidateText ?? null;
    const eligible =
      candidate !== null &&
      (candidate.status === 'COMPLETED' ||
        candidate.status === 'PARTIALLY_COMPLETED') &&
      candidateText !== null;

    return Object.freeze({
      legacy: Object.freeze({
        origin: 'LEGACY',
        content: legacyText,
        available: true,
        eligible: true,
        status: 'OFFICIAL',
        characterCount: Array.from(legacyText).length,
      }),
      candidate: Object.freeze({
        origin: 'CANDIDATE',
        content: candidateText,
        available: candidateText !== null,
        eligible,
        status: candidate?.status ?? 'EMPTY',
        ...(!eligible
          ? {
              rejectionCode:
                candidate?.failureCode ??
                candidate?.fallbackReason ??
                (candidate === null ? 'NOT_EXECUTED' : 'NOT_ELIGIBLE'),
            }
          : {}),
        characterCount: candidateText ? Array.from(candidateText).length : 0,
      }),
      selectedOrigin: 'LEGACY',
      sanitizedPayloadReference: candidate?.sanitizedPayloadReference ?? null,
    });
  }
}
