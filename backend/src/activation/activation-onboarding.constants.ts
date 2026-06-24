export const ACTIVATION_ONBOARDING_VERSION = 'v1';

export const ACTIVATION_ONBOARDING_SOURCE_KEY = `coach_onboarding:${ACTIVATION_ONBOARDING_VERSION}:state`;

export const ACTIVATION_ONBOARDING_PROFILE_SOURCE_KEY = `coach_onboarding:${ACTIVATION_ONBOARDING_VERSION}:profile`;

export const ACTIVATION_ONBOARDING_SOURCE = 'ACTIVATION_ONBOARDING';

export const ACTIVATION_ONBOARDING_STATE = {
  WELCOME: 'WELCOME',
  WAITING_START_CONFIRMATION: 'WAITING_START_CONFIRMATION',
  ASK_AGE: 'ASK_AGE',
  ASK_HEIGHT: 'ASK_HEIGHT',
  ASK_WEIGHT: 'ASK_WEIGHT',
  ASK_GENDER: 'ASK_GENDER',
  ASK_GOAL: 'ASK_GOAL',
  ASK_ACTIVITY_LEVEL: 'ASK_ACTIVITY_LEVEL',
  ASK_RESTRICTIONS: 'ASK_RESTRICTIONS',
  ASK_DESIRED_RESULT: 'ASK_DESIRED_RESULT',
  PROFILE_COMPLETED: 'PROFILE_COMPLETED',
} as const;

export const ACTIVATION_ONBOARDING_STATUS = {
  NOT_STARTED: 'NOT_STARTED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
} as const;

export const ACTIVATION_ONBOARDING_START_MODE = {
  POSITIVE_CONFIRMATION: 'POSITIVE_CONFIRMATION',
  DIRECT_FIRST_ANSWER: 'DIRECT_FIRST_ANSWER',
  CONTEXTUAL_REPLY: 'CONTEXTUAL_REPLY',
  RESUME: 'RESUME',
} as const;

export const ACTIVATION_ONBOARDING_MEMORY_SUMMARY =
  'Estado conversacional do onboarding premium SingulFit';

export const ACTIVATION_ONBOARDING_RELEVANCE_SCORE = '1.0000';

export const ACTIVATION_ONBOARDING_POSITIVE_REPLIES = [
  'sim',
  'vamos',
  'vamos la',
  'ok',
  'claro',
  'bora',
  'quero',
  'pode ser',
  'iniciar',
  'comecar',
  '👍',
  '👊',
] as const;

export const ACTIVATION_ONBOARDING_TARGET_SOURCE = {
  EXTRACTED_FROM_USER_TEXT: 'EXTRACTED_FROM_USER_TEXT',
  ESTIMATED_FROM_GOAL: 'ESTIMATED_FROM_GOAL',
} as const;

export const ACTIVATION_ONBOARDING_RESTRICTION_TYPE = 'ONBOARDING';

export const ACTIVATION_ONBOARDING_CONTEXT_REFRESH_AGGREGATE =
  'ONBOARDING_PROFILE';

export const ACTIVATION_ONBOARDING_GOAL_KEYWORDS = {
  WEIGHT_LOSS: [
    'quero emagrecer',
    'preciso emagrecer',
    'emagrecimento',
    'emagrecer',
    'perder peso',
    'perda de peso',
    'perder gordura',
    'perder barriga',
    'secar',
    'acima do peso',
    'reduzir medidas',
    'reduzir medida',
    'diminuir medidas',
    'diminuir medida',
  ],
  MUSCLE_GAIN: [
    'ganhar massa',
    'ganho de massa',
    'massa muscular',
    'hipertrofia',
    'crescer',
    'ganhar musculos',
    'ganhar musculo',
    'aumentar massa muscular',
    'aumentar massa',
  ],
  BODY_DEFINITION: [
    'definicao',
    'definir',
    'ficar definido',
    'ficar definida',
    'secar e definir',
    'melhorar estetica corporal',
    'estetica corporal',
  ],
  HEALTH: [
    'melhorar saude',
    'saude',
    'mais disposicao',
    'viver melhor',
    'qualidade de vida',
    'melhorar alimentacao',
    'alimentacao melhor',
  ],
  SPORTS_PERFORMANCE: [
    'correr melhor',
    'melhorar performance',
    'performance',
    'melhorar condicionamento',
    'condicionamento',
    'melhorar rendimento',
    'rendimento',
    'performance esportiva',
    'esportivo',
  ],
} as const;

export const ACTIVATION_ONBOARDING_ACTIVITY_KEYWORDS = {
  SEDENTARY: [
    'nao treino',
    'nao faco exercicio',
    'nao faco exercicios',
    'sedentario',
    'sedentaria',
    'quase nao faco exercicios',
    'quase nao faco exercicio',
    'quase nao treino',
    'parado',
    'parada',
  ],
  LIGHT: [
    'leve',
    'treino as vezes',
    'treino de vez em quando',
    'as vezes',
    '1 vez por semana',
    '2 vezes por semana',
    'uma vez por semana',
    'duas vezes por semana',
  ],
  MODERATE: [
    'moderado',
    'moderada',
    'treino 3 vezes por semana',
    'treino tres vezes por semana',
    'treino 4 vezes por semana',
    'treino quatro vezes por semana',
    'regularmente',
  ],
  HIGH: [
    'intenso',
    'intensa',
    'alta',
    'alto',
    'treino todos os dias',
    'treino todo dia',
    '5 vezes por semana',
    '6 vezes por semana',
    'cinco vezes por semana',
    'seis vezes por semana',
  ],
  ATHLETE: [
    'sou atleta',
    'atleta',
    'competidor',
    'competidora',
    'performance esportiva',
  ],
} as const;
