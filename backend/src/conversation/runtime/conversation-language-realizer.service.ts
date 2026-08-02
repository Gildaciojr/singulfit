import { Injectable } from '@nestjs/common';
import type {
  ConversationRealizedResponse,
  ConversationResponsePayload,
} from './conversation-response-payload.builder';

@Injectable()
export class ConversationLanguageRealizerService {
  realize(payload: ConversationResponsePayload): ConversationRealizedResponse {
    switch (payload.kind) {
      case 'CONTEXTUAL_RESPONSE':
        return Object.freeze({
          ...this.contextual(payload),
        });
      case 'CONFIRMATION_REQUEST':
        return Object.freeze({
          message: payload.preferredName
            ? `${payload.preferredName}, preciso confirmar um detalhe antes de continuar.`
            : 'Preciso confirmar um detalhe antes de continuar.',
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

  private contextual(
    payload: Extract<
      ConversationResponsePayload,
      { kind: 'CONTEXTUAL_RESPONSE' }
    >,
  ): ConversationRealizedResponse {
    const name = payload.preferredName ? `, ${payload.preferredName}` : '';
    switch (payload.cue) {
      case 'GREETING':
        return {
          message: `Oi${name}! Que bom falar com você.`,
          requiresFollowUp: true,
          followUpQuestion: payload.goal
            ? `Como você quer avançar hoje no seu objetivo de ${payload.goal}: alimentação ou treino?`
            : 'Como posso ajudar hoje: alimentação, treino ou os dois?',
        };
      case 'THANKS':
        return {
          message: 'Por nada! Fico feliz em ajudar.',
          requiresFollowUp: false,
          followUpQuestion: null,
        };
      case 'AFFIRMATION':
        return {
          message: payload.trainingTime
            ? `Perfeito. Vou continuar considerando que seu treino costuma acontecer ${payload.trainingTime}.`
            : 'Perfeito. Vou seguir por esse caminho.',
          requiresFollowUp: false,
          followUpQuestion: null,
        };
      case 'NEGATION':
        return {
          message: 'Tudo bem. Não vou seguir por esse caminho.',
          requiresFollowUp: true,
          followUpQuestion: 'O que você prefere ajustar agora?',
        };
      case 'FAREWELL':
        return {
          message: 'Até mais! Quando quiser retomar, continuamos daqui.',
          requiresFollowUp: false,
          followUpQuestion: null,
        };
      case 'HELP_REQUEST':
        return {
          message: payload.goal
            ? `Posso ajudar a organizar sua alimentação e seu treino em torno do objetivo de ${payload.goal}.`
            : 'Posso ajudar com alimentação, treino, ajustes de rotina e acompanhamento do seu progresso.',
          requiresFollowUp: true,
          followUpQuestion: 'Por onde você quer começar?',
        };
      case 'CONTINUITY':
        return payload.continuity
          ? {
              message: `Continuando de onde paramos${name}: você comentou “${this.excerpt(payload.continuity)}”.`,
              requiresFollowUp: true,
              followUpQuestion: 'O que mudou desde então?',
            }
          : {
              message: `Claro${name}. Podemos continuar daqui.`,
              requiresFollowUp: true,
              followUpQuestion: this.currentPlanQuestion(payload),
            };
      case 'COMMON':
        return {
          message:
            payload.goal || payload.currentDiet || payload.currentWorkout
              ? `Entendi${name}. Vou considerar o contexto que já temos para não começar do zero.`
              : 'Entendi. Pode contar comigo para seguir com você por aqui.',
          requiresFollowUp: false,
          followUpQuestion: null,
        };
    }
  }

  private currentPlanQuestion(
    payload: Extract<
      ConversationResponsePayload,
      { kind: 'CONTEXTUAL_RESPONSE' }
    >,
  ): string {
    if (payload.currentDiet && payload.currentWorkout) {
      return 'Você quer retomar o plano alimentar ou o treino?';
    }
    if (payload.currentDiet) return 'Você quer retomar o plano alimentar?';
    if (payload.currentWorkout) return 'Você quer retomar o treino?';
    return 'Você quer continuar pela alimentação ou pelo treino?';
  }

  private excerpt(value: string): string {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    return normalized.length <= 140
      ? normalized
      : `${normalized.slice(0, 137).trimEnd()}...`;
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
