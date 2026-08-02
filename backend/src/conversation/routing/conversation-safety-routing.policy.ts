import type {
  ConversationSafety,
  ConversationSafetySignal,
} from '../contracts/conversation-understanding.contract';
import type {
  ConversationSafetyAction,
  ConversationSafetyRoutingDecision,
} from '../contracts/conversation-execution-route.contract';

const ACTION_PRIORITY: Readonly<Record<ConversationSafetyAction, number>> =
  Object.freeze({
    CONTINUE: 0,
    CAUTION_GUIDANCE: 1,
    PROFESSIONAL_GUIDANCE: 2,
    URGENT_GUIDANCE: 3,
  });

export function evaluateConversationSafety(
  safety: ConversationSafety,
): ConversationSafetyRoutingDecision {
  const action = safety.signals
    .map((signal) => actionFor(signal))
    .reduce<ConversationSafetyAction>(
      (selected, candidate) =>
        ACTION_PRIORITY[candidate] > ACTION_PRIORITY[selected]
          ? candidate
          : selected,
      'CONTINUE',
    );

  return Object.freeze({
    action,
    routeRequired: action !== 'CONTINUE',
    reasonCodes: Object.freeze(
      safety.signals
        .filter((signal) => actionFor(signal) !== 'CONTINUE')
        .map((signal) => `${signal.category}_${signal.severity}`),
    ),
  });
}

function actionFor(signal: ConversationSafetySignal): ConversationSafetyAction {
  if (signal.severity === 'HIGH') return 'URGENT_GUIDANCE';
  if (signal.severity === 'MEDIUM') return 'PROFESSIONAL_GUIDANCE';
  if (
    signal.category === 'MEDICAL' ||
    signal.category === 'INCAPACITY' ||
    signal.category === 'EXTREME_REQUEST' ||
    signal.category === 'INJURY'
  ) {
    return 'PROFESSIONAL_GUIDANCE';
  }
  if (signal.category === 'PAIN' && signal.severity === 'LOW') {
    return 'CAUTION_GUIDANCE';
  }
  return 'CONTINUE';
}
