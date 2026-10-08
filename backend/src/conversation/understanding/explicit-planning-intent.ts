import { ConversationMessageNormalizerService } from './conversation-message-normalizer.service';
import { ConversationEntityRecognizerService } from './conversation-entity-recognizer.service';
import { ConversationOperationResolverService } from './conversation-operation-resolver.service';
import { ConversationDomainResolverService } from './conversation-domain-resolver.service';
import { ConversationIntentResolverService } from './conversation-intent-resolver.service';
import { affirmativePlanningText } from './planning-request-polarity.policy';

const normalizer = new ConversationMessageNormalizerService();
const entities = new ConversationEntityRecognizerService();
const operations = new ConversationOperationResolverService();
const domains = new ConversationDomainResolverService();
const intents = new ConversationIntentResolverService();

/** Context-free entry recognition uses the same primitives as the runtime. */
export function explicitPlanningIntent(text: string) {
  const input = {
    continuity: {
      currentLogicalTurn: 0,
      activeProfileField: null,
      pendingConfirmation: false,
      targetPlan: null,
    },
  } as const;
  const message = {
    ...normalizer.normalize(affirmativePlanningText(text)),
    question: normalizer.normalize(text).question,
  };
  const operation = operations.resolve(input, message);
  const domain = domains.resolve(input, message, entities.recognize(message), {
    references: [],
    usedRecentHistory: false,
    usedContinuity: false,
    usedProfile: false,
  });
  return intents.resolve(input, operation, domain).intent;
}
