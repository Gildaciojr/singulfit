import type {
  SanitizedConversationBlock,
  SanitizedConversationFact,
  SanitizedConversationPayload,
} from './sanitized-conversation-payload.contract';

export interface ProviderRealizationBlock extends Omit<
  SanitizedConversationBlock,
  'facts'
> {
  readonly facts: readonly SanitizedConversationFact[];
}

export interface ProviderRealizationView {
  readonly selectedDecisions: SanitizedConversationPayload['selectedDecisions'];
  readonly disclaimerRequired: SanitizedConversationPayload['facts']['disclaimerRequired'];
  readonly structure: Omit<
    SanitizedConversationPayload['structure'],
    'blocks'
  > & {
    readonly blocks: readonly ProviderRealizationBlock[];
  };
  readonly style: SanitizedConversationPayload['style'];
  readonly limits: SanitizedConversationPayload['limits'];
  readonly policies: SanitizedConversationPayload['policies'];
}
