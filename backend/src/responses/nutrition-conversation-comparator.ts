import type {
  ConversationCandidateState,
  ConversationComparisonCheck,
  ConversationComparisonCheckCode,
  ConversationComparisonResult,
} from './conversation-comparison.contract';
import type { LanguageRealizationResult } from './conversation-language-realization.contract';
import type { LegacyCandidateComparisonEnvelope } from './conversation-response-comparison.contract';
import type { SanitizedConversationPayload } from './sanitized-conversation-payload.contract';

export interface CompareNutritionConversationInput {
  readonly envelope: LegacyCandidateComparisonEnvelope;
  readonly candidate: LanguageRealizationResult | null;
  readonly payload: SanitizedConversationPayload;
  readonly incrementalLatencyMs: number;
}

export class NutritionConversationComparator {
  compare(
    input: CompareNutritionConversationInput,
  ): ConversationComparisonResult {
    const text = input.envelope.candidate.content ?? '';
    const candidate = input.candidate;
    const realizedFacts = new Set(candidate?.realizedFacts ?? []);
    const realizedDecisions = new Set(candidate?.realizedDecisions ?? []);
    const realizedBlocks = new Set(
      candidate?.realizedUnits.map((unit) => unit.blockKey) ?? [],
    );
    const omittedBlocks = new Set(
      candidate?.omittedUnits.map((unit) => unit.blockKey) ?? [],
    );
    const requiredFacts = new Set(
      input.payload.structure.blocks
        .filter((block) => block.required)
        .flatMap((block) => block.facts),
    );
    const plannedDecisions = new Set(
      input.payload.structure.blocks.flatMap((block) => block.decisions),
    );
    const allNumbers = new Set(
      [
        ...input.payload.facts.allowed,
        ...input.payload.facts.sensitive,
      ].flatMap((fact) => this.numbers(fact.value)),
    );
    const candidateNumbers = this.textNumbers(text);
    const candidateParagraphs = this.paragraphs(text);
    const legacyText = input.envelope.legacy.content ?? '';
    const candidateAvailable = input.envelope.candidate.available;
    const checks: ConversationComparisonCheck[] = [
      this.check('CANDIDATE_AVAILABLE', candidateAvailable),
      this.check('CANDIDATE_ELIGIBLE', input.envelope.candidate.eligible),
      this.check(
        'AUTHORIZED_FACTS_PRESERVED',
        candidateAvailable &&
          [...requiredFacts].every((fact) => realizedFacts.has(fact)),
      ),
      this.check(
        'AUTHORIZED_NUMBERS_PRESERVED',
        candidateAvailable &&
          candidateNumbers.every((number) => allNumbers.has(number)),
      ),
      this.check(
        'DISCLAIMER_PRESERVED',
        input.payload.facts.disclaimerRequired.length === 0 ||
          candidate?.disclaimerRealized === true,
      ),
      this.check(
        'QUESTION_AUTHORIZED',
        (candidate?.producedQuestionCount ?? 0) <=
          input.payload.limits.maximumQuestions,
      ),
      this.check(
        'CLOSING_PRESERVED',
        !plannedDecisions.has('CLOSE_WITHOUT_QUESTION') ||
          candidate?.closingRealized === true,
      ),
      this.check(
        'LENGTH_WITHIN_LIMIT',
        Array.from(text).length <= input.payload.limits.maximumLength,
      ),
      this.check(
        'PARAGRAPH_COUNT_WITHIN_PLAN',
        candidateParagraphs <= input.payload.structure.paragraphCount,
      ),
      this.check(
        'LIST_PRESENTATION_VALID',
        input.payload.structure.presentation !== 'PROSE' || !this.hasList(text),
      ),
      this.check(
        'QUESTION_COUNT_VALID',
        this.count(text, '?') <= input.payload.limits.maximumQuestions,
      ),
      this.check(
        'EMOJI_COUNT_VALID',
        this.emojiCount(text) <= input.payload.limits.maximumEmojiCount,
      ),
      this.check('NO_TECHNICAL_TITLE', !this.hasTechnicalTitle(text)),
      this.check('NO_REPORT_STRUCTURE', !this.hasReportStructure(text)),
      this.check(
        'DECISIONS_COVERED',
        candidateAvailable &&
          [...plannedDecisions].every(
            (decision) =>
              realizedDecisions.has(decision) ||
              candidate?.omittedDecisions.some(
                (omitted) => omitted.decision === decision,
              ),
          ),
      ),
      this.check(
        'BLOCKS_COVERED',
        candidateAvailable &&
          input.payload.structure.blocks.every(
            (block) =>
              realizedBlocks.has(block.key) || omittedBlocks.has(block.key),
          ),
      ),
      this.check(
        'NO_UNDECLARED_OMISSIONS',
        candidateAvailable &&
          (candidate?.omittedUnits.length ?? 0) === omittedBlocks.size,
        (candidate?.omittedUnits.length ?? 0) > 0,
      ),
      this.check(
        'NO_STRUCTURAL_REPETITION',
        !this.hasRepeatedParagraph(candidate?.candidateText ?? ''),
        this.hasRepeatedParagraph(candidate?.candidateText ?? ''),
      ),
    ];
    const frozenChecks = Object.freeze(
      checks.map((check) => Object.freeze(check)),
    );
    const failedChecks = Object.freeze(
      frozenChecks.filter((check) => !check.passed).map((check) => check.code),
    );
    const warnings = Object.freeze(
      frozenChecks.filter((check) => check.warning).map((check) => check.code),
    );

    return Object.freeze({
      outcome: 'LEGACY_PREFERRED',
      selectedOrigin: 'LEGACY',
      candidateState: this.candidateState(candidate),
      candidateEligible: input.envelope.candidate.eligible,
      ...(!input.envelope.candidate.eligible
        ? {
            ineligibilityCode:
              input.envelope.candidate.rejectionCode ?? 'NOT_ELIGIBLE',
          }
        : {}),
      passedChecks: Object.freeze(
        frozenChecks.filter((check) => check.passed).map((check) => check.code),
      ),
      failedChecks,
      warnings,
      divergenceCodes: Object.freeze(
        failedChecks.map((code) => `DIVERGENCE:${code}`),
      ),
      checks: frozenChecks,
      metrics: Object.freeze({
        legacyCharacters: Array.from(legacyText).length,
        candidateCharacters: Array.from(text).length,
        legacyParagraphs: this.paragraphs(legacyText),
        candidateParagraphs,
        legacyQuestions: this.count(legacyText, '?'),
        candidateQuestions: this.count(text, '?'),
        legacyEmojis: this.emojiCount(legacyText),
        candidateEmojis: this.emojiCount(text),
        candidateOmissions: candidate?.omittedUnits.length ?? 0,
        incrementalLatencyMs: Math.max(0, input.incrementalLatencyMs),
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
      }),
    });
  }

