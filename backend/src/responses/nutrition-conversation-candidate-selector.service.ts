import { Injectable } from '@nestjs/common';
import type {
  ConversationComparisonCheckCode,
  ConversationComparisonResult,
} from './conversation-comparison.contract';
import type { LanguageRealizationResult } from './conversation-language-realization.contract';
import {
  CANDIDATE_SELECTION_REASON,
  CANDIDATE_SELECTION_STATUS,
  CONVERSATION_SELECTED_SOURCE,
  CONVERSATION_SELECTION_ROLLOUT_MODE,
  ConversationSelectionRolloutMode,
  SelectedCandidateDecision,
} from './conversation-candidate-selection.contract';

export interface SelectNutritionConversationCandidateInput {
  readonly officialResponse: string;
  readonly candidate: LanguageRealizationResult | null;
  readonly comparison: ConversationComparisonResult;
  readonly metadata: {
    readonly rolloutMode: ConversationSelectionRolloutMode;
    readonly formatterVersion: string;
    readonly promptVersionId: string | null;
    readonly candidateJobId: string | null;
    readonly timestamp: string;
  };
}

const HUMANIZER_CHECKS = [
  'EMOJI_COUNT_VALID',
  'NO_TECHNICAL_TITLE',
  'NO_REPORT_STRUCTURE',
  'NO_STRUCTURAL_REPETITION',
] as const satisfies readonly ConversationComparisonCheckCode[];

const STRUCTURAL_CHECKS = [
  'QUESTION_AUTHORIZED',
  'CLOSING_PRESERVED',
  'LENGTH_WITHIN_LIMIT',
  'PARAGRAPH_COUNT_WITHIN_PLAN',
  'LIST_PRESENTATION_VALID',
  'QUESTION_COUNT_VALID',
  'DECISIONS_COVERED',
  'BLOCKS_COVERED',
  'NO_UNDECLARED_OMISSIONS',
] as const satisfies readonly ConversationComparisonCheckCode[];

@Injectable()
export class NutritionConversationCandidateSelectorService {
  select(
    input: SelectNutritionConversationCandidateInput,
  ): SelectedCandidateDecision {
    const passed = new Set(input.comparison.passedChecks);
    const warnings = new Set(input.comparison.warnings);
    const blockingFailures = input.comparison.failedChecks.filter(
      (code) => !warnings.has(code),
    );
    const candidateAvailable =
      input.candidate?.candidateText !== null &&
      input.candidate?.candidateText !== undefined &&
      input.candidate.candidateText.trim().length > 0 &&
      passed.has('CANDIDATE_AVAILABLE');
    const candidateValid =
      candidateAvailable &&
      input.comparison.candidateEligible &&
      (input.candidate?.status === 'COMPLETED' ||
        input.candidate?.status === 'PARTIALLY_COMPLETED') &&
      blockingFailures.length === 0;
    const selection = this.selection(
      candidateAvailable,
      candidateValid,
      input.metadata.rolloutMode,
    );
    const candidateSelected =
      candidateValid &&
      input.metadata.rolloutMode !== CONVERSATION_SELECTION_ROLLOUT_MODE.OFF;
    const metrics = Object.freeze({
      formatterLength: Array.from(input.officialResponse).length,
      candidateLength: input.comparison.metrics.candidateCharacters,
      candidateUnitCount: input.candidate?.realizedUnits.length ?? 0,
      disclaimerPresent: input.candidate?.disclaimerRealized ?? false,
      requiredFactsPresent: passed.has('AUTHORIZED_FACTS_PRESERVED'),
      structureValid: this.allPassed(STRUCTURAL_CHECKS, passed),
      humanizerScore: candidateAvailable
        ? this.score(HUMANIZER_CHECKS, passed)
        : 0,
      validatorScore: candidateAvailable
        ? this.score(
            input.comparison.checks
              .filter((check) => !check.warning)
              .map((check) => check.code),
            passed,
          )
        : 0,
    });

    return Object.freeze({
      selectedSource: candidateSelected
        ? CONVERSATION_SELECTED_SOURCE.CANDIDATE
        : CONVERSATION_SELECTED_SOURCE.FORMATTER,
      reason: selection.reason,
      comparisonScore: candidateAvailable
        ? this.score(
            input.comparison.checks.map((check) => check.code),
            passed,
          )
        : 0,
      promptVersionId: input.metadata.promptVersionId,
      candidateJobId: input.metadata.candidateJobId,
      formatterVersion: input.metadata.formatterVersion,
      selectionStatus: selection.selectionStatus,
      rolloutMode: input.metadata.rolloutMode,
      candidateAvailable,
      candidateValid,
      timestamp: input.metadata.timestamp,
      metrics,
    });
  }

  private selection(
    candidateAvailable: boolean,
    candidateValid: boolean,
    rolloutMode: ConversationSelectionRolloutMode,
  ): Pick<SelectedCandidateDecision, 'reason' | 'selectionStatus'> {
    if (!candidateAvailable) {
      return {
        reason: CANDIDATE_SELECTION_REASON.CANDIDATE_UNAVAILABLE,
        selectionStatus: CANDIDATE_SELECTION_STATUS.NO_CANDIDATE,
      };
    }

    if (!candidateValid) {
      return {
        reason: CANDIDATE_SELECTION_REASON.CANDIDATE_VALIDATION_FAILED,
        selectionStatus: CANDIDATE_SELECTION_STATUS.INVALID_CANDIDATE,
      };
    }

    if (rolloutMode === CONVERSATION_SELECTION_ROLLOUT_MODE.OFF) {
      return {
        reason: CANDIDATE_SELECTION_REASON.ROLLOUT_MODE_OFF,
        selectionStatus: CANDIDATE_SELECTION_STATUS.FUTURE_ROLLOUT_DISABLED,
      };
    }
    return {
      reason: CANDIDATE_SELECTION_REASON.CANDIDATE_PROMOTED,
      selectionStatus: CANDIDATE_SELECTION_STATUS.CANDIDATE_SELECTED,
    };
  }

  private allPassed(
    codes: readonly ConversationComparisonCheckCode[],
    passed: ReadonlySet<ConversationComparisonCheckCode>,
  ): boolean {
    return codes.every((code) => passed.has(code));
  }

  private score(
    codes: readonly ConversationComparisonCheckCode[],
    passed: ReadonlySet<ConversationComparisonCheckCode>,
  ): number {
    if (codes.length === 0) return 0;

    const passedCount = codes.filter((code) => passed.has(code)).length;
    return Math.round((passedCount / codes.length) * 100);
  }
}
