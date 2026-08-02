import { Injectable } from '@nestjs/common';
import type { ConversationUnderstandingInput } from '../contracts/conversation-understanding.contract';
import type { ConversationReference } from '../contracts/conversation-entity.contract';
import {
  CONVERSATION_DOMAIN,
  type ConversationDomain,
} from '../contracts/conversation-intent.contract';
import type {
  ConversationDomainResolution,
  ConversationEntityRecognition,
  ConversationReferenceResolution,
  NormalizedConversationMessage,
} from '../contracts/conversation-understanding-pipeline.contract';

@Injectable()
export class ConversationDomainResolverService {
  resolve(
    input: ConversationUnderstandingInput,
    message: NormalizedConversationMessage,
    entityRecognition: ConversationEntityRecognition,
    referenceResolution: ConversationReferenceResolution,
  ): ConversationDomainResolution {
    const candidates = new Set<ConversationDomain>();
    const text = message.folded;
    if (
      /\b(dieta|alimentacao|alimentar|refeicao|comida|alimento|cardapio|whey|creatina|frango|arroz|banana)\b/u.test(
        text,
      )
    ) {
      candidates.add(CONVERSATION_DOMAIN.NUTRITION);
    }
    if (
      /\b(treino|treinar|exercicio|academia|musculacao|corrida|bike|ciclismo|crossfit|calistenia)\b/u.test(
        text,
      )
    ) {
      candidates.add(CONVERSATION_DOMAIN.WORKOUT);
    }
    for (const entity of entityRecognition.entities) {
      if (
        entity.kind === 'NUTRITION_ARTIFACT' ||
        entity.kind === 'MEAL' ||
        entity.kind === 'FOOD' ||
        (entity.kind === 'PLAN_COMPONENT' && entity.domain === 'NUTRITION')
      ) {
        candidates.add(CONVERSATION_DOMAIN.NUTRITION);
      }
      if (
        entity.kind === 'WORKOUT_ARTIFACT' ||
        entity.kind === 'WORKOUT_MODALITY' ||
        entity.kind === 'EXERCISE' ||
        (entity.kind === 'PLAN_COMPONENT' && entity.domain === 'WORKOUT')
      ) {
        candidates.add(CONVERSATION_DOMAIN.WORKOUT);
      }
    }
    for (const reference of referenceResolution.references) {
      this.addReferenceDomain(candidates, reference);
    }

    const planDomains = [...candidates].filter(
      (domain) => domain === 'NUTRITION' || domain === 'WORKOUT',
    );
    if (planDomains.length === 2) {
      return Object.freeze({
        domain: CONVERSATION_DOMAIN.COMBINED,
        candidates: Object.freeze(planDomains),
        contextual:
          referenceResolution.usedContinuity ||
          referenceResolution.usedRecentHistory,
      });
    }
    if (planDomains.length === 1) {
      return Object.freeze({
        domain: planDomains[0],
        candidates: Object.freeze(planDomains),
        contextual:
          referenceResolution.usedContinuity ||
          referenceResolution.usedRecentHistory,
      });
    }
    if (input.continuity.activeProfileField !== null) {
      return Object.freeze({
        domain: CONVERSATION_DOMAIN.PROFILE,
        candidates: Object.freeze([CONVERSATION_DOMAIN.PROFILE]),
        contextual: true,
      });
    }
    return Object.freeze({
      domain: CONVERSATION_DOMAIN.GENERAL,
      candidates: Object.freeze([CONVERSATION_DOMAIN.GENERAL]),
      contextual: false,
    });
  }

  private addReferenceDomain(
    candidates: Set<ConversationDomain>,
    reference: ConversationReference,
  ): void {
    if (reference.kind !== 'PLAN' || reference.resolution !== 'RESOLVED')
      return;
    if (reference.domain === 'NUTRITION' || reference.domain === 'BOTH') {
      candidates.add(CONVERSATION_DOMAIN.NUTRITION);
    }
    if (reference.domain === 'WORKOUT' || reference.domain === 'BOTH') {
      candidates.add(CONVERSATION_DOMAIN.WORKOUT);
    }
  }
}
