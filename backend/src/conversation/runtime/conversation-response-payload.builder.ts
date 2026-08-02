import { Injectable } from '@nestjs/common';
import type { ConversationExecutionRoute } from '../contracts/conversation-execution-route.contract';

export type ConversationResponsePayload =
  | Readonly<{ kind: 'GENERIC_ACKNOWLEDGEMENT' }>
  | Readonly<{
      kind: 'CONFIRMATION_REQUEST';
      targetPlan: 'DIET' | 'WORKOUT' | 'BOTH' | null;
    }>
  | Readonly<{
      kind: 'SAFETY_GUIDANCE';
      action: 'CAUTION_GUIDANCE' | 'PROFESSIONAL_GUIDANCE' | 'URGENT_GUIDANCE';
    }>;

export interface ConversationRealizedResponse {
  readonly message: string;
  readonly requiresFollowUp: boolean;
  readonly followUpQuestion: string | null;
}

@Injectable()
export class ConversationResponsePayloadBuilder {
  build(route: ConversationExecutionRoute): ConversationResponsePayload | null {
    if (route.kind === 'ANSWER_MESSAGE') {
      return Object.freeze({ kind: 'GENERIC_ACKNOWLEDGEMENT' });
    }
    if (route.kind === 'CONFIRMATION') {
      return Object.freeze({
        kind: 'CONFIRMATION_REQUEST',
        targetPlan: route.targetPlan,
      });
    }
    if (route.kind === 'SAFETY_RESPONSE') {
      return Object.freeze({ kind: 'SAFETY_GUIDANCE', action: route.action });
    }
    return null;
  }
}