  private candidateState(
    candidate: LanguageRealizationResult | null,
  ): ConversationCandidateState {
    if (!candidate) return 'NOT_EXECUTED';
    if (candidate.status === 'COMPLETED') return 'ELIGIBLE';
    if (candidate.status === 'PARTIALLY_COMPLETED') return 'PARTIAL';
    if (candidate.status === 'FALLBACK') {
      return candidate.fallbackReason === 'PROVIDER_FAILURE'
        ? 'PROVIDER_FAILURE'
        : 'FALLBACK';
    }
    if (candidate.status === 'TIMED_OUT') return 'TIMEOUT';
    if (candidate.status === 'INVALID_STRUCTURE') return 'INVALID_STRUCTURE';
    if (candidate.status === 'EMPTY' || candidate.status === 'FAILED')
      return 'INELIGIBLE';
    return 'GENERATED';
  }

  private check(
    code: ConversationComparisonCheckCode,
    passed: boolean,
    warning = false,
  ): ConversationComparisonCheck {
    return { code, passed, warning };
  }

  private numbers(value: unknown): number[] {
    if (typeof value === 'number') return [value];
    if (Array.isArray(value))
      return value.flatMap((item) => this.numbers(item));
    if (this.isRecord(value))
      return Object.values(value).flatMap((item) => this.numbers(item));
    return [];
  }

  private textNumbers(value: string): number[] {
    return [...value.matchAll(/(?<![\p{L}\d])\d+(?:[.,]\d+)?/gu)].map((match) =>
      Number(match[0].replace(',', '.')),
    );
  }

  private paragraphs(value: string): number {
    return value.trim() ? value.trim().split(/\n\s*\n/).length : 0;
  }

  private hasList(value: string): boolean {
    return /^(?:[-*•]|\d+[.)])\s+/m.test(value);
  }

  private hasTechnicalTitle(value: string): boolean {
    return /^(?:resumo nutricional|análise nutricional|relatório|disclaimer|bloco|decisão)\s*:/im.test(
      value,
    );
  }

  private hasReportStructure(value: string): boolean {
    return /(?:^|\n)#{1,6}\s|\|\s*[-:]+\s*\||(?:^|\n)(?:conclusão|metodologia|resultados)\s*:/im.test(
      value,
    );
  }

  private hasRepeatedParagraph(value: string): boolean {
    const paragraphs = value
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim().toLowerCase())
      .filter(Boolean);
    return new Set(paragraphs).size !== paragraphs.length;
  }

  private emojiCount(value: string): number {
    return [...value.matchAll(/\p{Extended_Pictographic}/gu)].length;
  }

  private count(value: string, character: string): number {
    return Array.from(value).filter((item) => item === character).length;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
