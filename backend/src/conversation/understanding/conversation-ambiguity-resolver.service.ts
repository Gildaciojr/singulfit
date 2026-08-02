import { Injectable } from '@nestjs/common';
import type { ConversationAmbiguity } from '../contracts/conversation-understanding.contract';
import { CONVERSATION_OPERATION } from '../contracts/conversation-intent.contract';
import type {
  ConversationAmbiguityResolution,
  ConversationDomainResolution,
  ConversationIntentResolution,
  ConversationOperationResolution,
  ConversationReferenceResolution,
  NormalizedConversationMessage,
} from '../contracts/conversation-understanding-pipeline.contract';

type AmbiguityCode = ConversationAmbiguity['codes'][number];

@Injectable()
export class ConversationAmbiguityResolverService {
  resolve(
    message: NormalizedConversationMessage,
    references: ConversationReferenceResolution,
    operation: ConversationOperationResolution,
    domain: ConversationDomainResolution,
    intent: ConversationIntentResolution,
  ): ConversationAmbiguityResolution {
    const codes = new Set<AmbiguityCode>();
    const vagueMutation =
      /\b(quero mudar|troca isso|troque isso|faz outro|faca outro|melhora|quero diferente)\b/u.test(
        message.folded,
      );
    const unresolvedPlan = references.references.some(
      (reference) =>
        reference.kind === 'PLAN' && reference.resolution === 'UNRESOLVED',
    );
    if (operation.candidates.length > 1) codes.add('MULTIPLE_OPERATIONS');
    if (
      (operation.operation === CONVERSATION_OPERATION.GENERATE_PLAN ||
        operation.operation === CONVERSATION_OPERATION.UPDATE_PLAN ||
        operation.operation === CONVERSATION_OPERATION.SUBSTITUTE_ITEM) &&
      (domain.domain === 'GENERAL' || domain.domain === 'UNKNOWN')
    ) {
      codes.add('MISSING_DOMAIN');
    }
    if (
      unresolvedPlan &&
      (operation.operation === CONVERSATION_OPERATION.UPDATE_PLAN ||
        operation.operation === CONVERSATION_OPERATION.SUBSTITUTE_ITEM ||
        operation.operation === CONVERSATION_OPERATION.PRESENT_CURRENT_PLAN)
    ) {
      codes.add('MISSING_REFERENCE');
    }
    if (
      domain.domain === 'COMBINED' &&
      operation.operation !== CONVERSATION_OPERATION.GENERATE_PLAN
    ) {
      codes.add('CONFLICTING_GOALS');
    }
    if (vagueMutation && intent.intent === 'UNKNOWN') {
      codes.add('INSUFFICIENT_CONTEXT');
    }

    return Object.freeze({
      ambiguity: Object.freeze({
        present: codes.size > 0,
        codes: Object.freeze([...codes]),
        clarificationRequired: codes.size > 0,
      }),
    });
  }
}
