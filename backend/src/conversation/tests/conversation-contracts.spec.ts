import { CONVERSATION_RECOGNIZED_INTENT } from '../../context/conversation-goal-planner.contract';
import {
  CONVERSATION_DOMAIN,
  CONVERSATION_INTENT,
  CONVERSATION_OPERATION,
} from '../contracts/conversation-intent.contract';
import { CONVERSATION_UNDERSTANDING_VERSION } from '../contracts/conversation-understanding.contract';

describe('Conversation contracts', () => {
  it('reuses the Planner intent vocabulary without duplicating it', () => {
    expect(CONVERSATION_INTENT).toBe(CONVERSATION_RECOGNIZED_INTENT);
    expect(CONVERSATION_INTENT.DIET_PLAN_REQUEST).toBe('DIET_PLAN_REQUEST');
  });

  it('keeps operations separate from domains and intents', () => {
    expect(CONVERSATION_OPERATION.GENERATE_PLAN).toBe('GENERATE_PLAN');
    expect(CONVERSATION_DOMAIN.NUTRITION).toBe('NUTRITION');
    expect(CONVERSATION_UNDERSTANDING_VERSION).toBe(
      'conversation-understanding:v1',
    );
  });
});
