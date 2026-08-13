import type { ProviderRealizationView } from './provider-realization-view.contract';
import type { SanitizedConversationPayload } from './sanitized-conversation-payload.contract';

export class ProviderRealizationViewBuilder {
  build(payload: SanitizedConversationPayload): ProviderRealizationView {
    const facts = new Map(
      [...payload.facts.allowed, ...payload.facts.sensitive].map((fact) => [
        fact.key,
        fact,
      ]),
    );
    const blocks = Object.freeze(
      payload.structure.blocks.map((block) =>
        Object.freeze({
          ...block,
          facts: Object.freeze(
            block.facts.map((factKey) => {
              const fact = facts.get(factKey);
              if (!fact) {
                throw new Error('Bloco referencia fato sanitizado inexistente');
              }
              return fact;
            }),
          ),
        }),
      ),
    );

    return Object.freeze({
      selectedDecisions: payload.selectedDecisions,
      disclaimerRequired: payload.facts.disclaimerRequired,
      structure: Object.freeze({ ...payload.structure, blocks }),
      style: payload.style,
      limits: payload.limits,
      policies: payload.policies,
    });
  }
}
