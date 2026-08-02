import { Test } from '@nestjs/testing';
import { ConversationModule } from '../conversation.module';
import { ConversationUnderstandingService } from '../understanding/conversation-understanding.service';
import { ConversationUnderstandingValidator } from '../validators/conversation-understanding.validator';
import { ConversationGoalPreparationService } from '../understanding/conversation-goal-preparation.service';
import { ConversationExecutionRouterService } from '../routing/conversation-execution-router.service';
import { ConversationRoutingDecisionService } from '../routing/conversation-routing-decision.service';

describe('ConversationModule', () => {
  it('compiles in isolation without importing production modules', async () => {
    const module = await Test.createTestingModule({
      imports: [ConversationModule],
    }).compile();

    expect(module.get(ConversationUnderstandingService)).toBeDefined();
    expect(module.get(ConversationUnderstandingValidator)).toBeDefined();
    expect(module.get(ConversationGoalPreparationService)).toBeDefined();
    expect(module.get(ConversationExecutionRouterService)).toBeDefined();
    expect(module.get(ConversationRoutingDecisionService)).toBeDefined();
    await module.close();
  });
});
