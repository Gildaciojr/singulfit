import { Injectable } from '@nestjs/common';
import type { ProfileAcquisitionDecision } from '../../context/coach-adaptive-profile-collector.contract';
import type { ConversationCollectorContext } from '../contracts/conversation-context.contract';

@Injectable()
export class ProfileAcquisitionDecisionConversationAdapter {
  adapt(decision: ProfileAcquisitionDecision): ConversationCollectorContext {
    return Object.freeze({
      intent: decision.intent,
      shouldAsk: decision.shouldAsk,
      selectedField: decision.selectedCandidate?.field ?? null,
      readyPlans: Object.freeze(
        decision.readiness
          .filter((item) => item.ready)
          .map((item) => item.plan),
      ),
      blockedPlans: Object.freeze(
        decision.readiness
          .filter((item) => !item.ready)
          .map((item) => item.plan),
      ),
      reason: decision.reason,
    });
  }
}
