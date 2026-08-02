import type { ProfileAcquisitionField } from '../../context/coach-adaptive-profile-collector.contract';
import type {
  ConversationReasoningBridgeInput,
  ConversationReasoningQuestionEvidence,
} from './conversation-reasoning-bridge.contract';

const QUESTIONS: Readonly<
  Partial<
    Record<ProfileAcquisitionField, ConversationReasoningQuestionEvidence>
  >
> = Object.freeze({
  PRIMARY_GOAL: {
    question: 'Qual resultado você quer priorizar agora?',
    purpose: 'alinhar a orientação ao objetivo principal',
  },
  ACTIVITY_LEVEL: {
    question: 'Como está seu nível de atividade na rotina atual?',
    purpose: 'adequar a orientação à demanda diária',
  },
  FOOD_RESTRICTIONS: {
    question: 'Existe algum alimento que você precisa evitar?',
    purpose: 'preservar restrições alimentares',
  },
  ALLERGIES: {
    question:
      'Você possui alguma alergia alimentar que precisa ser considerada?',
    purpose: 'preservar segurança alimentar',
  },
  MEDICAL_CONDITIONS: {
    question:
      'Existe alguma condição de saúde que seu acompanhamento precisa respeitar?',
    purpose: 'evitar uma orientação incompatível com o contexto informado',
  },
  FOOD_PREFERENCES: {
    question: 'Quais alimentos você costuma gostar mais no dia a dia?',
    purpose: 'aumentar aderência sem inventar preferências',
  },
  FOOD_INTOLERANCES: {
    question:
      'Existe alguma intolerância alimentar que precisa ser respeitada?',
    purpose: 'preservar tolerância e segurança',
  },
  MEAL_COUNT: {
    question: 'Quantas refeições costumam funcionar melhor no seu dia?',
    purpose: 'adequar a estrutura à rotina',
  },
  COOKING_AVAILABILITY: {
    question: 'Quanto tempo você costuma ter para preparar suas refeições?',
    purpose: 'definir o nível adequado de praticidade',
  },
  EATING_OUT_FREQUENCY: {
    question: 'Com que frequência você costuma comer fora de casa?',
    purpose: 'adequar as escolhas ao contexto real',
  },
  FOOD_BUDGET: {
    question:
      'Qual faixa de orçamento precisa ser respeitada nas escolhas alimentares?',
    purpose: 'evitar sugestões financeiramente inviáveis',
  },
  HYDRATION: {
    question: 'Como costuma ser sua hidratação ao longo do dia?',
    purpose: 'avaliar se a base hídrica precisa de atenção',
  },
  TRAINING_EXPERIENCE: {
    question: 'Há quanto tempo você treina com regularidade?',
    purpose: 'adequar complexidade e progressão',
  },
  TRAINING_MODALITY: {
    question: 'Qual modalidade você quer priorizar neste plano?',
    purpose: 'evitar assumir um tipo de treino',
  },
  TRAINING_FREQUENCY: {
    question:
      'Quantos dias por semana você consegue treinar de forma realista?',
    purpose: 'definir uma frequência sustentável',
  },
  SESSION_DURATION: {
    question: 'Quanto tempo você costuma ter para cada treino?',
    purpose: 'adequar o volume ao tempo disponível',
  },
  TRAINING_ENVIRONMENT: {
    question: 'Onde você pretende realizar os treinos?',
    purpose: 'adequar os exercícios ao ambiente',
  },
  TRAINING_EQUIPMENT: {
    question: 'Quais equipamentos estarão disponíveis para você?',
    purpose: 'evitar exercícios inviáveis',
  },
  PHYSICAL_LIMITATIONS: {
    question:
      'Existe algum movimento ou limitação física que precisa ser respeitado?',
    purpose: 'preservar segurança no treino',
  },
  RETURNING_AFTER_BREAK: {
    question: 'Você está retomando depois de um período sem treinar?',
    purpose: 'adequar a progressão da retomada',
  },
  TRAINING_TIME: {
    question: 'Em qual horário você costuma treinar?',
    purpose: 'alinhar alimentação, energia e recuperação ao treino',
  },
  MEAL_TIMES: {
    question: 'Quais horários de refeição já funcionam na sua rotina?',
    purpose: 'evitar criar uma estrutura desconectada do dia real',
  },
});

export class ConversationReasoningQuestionBuilder {
  build(
    input: ConversationReasoningBridgeInput,
  ): readonly ConversationReasoningQuestionEvidence[] {
    const field = input.planner?.selectedProfileField;
    const selected = field ? QUESTIONS[field] : undefined;
    if (selected) return Object.freeze([Object.freeze(selected)]);
    if (input.longitudinal?.needs.information) {
      return Object.freeze([
        Object.freeze({
          question: 'O que mudou desde o último plano?',
          purpose: 'completar o contexto antes de recomendar uma adaptação',
        }),
      ]);
    }
    return Object.freeze([]);
  }
}
