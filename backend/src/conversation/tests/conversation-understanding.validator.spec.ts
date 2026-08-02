import { CONVERSATION_RECOGNIZED_INTENT } from '../../context/conversation-goal-planner.contract';
import {
  CONVERSATION_DOMAIN,
  CONVERSATION_OPERATION,
} from '../contracts/conversation-intent.contract';
import {
  CONVERSATION_UNDERSTANDING_VERSION,
  type ConversationUnderstandingResult,
} from '../contracts/conversation-understanding.contract';
import { ConversationUnderstandingValidator } from '../validators/conversation-understanding.validator';

function validResult(): ConversationUnderstandingResult {
  return Object.freeze({
    status: 'UNDERSTOOD',
    failure: null,
    intent: CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_REQUEST,
    operation: CONVERSATION_OPERATION.GENERATE_PLAN,
    domain: CONVERSATION_DOMAIN.NUTRITION,
    confidence: 'HIGH',
    secondaryIntents: Object.freeze([]),
    entities: Object.freeze([
      Object.freeze({ kind: 'MEAL', name: 'almoço', time: null }),
    ]),
    references: Object.freeze([
      Object.freeze({
        kind: 'PLAN',
        domain: 'NUTRITION',
        target: 'CURRENT',
        ordinal: null,
        resolution: 'RESOLVED',
        source: 'PROFILE_CONTEXT',
      }),
    ]),
    ambiguity: Object.freeze({
      present: false,
      codes: Object.freeze([]),
      clarificationRequired: false,
    }),
    safety: Object.freeze({
      signals: Object.freeze([]),
      requiresSafeResponse: false,
      requiresProfessionalGuidance: false,
      medicalAdviceProhibited: true,
    }),
    metadata: Object.freeze({
      contractVersion: CONVERSATION_UNDERSTANDING_VERSION,
      source: 'DETERMINISTIC',
      operationKey: 'conversation-understanding:v1:test',
      evaluatedAt: '2026-08-01T12:00:00.000Z',
      contextUsed: Object.freeze(['CURRENT_MESSAGE']),
      rationaleCodes: Object.freeze(['EXPLICIT_CURRENT_TURN']),
    }),
  });
}

describe('ConversationUnderstandingValidator', () => {
  const validator = new ConversationUnderstandingValidator();

  it('accepts a consistent immutable result', () => {
    expect(validator.validate(validResult())).toEqual({
      valid: true,
      errors: [],
    });
    expect(() => validator.assertValid(validResult())).not.toThrow();
  });

  it('rejects an incompatible operation and domain', () => {
    const invalid: ConversationUnderstandingResult = {
      ...validResult(),
      operation: CONVERSATION_OPERATION.UPDATE_PLAN,
      domain: CONVERSATION_DOMAIN.WORKOUT,
    };

    expect(validator.validate(invalid).errors).toEqual([
      'INVALID_OPERATION',
      'INVALID_DOMAIN',
      'INCOMPATIBLE_ENTITY',
    ]);
  });

  it('rejects contradictory ambiguity state', () => {
    const invalid: ConversationUnderstandingResult = {
      ...validResult(),
      ambiguity: {
        present: true,
        codes: [],
        clarificationRequired: false,
      },
    };

    expect(validator.validate(invalid).errors).toContain('INVALID_AMBIGUITY');
  });

  it('rejects invalid ordinal and logical-turn references', () => {
    const invalid: ConversationUnderstandingResult = {
      ...validResult(),
      references: [
        {
          kind: 'PLAN',
          domain: 'NUTRITION',
          target: 'ORDINAL',
          ordinal: null,
          resolution: 'UNRESOLVED',
          source: 'CURRENT_TURN',
        },
        {
          kind: 'HISTORY_TURN',
          logicalTurn: -1,
          resolution: 'UNRESOLVED',
          source: 'CURRENT_TURN',
        },
      ],
    };

    expect(validator.validate(invalid).errors).toContain('INVALID_REFERENCE');
  });

  it('requires safety evidence and prohibits medical advice', () => {
    const invalid: ConversationUnderstandingResult = {
      ...validResult(),
      entities: [
        {
          kind: 'SAFETY_REPORT',
          signal: 'PAIN',
          bodyArea: 'joelho',
          severity: 'MEDIUM',
        },
      ],
      safety: {
        signals: [],
        requiresSafeResponse: false,
        requiresProfessionalGuidance: false,
        medicalAdviceProhibited: false,
      },
    };

    expect(validator.validate(invalid).errors).toContain('INVALID_SAFETY');
    expect(() => validator.assertValid(invalid)).toThrow(
      'Conversation Understanding inválido',
    );
  });

  it('rejects malformed metadata', () => {
    const invalid: ConversationUnderstandingResult = {
      ...validResult(),
      metadata: {
        ...validResult().metadata,
        operationKey: ' ',
        evaluatedAt: 'not-a-date',
      },
    };
    expect(validator.validate(invalid).errors).toContain('INVALID_METADATA');
  });
});
