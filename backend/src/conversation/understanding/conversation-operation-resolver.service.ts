import { Injectable } from '@nestjs/common';
import type { ConversationUnderstandingInput } from '../contracts/conversation-understanding.contract';
import { CONVERSATION_OPERATION } from '../contracts/conversation-intent.contract';
import type {
  ConversationOperationResolution,
  NormalizedConversationMessage,
} from '../contracts/conversation-understanding-pipeline.contract';
import type { ConversationOperation } from '../contracts/conversation-intent.contract';

@Injectable()
export class ConversationOperationResolverService {
  resolve(
    input: ConversationUnderstandingInput,
    message: NormalizedConversationMessage,
  ): ConversationOperationResolution {
    const text = message.folded;
    const candidates: ConversationOperation[] = [];
    const add = (operation: ConversationOperation): void => {
      if (!candidates.includes(operation)) candidates.push(operation);
    };

    if (/\b(status|andamento|situacao)\b/u.test(text)) {
      add(CONVERSATION_OPERATION.PRESENT_PLAN_STATUS);
    }
    if (
      /\b(plano atual|dieta atual|treino atual|mostr\w*|ver meu|qual e meu)\b/u.test(
        text,
      )
    ) {
      add(CONVERSATION_OPERATION.PRESENT_CURRENT_PLAN);
    }
    if (/\b(tro(?:c|qu)\w*|substitu\w*)\b/u.test(text)) {
      add(
        /\b(alimento|comida|refeicao|exercicio|whey|frango|arroz|banana|creatina)\b/u.test(
          text,
        )
          ? CONVERSATION_OPERATION.SUBSTITUTE_ITEM
          : CONVERSATION_OPERATION.UPDATE_PLAN,
      );
    }
    if (
      /\b(atualiz\w*|ajust\w*|alter\w*|mud\w*|melhor\w*|faz outro|faca outro|quero diferente)\b/u.test(
        text,
      )
    ) {
      add(CONVERSATION_OPERATION.UPDATE_PLAN);
    }
    if (/\b(revis\w*|progresso|evolucao|comparar|compare)\b/u.test(text)) {
      add(CONVERSATION_OPERATION.REVIEW_PROGRESS);
    }
    if (
      /\b(ger\w*|cri\w*|mont\w*|elabor\w*|quero|preciso|faca|faz)\b/u.test(
        text,
      ) &&
      !candidates.includes(CONVERSATION_OPERATION.UPDATE_PLAN) &&
      !candidates.includes(CONVERSATION_OPERATION.SUBSTITUTE_ITEM) &&
      /\b(plano|dieta|treino|cardapio|alimentacao)\b/u.test(text)
    ) {
      add(CONVERSATION_OPERATION.GENERATE_PLAN);
    }
    if (
      candidates.length === 0 &&
      (message.question ||
        /\b(expli\w*|porque|por que|como funciona|orient\w*|duvida|o que)\b/u.test(
          text,
        ))
    ) {
      add(CONVERSATION_OPERATION.PROVIDE_GUIDANCE);
    }
    if (
      /^(sim|nao|claro|confirmo|pode|continue|continua|isso mesmo|cancela|cancelar|pare)\b/u.test(
        text,
      ) &&
      input.continuity.pendingConfirmation
    ) {
      add(CONVERSATION_OPERATION.REQUEST_CONFIRMATION);
    }
    if (candidates.length === 0 && message.hasLexicalContent) {
      add(CONVERSATION_OPERATION.ANSWER);
    }

    return Object.freeze({
      operation: candidates[0] ?? CONVERSATION_OPERATION.NONE,
      candidates: Object.freeze(candidates),
      explicit:
        candidates.length > 0 &&
        !(
          candidates.length === 1 &&
          candidates[0] === CONVERSATION_OPERATION.ANSWER
        ),
    });
  }
}
