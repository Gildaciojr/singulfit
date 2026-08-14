import type { ConversationBlockType } from './conversation-composition.contract';
import type { ConversationLanguageUnitType } from './conversation-language-unit.contract';
import {
  CONVERSATION_LANGUAGE_UNIT_ROLE_BY_BLOCK,
  ConversationLanguageUnitRolePolicy,
} from './conversation-language-unit-role.policy';

const EXPECTED_ROLES = {
  DIRECT_OPENING: 'RELATIONAL',
  CONTEXTUAL_OPENING: 'RELATIONAL',
  THREAD_RESUMPTION: 'RELATIONAL',
  FACTUAL_ACKNOWLEDGEMENT: 'FACTUAL',
  EMOTIONAL_ACKNOWLEDGEMENT: 'RELATIONAL',
  EFFORT_ACKNOWLEDGEMENT: 'RELATIONAL',
  CELEBRATION: 'RELATIONAL',
  DIRECT_ANSWER: 'FACTUAL',
  PRIMARY_OBSERVATION: 'FACTUAL',
  INTERPRETATION: 'FACTUAL',
  UNCERTAINTY_QUALIFICATION: 'DISCLAIMER',
  CAUSAL_EXPLANATION: 'FACTUAL',
  NUTRITION_EDUCATION: 'FACTUAL',
  CORRECTION: 'FACTUAL',
  PRIMARY_GUIDANCE: 'FACTUAL',
  PRACTICAL_ALTERNATIVE: 'FACTUAL',
  LIMITED_OPTIONS: 'FACTUAL',
  HISTORICAL_COMPARISON: 'RELATIONAL',
  TREND: 'FACTUAL',
  RELATIONAL_MEMORY: 'RELATIONAL',
  NORMALIZATION: 'RELATIONAL',
  REFRAMING: 'RELATIONAL',
  EVIDENCE_BASED_MOTIVATION: 'RELATIONAL',
  AUTONOMY_REINFORCEMENT: 'RELATIONAL',
  PROFESSIONAL_BOUNDARY: 'FACTUAL',
  REFERRAL: 'FACTUAL',
  CLARIFYING_QUESTION: 'QUESTION',
  EXPERIENTIAL_QUESTION: 'QUESTION',
  REFLECTIVE_QUESTION: 'QUESTION',
  TOPIC_TRANSITION: 'TRANSITION',
  CONFIRMATION: 'RELATIONAL',
  FACTUAL_REASSURANCE: 'FACTUAL',
  NEXT_STEP: 'FACTUAL',
  CONTINUITY_INVITATION: 'RELATIONAL',
  CONFIRMING_CLOSURE: 'CLOSING',
  REASSURING_CLOSURE: 'CLOSING',
  OPEN_CLOSURE: 'CLOSING',
  MINIMAL_CLOSURE: 'CLOSING',
} satisfies Readonly<
  Record<ConversationBlockType, ConversationLanguageUnitType>
>;

describe('ConversationLanguageUnitRolePolicy', () => {
  const policy = new ConversationLanguageUnitRolePolicy();

  it('maps every canonical block type to exactly one unit role', () => {
    expect(CONVERSATION_LANGUAGE_UNIT_ROLE_BY_BLOCK).toEqual(EXPECTED_ROLES);
    for (const [blockType, expectedRole] of Object.entries(EXPECTED_ROLES)) {
      expect(policy.role(blockType as ConversationBlockType)).toBe(
        expectedRole,
      );
    }
  });

  it('fails closed for a runtime block type outside the exhaustive contract', () => {
    expect(() => policy.role('UNKNOWN' as ConversationBlockType)).toThrow(
      'UNSUPPORTED_CONVERSATION_BLOCK_TYPE',
    );
  });
});
