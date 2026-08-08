import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ConversationComparisonCheck,
  ConversationComparisonCheckCode,
  ConversationComparisonResult,
} from './conversation-comparison.contract';
import type { LanguageRealizationResult } from './conversation-language-realization.contract';
import {
  CANDIDATE_SELECTION_STATUS,
  CONVERSATION_SELECTED_SOURCE,
  CONVERSATION_SELECTION_ROLLOUT_MODE,
} from './conversation-candidate-selection.contract';
import { NutritionConversationCandidateSelectorService } from './nutrition-conversation-candidate-selector.service';

const CHECK_CODES: readonly ConversationComparisonCheckCode[] = [
  'CANDIDATE_AVAILABLE',
  'CANDIDATE_ELIGIBLE',
  'AUTHORIZED_FACTS_PRESERVED',
  'AUTHORIZED_NUMBERS_PRESERVED',
  'DISCLAIMER_PRESERVED',
  'QUESTION_AUTHORIZED',
  'CLOSING_PRESERVED',
  'LENGTH_WITHIN_LIMIT',
  'PARAGRAPH_COUNT_WITHIN_PLAN',
  'LIST_PRESENTATION_VALID',
  'QUESTION_COUNT_VALID',
  'EMOJI_COUNT_VALID',
  'NO_TECHNICAL_TITLE',
  'NO_REPORT_STRUCTURE',
  'DECISIONS_COVERED',
  'BLOCKS_COVERED',
  'NO_UNDECLARED_OMISSIONS',
  'NO_STRUCTURAL_REPETITION',
];

function realization(
  overrides: Partial<LanguageRealizationResult> = {},
): LanguageRealizationResult {
  return {
    id: 'realization-id',
    sanitizedPayloadReference: 'payload-reference',
    status: 'COMPLETED',
    candidateText: 'Uma resposta humana e validada.',
    candidateTextSource: 'VALIDATED_UNITS',
    realizedUnits: [
      {
        id: 'unit-1',
        blockKey: 'response',
        text: 'Uma resposta humana e validada.',
      },
    ],
    omittedUnits: [],
    realizedFacts: [],
    omittedFacts: [],
    realizedDecisions: [],
    omittedDecisions: [],
    disclaimerRealized: true,
    questionRealized: false,
    closingRealized: true,
    producedLength: 32,
    producedQuestionCount: 0,
    warningCodes: [],
    ...overrides,
  } as LanguageRealizationResult;
}

function comparison(
  failed: readonly ConversationComparisonCheckCode[] = [],
  warnings: readonly ConversationComparisonCheckCode[] = [],
): ConversationComparisonResult {
  const failedSet = new Set(failed);
  const warningSet = new Set(warnings);
  const checks: readonly ConversationComparisonCheck[] = CHECK_CODES.map(
    (code) => ({
      code,
      passed: !failedSet.has(code),
      warning: warningSet.has(code),
    }),
  );
  return {
    outcome: 'LEGACY_PREFERRED',
    selectedOrigin: 'LEGACY',
    candidateState: 'ELIGIBLE',
    candidateEligible: true,
    passedChecks: CHECK_CODES.filter((code) => !failedSet.has(code)),
    failedChecks: failed,
    warnings,
    divergenceCodes: failed.map((code) => `DIVERGENCE:${code}`),
    checks,
    metrics: {
      legacyCharacters: 17,
      candidateCharacters: 32,
      legacyParagraphs: 1,
      candidateParagraphs: 1,
      legacyQuestions: 0,
      candidateQuestions: 0,
      legacyEmojis: 0,
      candidateEmojis: 0,
      candidateOmissions: 0,
      incrementalLatencyMs: 10,
      promptTokens: 100,
      completionTokens: 40,
      totalTokens: 140,
    },
  };
}

const metadata = Object.freeze({
  rolloutMode: CONVERSATION_SELECTION_ROLLOUT_MODE.OFF,
  formatterVersion: 'nutrition-response-formatter:v1',
  promptVersionId: 'prompt-version-id',
  candidateJobId: 'candidate-job-id',
  timestamp: '2026-07-15T12:00:00.000Z',
});

