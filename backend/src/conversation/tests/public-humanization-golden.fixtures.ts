import type { CoachProactiveIntent } from '../../automation/coach-proactive.contract';
import type { CoachProactiveWorkoutOutcome } from '@prisma/client';

export interface PublicHumanizationGolden {
  readonly scenario: string;
  readonly domain:
    | 'MEAL'
    | 'WORKOUT'
    | 'HYDRATION'
    | 'QA'
    | 'MUTATION'
    | 'PROFILE'
    | 'VISION'
    | 'AUTHORIZATION'
    | 'PROGRESS'
    | 'FAILURE';
  readonly intent?: CoachProactiveIntent;
  readonly outcome:
    | CoachProactiveWorkoutOutcome
    | 'WATER_CONSUMED'
    | 'GOAL_COMPLETED'
    | 'ANSWER'
    | 'CONFIRMED'
    | 'BLOCKED'
    | 'MISSING'
    | 'ESTIMATED'
    | 'NO_DATA';
  readonly text: string;
  readonly requiredConcepts: readonly RegExp[];
  readonly forbiddenConcepts: readonly RegExp[];
  readonly sideEffectConfirmed: boolean;
  readonly safetyExpectations?: readonly RegExp[];
}

const completedMeal =
  /(?:almoço|jantar|refeição) (?:feito|realizad[oa]|conclu[ií]d[oa])|você (?:almoçou|jantou|comeu)/iu;
const pendingMeal =
  /pendente|quando conseguir (?:comer|parar)|priorize seu (?:almoço|jantar)/iu;
const completeAdherence =
  /seguiu tudo|aderência completa|seguiu (?:todo|perfeitamente)|cumpriu (?:todo|perfeitamente)/iu;
const observedMacros =
  /\d+(?:[.,]\d+)?\s*(?:kcal|calorias|g\b)|consumiu .*\b(?:proteína|carboidrato|gordura)/iu;
const compensation =
  /\bcompense\b|(?:precisa|deve|vamos|para) compensar|pule a próxima/iu;
const completedWorkout =
  /treino (?:concluído|feito|realizado)|treinou tudo|sessão concluída/iu;
const unknownClaims =
  /(?:almoço|jantar|refeição|treino) (?:feito|conclu[ií]d[oa]|pulad[oa]|pendente)|você (?:comeu|treinou)|vai (?:comer|treinar) depois/iu;

