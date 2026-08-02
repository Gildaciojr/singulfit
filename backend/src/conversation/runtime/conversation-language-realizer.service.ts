import { Injectable } from '@nestjs/common';
import type {
  ConversationRealizedResponse,
  ConversationResponsePayload,
} from './conversation-response-payload.builder';

@Injectable()
export class ConversationLanguageRealizerService {
  realize(payload: ConversationResponsePayload): ConversationRealizedResponse {
    switch (payload.kind) {
      case 'GENERIC_ACKNOWLEDGEMENT':
        return Object.freeze({
          message: 'Entendi. Pode contar comigo para seguir com você por aqui.',
          requiresFollowUp: false,
          followUpQuestion: null,
        });
      case 'CONFIRMATION_REQUEST':
        return Object.freeze({
          message: 'Preciso confirmar um detalhe antes de continuar.',
          requiresFollowUp: true,
          followUpQuestion: this.confirmation(payload.targetPlan),
        });
      case 'SAFETY_GUIDANCE':
        return Object.freeze({
          message: this.safety(payload.action),
          requiresFollowUp: false,
          followUpQuestion: null,
        });
    }
  }

  private confirmation(target: 'DIET' | 'WORKOUT' | 'BOTH' | null): string {
    if (target === 'DIET') {
      return 'Você está falando do seu plano alimentar?';
    }
    if (target === 'WORKOUT') {
      return 'Você está falando do seu treino?';
    }
    if (target === 'BOTH') {
      return 'Você quer tratar do plano alimentar e do treino?';
    }
    return 'Você está falando de alimentação, treino ou dos dois?';
  }

  private safety(
    action: 'CAUTION_GUIDANCE' | 'PROFESSIONAL_GUIDANCE' | 'URGENT_GUIDANCE',
  ): string {
    if (action === 'URGENT_GUIDANCE') {
      return 'Esse relato pode exigir atendimento imediato. Interrompa a atividade e procure um serviço de urgência agora.';
    }
    if (action === 'PROFESSIONAL_GUIDANCE') {
      return 'Por segurança, não vou orientar uma mudança de plano neste caso. Procure avaliação de um profissional de saúde antes de continuar.';
    }
    return 'Por segurança, reduza ou interrompa a atividade e observe os sintomas. Se persistirem ou piorarem, procure um profissional de saúde.';
  }
}
