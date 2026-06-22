export type CommercialPlanType = "BASIC" | "PREMIUM";

export type CommercialPlan = {
  type: CommercialPlanType;
  routeParam: "basic" | "premium";
  name: string;
  displayName: string;
  price: number;
  interval: string;
  imageLimit: number;
  entitlements: {
    imageAnalysisDaily: number;
    imageAnalysisMonthly: number;
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
    price: 19.9,
    interval: "/mês",
    imageLimit: 5,
    entitlements: {
      imageAnalysisDaily: 5,
      imageAnalysisMonthly: 100,
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
      "5 análises de imagem por dia",
      "100 análises de imagem por mês",
    ],
  },
  PREMIUM: {
    type: "PREMIUM",
    routeParam: "premium",
    name: "Premium",
    displayName: "Plano Premium",
    price: 49.9,
    interval: "/mês",
    imageLimit: 999999,
    entitlements: {
      imageAnalysisDaily: 50,
      imageAnalysisMonthly: 1500,
    },
    description:
      "Experiência completa com inteligência avançada, memória nutricional e acompanhamento contínuo para acelerar seus resultados.",
    features: [
      "Acesso ilimitado à SingulFit",
      "Memória nutricional avançada",
      "+1.500 análises de imagem por mês",
      "Análise de refeições por foto, áudio e texto",
      "Histórico Completo de Refeições",
      "Acompanhamento premium",
      "Análise de Macronutrientes",
      "Acompanhamento de Peso e Evolução",
      "Assistente SingulFit para dúvidas em tempo real",
      "Cadastro ilimitado de Receitas Personalizadas",
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
