import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AuthorizedFacts } from './conversation-authorized-facts.contract';
import type { CandidateValidationResult } from './conversation-candidate-validation.contract';
import type { ConversationComparisonResult } from './conversation-comparison.contract';
import type { CompositionPlan } from './conversation-composition.contract';
import type { DecisionPlan } from './conversation-decision.contract';
import type { LanguageRealizationResult } from './conversation-language-realization.contract';

const CONTRACT_FILES = [
  'conversation-authorized-facts.contract.ts',
  'conversation-decision.contract.ts',
  'conversation-composition.contract.ts',
  'conversation-language-realization.contract.ts',
  'conversation-candidate-validation.contract.ts',
  'conversation-comparison.contract.ts',
  'sanitized-conversation-payload.contract.ts',
] as const;

const PROHIBITED_DEPENDENCIES = [
  '@prisma/client',
  'openai',
  'evolution',
  'docker',
  'worker',
] as const;

function source(fileName: (typeof CONTRACT_FILES)[number]): string {
  return readFileSync(join(__dirname, fileName), 'utf8');
}

describe('Conversation Layer passage contracts', () => {
  it('contains only data declarations without runtime behavior', () => {
    for (const fileName of CONTRACT_FILES) {
      const content = source(fileName);

      expect(content).not.toMatch(/\bclass\b|\bfunction\b|=>/);
      expect(content).not.toMatch(/^\s*(?!readonly\s)[a-zA-Z]\w*\??\s*:/m);
    }
  });

  it('does not use any or import prohibited infrastructure', () => {
    for (const fileName of CONTRACT_FILES) {
      const content = source(fileName);

      expect(content).not.toMatch(/\bany\b/);
      for (const dependency of PROHIBITED_DEPENDENCIES) {
        expect(content.toLowerCase()).not.toContain(dependency);
      }
    }
  });

  it('keeps user-facing text exclusive to the language result', () => {
    const preLanguageFiles = [
      'conversation-authorized-facts.contract.ts',
      'conversation-decision.contract.ts',
      'conversation-composition.contract.ts',
    ] as const;

    for (const fileName of preLanguageFiles) {
      expect(source(fileName)).not.toMatch(
        /candidateText|finalContent|messageText/,
      );
    }

    expect(source('conversation-language-realization.contract.ts')).toContain(
      'readonly candidateText: string | null',
    );
  });

  it('keeps decision, composition, language, validation and comparison distinct', () => {
    const decision: DecisionPlan = {
      id: 'decision-plan',
      primaryDecisionId: 'decision-1',
      selectedDecisions: [],
      suppressedDecisions: [],
      mandatoryDecisionIds: [],
      prohibitedDecisionCodes: [],
      maximumCommunicativeDecisions: 3,
      maximumQuestions: 1,
      maximumActions: 1,
    };
    const facts: AuthorizedFacts = {
      allowed: [],
      restricted: [],
      sensitive: [],
      disclaimerRequired: [],
    };
    const composition: CompositionPlan = {
      id: 'composition-plan',
      decisionPlanId: decision.id,
      blocks: [],
      depth: 'BRIEF',
      density: 'LOW',
      rhythm: 'FAST',
      presentation: 'PROSE',
      paragraphCount: 1,
      maximumLength: 320,
      emojiAllowed: false,
      maximumEmojiCount: 0,
    };
    const language: LanguageRealizationResult = {
      id: 'realization',
      sanitizedPayloadReference: 'sanitized-payload:reference',
      status: 'COMPLETED',
      candidateText: 'candidate',
      candidateTextSource: 'VALIDATED_UNITS',
      realizedUnits: [],
      omittedUnits: [],
      realizedFacts: [],
      omittedFacts: [],
      realizedDecisions: [],
      omittedDecisions: [],
      disclaimerRealized: false,
      questionRealized: false,
      closingRealized: false,
      producedLength: 9,
      producedQuestionCount: 0,
      warningCodes: [],
    };
    const validation: CandidateValidationResult = {
      realizationId: language.id,
      eligible: true,
      fallbackRequired: false,
      violations: [],
      validatedFactIds: [],
      coveredDecisionIds: [],
    };
    const comparison: ConversationComparisonResult = {
      outcome: 'LEGACY_PREFERRED',
      selectedOrigin: 'LEGACY',
      candidateState: 'ELIGIBLE',
      candidateEligible: true,
      passedChecks: [],
      failedChecks: [],
      warnings: [],
      divergenceCodes: [],
      checks: [],
      metrics: {
        legacyCharacters: 6,
        candidateCharacters: 9,
        legacyParagraphs: 1,
        candidateParagraphs: 1,
        legacyQuestions: 0,
        candidateQuestions: 0,
        legacyEmojis: 0,
        candidateEmojis: 0,
        candidateOmissions: 0,
        incrementalLatencyMs: 1,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
      },
    };

    expect({
      decision,
      facts,
      composition,
      language,
      validation,
      comparison,
    }).toEqual(
      expect.objectContaining({
        decision: expect.objectContaining({ id: 'decision-plan' }),
        composition: expect.objectContaining({
          decisionPlanId: 'decision-plan',
        }),
        language: expect.objectContaining({
          sanitizedPayloadReference: 'sanitized-payload:reference',
        }),
        validation: expect.objectContaining({ realizationId: 'realization' }),
        comparison: expect.objectContaining({ selectedOrigin: 'LEGACY' }),
      }),
    );
  });
});
