import { ConversationMessageNormalizerService } from './conversation-message-normalizer.service';
import { ConversationEntityRecognizerService } from './conversation-entity-recognizer.service';
import { ConversationOperationResolverService } from './conversation-operation-resolver.service';
import { ConversationDomainResolverService } from './conversation-domain-resolver.service';
import { dailyQuery, isDailyMealRequest } from './daily-query.policy';
import { isWorkoutCurrentPlanRead } from '../../workout/v2/workout-current-plan-read.policy';

const normalizer = new ConversationMessageNormalizerService();
const entities = new ConversationEntityRecognizerService();
const operations = new ConversationOperationResolverService();
const domains = new ConversationDomainResolverService();

/** Recognize a new domain without borrowing the pending question's domain. */
export function explicitContinuationDomain(
  text: string,
): 'NUTRITION' | 'WORKOUT' | 'COMBINED' | null {
  // The existing meal-read route also owns corrections mentioning an old workout.
  if (isDailyMealRequest(text) || dailyQuery(text)) return 'NUTRITION';
  const input = {
    continuity: {
      currentLogicalTurn: 0,
      activeProfileField: null,
      pendingConfirmation: false,
      targetPlan: null,
    },
  } as const;
  const message = normalizer.normalize(text);
  const recognized = entities.recognize(message);
  const operation = operations.resolve(input, message, recognized);
  if (!operation.explicit && !isWorkoutCurrentPlanRead(text)) return null;
  const { domain } = domains.resolve(input, message, recognized, {
    references: [],
    usedRecentHistory: false,
    usedContinuity: false,
    usedProfile: false,
  });
  return domain === 'NUTRITION' || domain === 'WORKOUT' || domain === 'COMBINED'
    ? domain
    : null;
}
