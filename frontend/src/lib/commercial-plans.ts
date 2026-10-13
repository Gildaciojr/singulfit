export type CommercialPlanType = "BASIC" | "PREMIUM";

export type CommercialPlan = {
  type: CommercialPlanType;
  routeParam: "basic" | "premium";
  name: string;
  displayName: string;
  price: number;
  interval: string;
  imageLimit: number | null;
  entitlements: {
    nutritionPlansPerCycle: number | null;
    workoutPlansPerCycle: number | null;
    imageAnalysesPerCycle: number | null;
    audioTranscriptionsPerCycle: number | null;
  };
  description: string;
  features: string[];
};

export const COMMERCIAL_PLANS: Record<CommercialPlanType, CommercialPlan> = {
  BASIC: {
    type: "BASIC",
    routeParam: "basic",
    name: "Basic",
    displayName: "Plano Básico",
    price: 29.9,
    interval: "/mês",
    imageLimit: 30,
    entitlements: {
      nutritionPlansPerCycle: 2,
      workoutPlansPerCycle: 2,
      imageAnalysesPerCycle: 30,
      audioTranscriptionsPerCycle: 30,
    },
    description:
      "Ideal para quem deseja melhorar a alimentação e acompanhar sua evolução diária pelo WhatsApp.",
    features: [
      "Análise de refeições por foto, áudio e texto",
      "Acompanhamento nutricional",
      "Análise completa de macronutrientes",
      "Acompanhamento de peso e evolução",
      "Cadastro de receitas personalizadas",
      "Relatórios de evolução",
      "Registro de exercícios e atividades",
      "Suporte prioritário via WhatsApp",
      "2 planos alimentares por ciclo",
      "2 planos de treino por ciclo",
      "30 análises de refeições por foto por ciclo",
      "30 transcrições de áudio por ciclo (ativação gradual)",
    ],
  },
  PREMIUM: {
    type: "PREMIUM",
    routeParam: "premium",
    name: "Premium",
    displayName: "Plano Premium",
    price: 69.9,
    interval: "/mês",
    imageLimit: 150,
    entitlements: {
      nutritionPlansPerCycle: 6,
      workoutPlansPerCycle: 6,
      imageAnalysesPerCycle: 150,
      audioTranscriptionsPerCycle: 200,
    },
    description:
      "Experiência completa com inteligência avançada, memória nutricional e acompanhamento contínuo para acelerar seus resultados.",
    features: [
      "Acompanhamento pelo WhatsApp",
      "Memória nutricional avançada",
      "6 planos alimentares por ciclo",
      "6 planos de treino por ciclo",
      "150 análises de refeições por foto por ciclo",
      "200 transcrições de áudio por ciclo (ativação gradual)",
      "Análise de refeições por foto, áudio e texto",
      "Histórico Completo de Refeições",
      "Acompanhamento premium",
      "Análise de Macronutrientes",
      "Acompanhamento de Peso e Evolução",
      "Assistente SingulFit para dúvidas em tempo real",
      "Cadastro de receitas personalizadas",
      "Relatórios inteligentes de sua Evolução",
      "Registros e planos personalizads de Exercícios",
      "Suporte Prioritário via WhatsApp",
      "Relatório semanal de sua evolução",
      "Coach adaptado a voce para metas e objetivos",
      "Auxilio e Motivação completa para te incentivar",
      "Acompanhamento diário de sua evolução",
    ],
  },
};

export const COMMERCIAL_PLAN_LIST = [
  COMMERCIAL_PLANS.BASIC,
  COMMERCIAL_PLANS.PREMIUM,
] as const;

export function commercialPlanFromRouteParam(
  value: string | undefined,
): CommercialPlan {
  return value?.toLowerCase() === COMMERCIAL_PLANS.BASIC.routeParam
    ? COMMERCIAL_PLANS.BASIC
    : COMMERCIAL_PLANS.PREMIUM;
}

export function checkoutPath(plan: CommercialPlanType): string {
  return `/checkout/${COMMERCIAL_PLANS[plan].routeParam}`;
}

export function formatPlanPrice(price: number): string {
  return `R$ ${price.toFixed(2).replace(".", ",")}`;
}