export const PUBLIC_HUMANIZATION_GOLDEN: readonly PublicHumanizationGolden[] = [
  {
    scenario: 'pergunta simples',
    domain: 'QA',
    outcome: 'ANSWER',
    text: 'Seu objetivo é melhorar o condicionamento.',
    requiredConcepts: [/objetivo/iu, /condicionamento/iu],
    forbiddenConcepts: [/emagrecimento/iu],
    sideEffectConfirmed: false,
  },
  {
    scenario: 'orientação personalizada',
    domain: 'QA',
    outcome: 'ANSWER',
    text: 'Para sua meta de corrida, priorize constância e aumente a distância aos poucos, respeitando o descanso.',
    requiredConcepts: [/corrida/iu, /aos poucos/iu, /descanso/iu],
    forbiddenConcepts: [/sem descanso|dobrar.*distância/iu],
    sideEffectConfirmed: false,
  },
  {
    scenario: 'treino cumprido',
    domain: 'WORKOUT',
    intent: 'WORKOUT_CHECK',
    outcome: 'COMPLETED',
    text: 'Boa! Treino concluído e registrado. Como ficou sua energia depois da sessão?',
    requiredConcepts: [completedWorkout],
    forbiddenConcepts: [/treino pendente|não treinou|só uma parte/iu],
    sideEffectConfirmed: true,
  },
  {
    scenario: 'treino parcial',
    domain: 'WORKOUT',
    intent: 'WORKOUT_CHECK',
    outcome: 'PARTIAL',
    text: 'Tudo bem ter feito só uma parte. O que mais limitou sua sessão hoje?',
    requiredConcepts: [/só uma parte|parcial/iu],
    forbiddenConcepts: [completedWorkout, /não treinou/iu],
    sideEffectConfirmed: true,
  },
  {
    scenario: 'treino pulado',
    domain: 'WORKOUT',
    intent: 'WORKOUT_CHECK',
    outcome: 'SKIPPED',
    text: 'Sem culpa. Quer ajustar horário, duração ou algum detalhe da rotina para o próximo treino?',
    requiredConcepts: [/não treinou|próximo treino/iu],
    forbiddenConcepts: [completedWorkout, /fez só uma parte/iu],
    sideEffectConfirmed: true,
  },
  {
    scenario: 'treino adiado',
    domain: 'WORKOUT',
    intent: 'WORKOUT_CHECK',
    outcome: 'DEFERRED',
    text: 'Combinado. Quando terminar mais tarde, me conte como foi.',
    requiredConcepts: [/mais tarde|depois/iu],
    forbiddenConcepts: [completedWorkout, /pulado definitivamente/iu],
    sideEffectConfirmed: true,
  },
  {
    scenario: 'dor ou limitação',
    domain: 'WORKOUT',
    intent: 'WORKOUT_CHECK',
    outcome: 'ISSUE_REPORTED',
    text: 'Entendi. Evite movimentos que aumentem o desconforto. Em qual exercício isso aconteceu? Se a dor for forte ou persistente, procure avaliação profissional.',
    requiredConcepts: [/desconforto|dor/iu],
    forbiddenConcepts: [
      /continue.*(?:dor|treinando)|diagnóstico|fratura confirmada/iu,
    ],
    safetyExpectations: [/evite movimentos/iu, /avaliação profissional/iu],
    sideEffectConfirmed: true,
  },
  {
    scenario: 'treino desconhecido',
    domain: 'WORKOUT',
    intent: 'WORKOUT_CHECK',
    outcome: 'UNKNOWN',
    text: 'Como ficou o que combinamos? Me conte para eu registrar corretamente.',
    requiredConcepts: [/\?/u, /conte|como/iu],
    forbiddenConcepts: [unknownClaims],
    sideEffectConfirmed: false,
  },
  {
    scenario: 'refeição cumprida',
    domain: 'MEAL',
    intent: 'LUNCH_CHECK',
    outcome: 'COMPLETED',
    text: 'Boa, almoço feito! Siga o restante do dia normalmente.',
    requiredConcepts: [completedMeal],
    forbiddenConcepts: [pendingMeal, /não fez|pulad[oa]/iu],
    sideEffectConfirmed: true,
  },
  {
    scenario: 'refeição diferente',
    domain: 'MEAL',
    intent: 'LUNCH_CHECK',
    outcome: 'PARTIAL',
    text: 'Entendi, seu almoço foi diferente do planejado. Na próxima refeição, retome seu plano normalmente, sem tentar compensar.',
    requiredConcepts: [
      /(?:almoço|jantar|alimentação).*diferente|comeu/iu,
      /diferente|parcial/iu,
      /próxima refeição|retome/iu,
    ],
    forbiddenConcepts: [
      pendingMeal,
      completedMeal,
      completeAdherence,
      observedMacros,
      compensation,
    ],
    sideEffectConfirmed: true,
  },
  {
    scenario: 'jantar diferente',
    domain: 'MEAL',
    intent: 'DINNER_CHECK',
    outcome: 'PARTIAL',
    text: 'Entendi, seu jantar foi diferente do planejado. Na próxima refeição, retome seu plano normalmente, sem tentar compensar.',
    requiredConcepts: [/jantar.*diferente/iu, /próxima refeição/iu],
    forbiddenConcepts: [
      pendingMeal,
      completedMeal,
      completeAdherence,
      observedMacros,
      compensation,
    ],
    sideEffectConfirmed: true,
  },
  {
    scenario: 'plano alimentar parcial',
    domain: 'MEAL',
    intent: 'MEAL_PLAN_CHECK',
    outcome: 'PARTIAL',
    text: 'Entendi, sua alimentação foi diferente do planejado. Retome seu plano na próxima refeição, sem tentar compensar.',
    requiredConcepts: [/alimentação.*diferente/iu, /próxima refeição/iu],
    forbiddenConcepts: [
      pendingMeal,
      completedMeal,
      completeAdherence,
      observedMacros,
      compensation,
    ],
    sideEffectConfirmed: true,
  },
  {
    scenario: 'refeição pulada',
    domain: 'MEAL',
    intent: 'LUNCH_CHECK',
    outcome: 'SKIPPED',
    text: 'Entendi, você não fez o almoço. Siga normalmente na próxima refeição planejada, sem tentar compensar.',
    requiredConcepts: [/não fez|não comeu|pulou/iu],
    forbiddenConcepts: [completedMeal, compensation],
    sideEffectConfirmed: true,
  },
  {
    scenario: 'refeição adiada',
    domain: 'MEAL',
    intent: 'LUNCH_CHECK',
    outcome: 'DEFERRED',
    text: 'Combinado, você vai fazer o almoço depois. Quando puder, siga a refeição planejada sem tentar compensar o atraso.',
    requiredConcepts: [/depois|mais tarde/iu],
    forbiddenConcepts: [completedMeal, /pulad[oa] definitivamente/iu],
    sideEffectConfirmed: true,
  },
  {
    scenario: 'refeição desconhecida',
    domain: 'MEAL',
    intent: 'LUNCH_CHECK',
    outcome: 'UNKNOWN',
    text: 'Como ficou o que combinamos? Me conte para eu registrar corretamente.',
    requiredConcepts: [/\?/u],
    forbiddenConcepts: [unknownClaims],
    sideEffectConfirmed: false,
  },
  {
    scenario: 'hidratação parcial',
    domain: 'HYDRATION',
    intent: 'HYDRATION_CHECK',
    outcome: 'PARTIAL',
    text: 'Entendi! Vale deixar a garrafa por perto e seguir com pequenos goles ao longo do dia, sem tentar compensar tudo de uma vez.',
    requiredConcepts: [/pequenos goles/iu],
    forbiddenConcepts: [/meta.*(?:concluída|cumprida)|todo.*objetivo/iu],
    sideEffectConfirmed: true,
  },
  {
    scenario: 'água consumida',
    domain: 'HYDRATION',
    intent: 'HYDRATION_CHECK',
    outcome: 'WATER_CONSUMED',
    text: 'Boa! Continue mantendo a hidratação distribuída ao longo do dia.',
    requiredConcepts: [/hidratação/iu, /ao longo do dia/iu],
    forbiddenConcepts: [/meta.*(?:concluída|cumprida)|objetivo.*concluído/iu],
    sideEffectConfirmed: true,
  },
  {
    scenario: 'meta de água cumprida',
    domain: 'HYDRATION',
    intent: 'HYDRATION_CHECK',
    outcome: 'GOAL_COMPLETED',
    text: 'Boa! Meta de hidratação concluída. Continue mantendo a hidratação distribuída ao longo do dia.',
    requiredConcepts: [/meta.*concluída/iu],
    forbiddenConcepts: [/meta pendente/iu],
    sideEffectConfirmed: true,
  },
  {
    scenario: 'mutation concluída',
    domain: 'MUTATION',
    outcome: 'CONFIRMED',
    text: 'Seu treino foi atualizado. Mantive o restante do plano.',
    requiredConcepts: [/treino.*atualizado/iu, /mantive.*restante/iu],
    forbiddenConcepts: [/não consegui|troquei todo/iu],
    sideEffectConfirmed: true,
  },
  {
    scenario: 'mutation bloqueada',
    domain: 'MUTATION',
    outcome: 'BLOCKED',
    text: 'Não consegui confirmar essa mudança com segurança. Seu plano continua como estava.',
    requiredConcepts: [/não consegui/iu, /continua como estava/iu],
    forbiddenConcepts: [/troquei|atualizei|foi atualizado/iu],
    sideEffectConfirmed: false,
  },
  {
    scenario: 'campo de perfil faltante',
    domain: 'PROFILE',
    outcome: 'MISSING',
    text: 'Onde você pretende treinar?',
    requiredConcepts: [/onde.*treinar\?/iu],
    forbiddenConcepts: [/salvei|preferência confirmada/iu],
    sideEffectConfirmed: false,
  },
  {
    scenario: 'pergunta ambígua',
    domain: 'QA',
    outcome: 'UNKNOWN',
    text: 'Qual exercício você quer trocar?',
    requiredConcepts: [/qual.*exercício.*\?/iu],
    forbiddenConcepts: [/troquei|escolhi/iu],
    sideEffectConfirmed: false,
  },
  {
    scenario: 'subscription sem acesso',
    domain: 'AUTHORIZATION',
    outcome: 'BLOCKED',
    text: 'Sua assinatura não está com acesso ativo. Confira o status do pagamento para continuar.',
    requiredConcepts: [/não.*acesso ativo/iu, /pagamento/iu],
    forbiddenConcepts: [/acesso liberado|plano gerado/iu],
    sideEffectConfirmed: false,
  },
  {
    scenario: 'imagem analisada',
    domain: 'VISION',
    outcome: 'ESTIMATED',
    text: 'Na foto identifiquei arroz, feijão e frango. As quantidades e os valores nutricionais são estimativas da imagem.',
    requiredConcepts: [/foto/iu, /estimativas/iu],
    forbiddenConcepts: [/valores exatos|medição precisa/iu],
    sideEffectConfirmed: true,
  },
  {
    scenario: 'erro temporário',
    domain: 'FAILURE',
    outcome: 'BLOCKED',
    text: 'Não consegui consultar essas informações com segurança agora. Tente novamente em instantes.',
    requiredConcepts: [/não consegui/iu, /tente novamente/iu],
    forbiddenConcepts: [/foi concluído|registrado|salvei/iu],
    sideEffectConfirmed: false,
  },
  {
    scenario: 'progresso sem dados',
    domain: 'PROGRESS',
    outcome: 'NO_DATA',
    text: 'Ainda não tenho registros suficientes para avaliar sua evolução nesta semana.',
    requiredConcepts: [/não tenho.*registros suficientes/iu],
    forbiddenConcepts: [/perdeu.*\d|ganhou.*\d|evoluiu \d/iu],
    sideEffectConfirmed: false,
  },
];