describe('NutritionConversationCandidateSelectorService', () => {
  const selector = new NutritionConversationCandidateSelectorService();

  it('exposes the complete rollout and selection state vocabulary', () => {
    expect(Object.values(CONVERSATION_SELECTION_ROLLOUT_MODE)).toEqual([
      'OFF',
      'INTERNAL',
      'CANARY',
      'ROLLOUT',
      'PRIMARY',
    ]);
    expect(Object.values(CANDIDATE_SELECTION_STATUS)).toEqual([
      'CANDIDATE_SELECTED',
      'FORMATTER_SELECTED',
      'NO_CANDIDATE',
      'INVALID_CANDIDATE',
      'VALID_CANDIDATE_NOT_SELECTED',
      'FUTURE_ROLLOUT_DISABLED',
    ]);
  });

  it('keeps Formatter official when Candidate rollout is OFF', () => {
    const decision = selector.select({
      officialResponse: 'Resposta oficial.',
      candidate: realization(),
      comparison: comparison(),
      metadata,
    });
    expect(decision).toEqual(
      expect.objectContaining({
        selectedSource: CONVERSATION_SELECTED_SOURCE.FORMATTER,
        selectionStatus: CANDIDATE_SELECTION_STATUS.FUTURE_ROLLOUT_DISABLED,
        candidateAvailable: true,
        candidateValid: true,
        comparisonScore: 100,
        promptVersionId: 'prompt-version-id',
        candidateJobId: 'candidate-job-id',
      }),
    );
    expect(decision.metrics).toEqual({
      formatterLength: 17,
      candidateLength: 32,
      candidateUnitCount: 1,
      disclaimerPresent: true,
      requiredFactsPresent: true,
      structureValid: true,
      humanizerScore: 100,
      validatorScore: 100,
    });
  });

  it('selects a valid Candidate when rollout is authorized', () => {
    const decision = selector.select({
      officialResponse: 'Resposta oficial.',
      candidate: realization(),
      comparison: comparison(),
      metadata: {
        ...metadata,
        rolloutMode: CONVERSATION_SELECTION_ROLLOUT_MODE.PRIMARY,
      },
    });

    expect(decision).toMatchObject({
      selectedSource: CONVERSATION_SELECTED_SOURCE.CANDIDATE,
      selectionStatus: CANDIDATE_SELECTION_STATUS.CANDIDATE_SELECTED,
      candidateValid: true,
    });
  });

  it('classifies absence and invalidity without ever selecting the candidate', () => {
    const absentComparison = comparison(['CANDIDATE_AVAILABLE']);
    const absent = selector.select({
      officialResponse: 'Resposta oficial.',
      candidate: null,
      comparison: {
        ...absentComparison,
        candidateEligible: false,
        candidateState: 'NOT_EXECUTED',
      },
      metadata: { ...metadata, candidateJobId: null, promptVersionId: null },
    });
    const invalid = selector.select({
      officialResponse: 'Resposta oficial.',
      candidate: realization(),
      comparison: comparison(['AUTHORIZED_FACTS_PRESERVED']),
      metadata,
    });
    expect(absent.selectionStatus).toBe(
      CANDIDATE_SELECTION_STATUS.NO_CANDIDATE,
    );
    expect(absent.selectedSource).toBe(CONVERSATION_SELECTED_SOURCE.FORMATTER);
    expect(invalid.selectionStatus).toBe(
      CANDIDATE_SELECTION_STATUS.INVALID_CANDIDATE,
    );
    expect(invalid.candidateValid).toBe(false);
    expect(invalid.selectedSource).toBe(CONVERSATION_SELECTED_SOURCE.FORMATTER);
  });

  it('rejects empty candidate content even when comparison metadata says available', () => {
    const decision = selector.select({
      officialResponse: 'Resposta oficial.',
      candidate: realization({ candidateText: '   ' }),
      comparison: comparison(),
      metadata,
    });

    expect(decision.candidateAvailable).toBe(false);
    expect(decision.candidateValid).toBe(false);
    expect(decision.selectedSource).toBe(
      CONVERSATION_SELECTED_SOURCE.FORMATTER,
    );
  });

  it('treats declared warnings as non-blocking and selects the Candidate', () => {
    const decision = selector.select({
      officialResponse: 'Resposta oficial.',
      candidate: realization({ status: 'PARTIALLY_COMPLETED' }),
      comparison: comparison(
        ['NO_UNDECLARED_OMISSIONS'],
        ['NO_UNDECLARED_OMISSIONS'],
      ),
      metadata: {
        ...metadata,
        rolloutMode: CONVERSATION_SELECTION_ROLLOUT_MODE.INTERNAL,
      },
    });
    expect(decision.candidateValid).toBe(true);
    expect(decision.selectionStatus).toBe(
      CANDIDATE_SELECTION_STATUS.CANDIDATE_SELECTED,
    );
    expect(decision.selectedSource).toBe(
      CONVERSATION_SELECTED_SOURCE.CANDIDATE,
    );
  });

  it('is deterministic and deeply freezes the returned decision', () => {
    const input = {
      officialResponse: 'Resposta oficial.',
      candidate: realization(),
      comparison: comparison(),
      metadata,
    };
    const first = selector.select(input);
    expect(first).toEqual(selector.select(input));
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.metrics)).toBe(true);
  });

  it('has no AI, formatter, persistence, randomness or production integration', () => {
    const source = readFileSync(
      join(__dirname, 'nutrition-conversation-candidate-selector.service.ts'),
      'utf8',
    );
    expect(source).not.toMatch(
      /OpenAI|ConversationAI|PromptService|PrismaService|AuditService|Evolution|Worker|Outbox|EventBus|NutritionResponseFormatter|Math\.random|Date\.now|new Date|console\.log|\bany\b/,
    );
  });
});
