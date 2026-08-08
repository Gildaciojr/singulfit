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
        return this.common(payload);
    }
  }

  private common(
    payload: Extract<
      ConversationResponsePayload,
      { kind: 'CONTEXTUAL_RESPONSE' }
    >,
  ): ConversationRealizedResponse {
    const message = this.normalize(payload.currentMessage);

    if (
      this.matches(message, [
        'posso comer pizza',
        'pizza hoje',
        'posso comer hamburguer',
        'posso comer lanche',
        'posso comer doce',
      ])
    ) {
      return this.foodFlexibility(payload);
    }
    if (
      this.matches(message, [
        'dificil seguir',
        'nao consegui seguir',
        'sai da dieta',
        'furei a dieta',
      ])
    ) {
      return this.adherenceDifficulty(payload);
    }
    if (
      this.matches(message, [
        'desanimado',
        'desanimada',
        'sem motivacao',
        'desmotivado',
        'desmotivada',
      ])
    ) {
      return this.lowMotivation(payload);
    }
    if (
      this.matches(message, [
        'nao consegui treinar',
        'nao treinei',
        'sem treinar',
      ])
    ) {
      return this.missedTraining(payload);
    }
    if (
      this.matches(message, [
        'conseguindo manter',
        'consegui manter',
        'estou seguindo',
        'mantive a dieta',
      ])
    ) {
      return this.adherenceProgress(payload);
    }
    if (payload.routeKind === 'PROGRESS_REVIEW' && payload.progress) {
      return {
        message: `${this.address(payload)}${this.capitalize(payload.progress)}. Vamos usar esse sinal para escolher um próximo passo que caiba na sua rotina.`,
        requiresFollowUp: true,
        followUpQuestion:
          'O que foi mais fácil ou mais difícil desde o último registro?',
      };
    }

    return this.contextualFallback(payload);
  }

  private foodFlexibility(
    payload: Extract<
      ConversationResponsePayload,
      { kind: 'CONTEXTUAL_RESPONSE' }
    >,
  ): ConversationRealizedResponse {
    const restriction = payload.restrictions[0];
    const context = restriction
      ? ` Considere sua restrição a ${restriction} na escolha dos ingredientes.`
      : payload.goal
        ? ` Para continuar alinhado ao seu objetivo de ${payload.goal}, mantenha a porção que te deixa satisfeito e retome sua rotina na refeição seguinte.`
        : ' Escolha uma porção que te deixe satisfeito e retome sua rotina na refeição seguinte.';
    return {
      message: `${this.address(payload)}Pode comer sem transformar uma refeição em tudo ou nada.${context} Não precisa compensar depois.`,
      requiresFollowUp: false,
      followUpQuestion: null,
    };
  }

  private adherenceDifficulty(
    payload: Extract<
      ConversationResponsePayload,
      { kind: 'CONTEXTUAL_RESPONSE' }
    >,
  ): ConversationRealizedResponse {
    const food = payload.preferredFoods[0];
    const nextStep = food
      ? `Na próxima refeição, volte ao básico com uma opção que funciona para você, como ${food}.`
      : payload.currentDiet
        ? `Na próxima refeição, retome o plano "${payload.currentDiet}" sem tentar compensar o que passou.`
        : 'Na próxima refeição, escolha uma opção simples e possível, sem tentar compensar o que passou.';
    const progress = payload.progress
      ? ` ${this.capitalize(payload.progress)}.`
      : '';
    return {
      message: `${this.address(payload)}Um dia difícil não apaga o que você já construiu.${progress} ${nextStep}`,
      requiresFollowUp: true,
      followUpQuestion:
        'O que mais atrapalhou hoje: fome, horário, falta de opção ou cansaço?',
    };
  }

  private lowMotivation(
    payload: Extract<
      ConversationResponsePayload,
      { kind: 'CONTEXTUAL_RESPONSE' }
    >,
  ): ConversationRealizedResponse {
    const step = payload.currentWorkout
      ? `deixar separado o necessário para o próximo treino do plano "${payload.currentWorkout}"`
      : payload.currentDiet
        ? `organizar a próxima refeição do plano "${payload.currentDiet}"`
        : payload.trainingTime
          ? `proteger o horário de treino ${payload.trainingTime}`
          : 'escolher uma ação pequena que você consegue cumprir hoje';
    const direction = this.motivationDirection(payload.motivation);
    return {
      message: `${this.address(payload)}Não precisamos resolver a semana inteira agora. ${direction}: ${step}.`,
      requiresFollowUp: true,
      followUpQuestion: 'Esse passo parece viável hoje?',
    };
  }

  private missedTraining(
    payload: Extract<
      ConversationResponsePayload,
      { kind: 'CONTEXTUAL_RESPONSE' }
    >,
  ): ConversationRealizedResponse {
    const plan = payload.currentWorkout
      ? `Retome pelo próximo treino do plano "${payload.currentWorkout}", sem dobrar volume para compensar.`
      : payload.trainingModality
        ? `Recomece com uma sessão curta de ${payload.trainingModality}, sem tentar compensar os dias perdidos.`
        : 'Recomece com uma sessão curta e possível, sem tentar compensar os dias perdidos.';
    const timing = payload.trainingTime
      ? ` O horário ${payload.trainingTime} continua sendo uma boa referência.`
      : '';
    return {
      message: `${this.address(payload)}Uma semana fora da rotina pede retomada, não punição. ${plan}${timing}`,
      requiresFollowUp: true,
      followUpQuestion: 'Qual dia desta semana é realmente viável para voltar?',
    };
  }

  private adherenceProgress(
    payload: Extract<
      ConversationResponsePayload,
      { kind: 'CONTEXTUAL_RESPONSE' }
    >,
  ): ConversationRealizedResponse {
    const progress = payload.progress
      ? ` Isso combina com o que já aparece no seu acompanhamento: ${payload.progress}.`
      : '';
    const goal = payload.goal
      ? ` Essa consistência é o que sustenta seu objetivo de ${payload.goal}.`
      : '';
    return {
      message: `${this.address(payload)}Bom perceber que você está conseguindo manter a rotina.${progress}${goal} Continue repetindo o que tornou isso possível.`,
      requiresFollowUp: false,
      followUpQuestion: null,
    };
  }

  private contextualFallback(
    payload: Extract<
      ConversationResponsePayload,
      { kind: 'CONTEXTUAL_RESPONSE' }
    >,
  ): ConversationRealizedResponse {
    const focus = payload.progress
      ? `${this.capitalize(payload.progress)}. Podemos partir desse ponto.`
      : payload.goal
        ? `Podemos olhar isso sem perder de vista seu objetivo de ${payload.goal}.`
        : payload.currentDiet || payload.currentWorkout
          ? 'Podemos ajustar isso considerando o plano que você já tem.'
          : 'Me conta um pouco mais do que aconteceu para eu te orientar de forma útil.';
    return {
      message: `${this.address(payload)}${focus}`,
      requiresFollowUp: false,
      followUpQuestion: null,
    };
  }

  private motivationDirection(value: string | null): string {
    if (value && /autonom|independen/iu.test(value)) {
      return 'Escolha o menor compromisso que faça sentido para você';
    }
    if (value && /result|meta|desempenho|progres/iu.test(value)) {
      return 'Vamos transformar isso em uma ação concreta';
    }
    return 'Vamos reduzir o foco a um passo possível';
  }

  private address(
    payload: Extract<
      ConversationResponsePayload,
      { kind: 'CONTEXTUAL_RESPONSE' }
    >,
  ): string {
    return payload.preferredName ? `${payload.preferredName}, ` : '';
  }

  private matches(value: string, expressions: readonly string[]): boolean {
    return expressions.some((expression) => value.includes(expression));
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('pt-BR')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private capitalize(value: string): string {
    const normalized = value.trim();
    return normalized
      ? `${normalized.charAt(0).toLocaleUpperCase('pt-BR')}${normalized.slice(1)}`
      : normalized;
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
