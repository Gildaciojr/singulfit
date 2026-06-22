import { LandingData } from "@/engine/landing.types";
import { checkoutPath, COMMERCIAL_PLANS } from "@/lib/commercial-plans";
import singulfitLogo from "@/assets/images/singulfit-logo.png";

import { Shield } from "lucide-react";

const iconMap = { Shield };

export const landingData: LandingData = {
  hero: {
    badge: "IA que entende você. Resultados que transformam.",
    title: "Nutrição inteligente no WhatsApp. Você quem evolui.",
    subtitle:
      "Análise da sua alimentação, contexto que evolui com você e acompanhamento contínuo para alcançar seus objetivos com clareza e consistência.",
    cta: {
      label: "Começar agora no WhatsApp",
      link: checkoutPath("PREMIUM"),
    },
    metrics: [
      {
        value: "8.500+",
        label: "pessoas já evoluíram",
      },
      {
        value: "87%",
        label: "aderência média",
      },
      {
        value: "24h",
        label: "acompanhamento contínuo",
      },
    ],
  },

  features: [],

  pricing: {
    monthly: {
      name: "Plano Básico",
      price: COMMERCIAL_PLANS.BASIC.price,
      interval: "/mês",
      description: COMMERCIAL_PLANS.BASIC.description,
      features: [
        ...COMMERCIAL_PLANS.BASIC.features.map((name) => ({
          name,
          included: true,
        })),
      ],
      cta: {
        text: "Começar agora",
        href: checkoutPath("BASIC"),
      },
    },

    annual: {
      name: "Plano Premium",
      price: COMMERCIAL_PLANS.PREMIUM.price,
      interval: "/mês",
      description: COMMERCIAL_PLANS.PREMIUM.description,
      features: [
        ...COMMERCIAL_PLANS.PREMIUM.features.map((name) => ({
          name,
          included: true,
        })),
      ],
      cta: {
        text: "Escolher Premium",
        href: checkoutPath("PREMIUM"),
      },
    },
  },

  testimonials: {
    videos: [],

    comments: [
      {
        quote:
          "Finalmente consegui organizar minha alimentação sem esforço. Ficou tudo muito mais claro.",
        name: "Ana Paula",
        role: "Nutricionista",
      },
      {
        quote:
          "Muito mais simples do que qualquer outro app. Uso todos os dias.",
        name: "Carlos Eduardo",
        role: "Usuário há 6 meses",
      },
      {
        quote:
          "Me deu controle total sobre minha rotina. Hoje sei exatamente o que estou fazendo.",
        name: "Felipe Costa",
        role: "Personal Trainer",
      },
      {
        quote:
          "Antes era tudo bagunçado. Agora consigo manter consistência de verdade.",
        name: "Júlia Oliveira",
        role: "Usuária há 1 ano",
      },
      {
        quote:
          "Uma ferramenta simples, mas extremamente poderosa no dia a dia.",
        name: "Rafael Santos",
        role: "Cliente ativo",
      },
    ],
  },

  faq: [
    {
      question: "Preciso instalar aplicativo?",
      answer: "Não. Toda experiência acontece diretamente pelo WhatsApp.",
    },
    {
      question: "A IA realmente analisa minhas refeições?",
      answer:
        "Sim. Basta enviar fotos ou informações da refeição para receber análises e orientações.",
    },
    {
      question: "Funciona para emagrecimento?",
      answer:
        "Sim. A plataforma auxilia tanto emagrecimento quanto ganho de massa e melhora de hábitos.",
    },
    {
      question: "Posso cancelar quando quiser?",
      answer: "Sim. Sem fidelidade e sem burocracia.",
    },
    {
      question: "Meus dados são protegidos?",
      answer: "Sim. Segurança e privacidade são prioridades da plataforma.",
    },
  ],

  moreFeatures: {
    title: "Tudo o que você precisa para evoluir",
    subtitle: "Recursos inteligentes",
    items: [
      {
        icon: "MessageSquare",
        title: "Nutrição via WhatsApp",
        description: "Envie refeições como conversa comum.",
      },
      {
        icon: "Activity",
        title: "Análise instantânea",
        description: "Receba feedback em segundos.",
      },
      {
        icon: "Target",
        title: "Objetivos personalizados",
        description: "A IA adapta recomendações ao seu perfil.",
      },
      {
        icon: "TrendingUp",
        title: "Evolução contínua",
        description: "Visualize sua evolução ao longo do tempo.",
      },
      {
        icon: "ClipboardCheck",
        title: "Rotina estruturada",
        description: "Mais consistência sem complicação.",
      },
      {
        icon: "Shield",
        title: "Privacidade total",
        description: "Seus dados protegidos e seguros.",
      },
    ],
  },

  header: {
    logo: singulfitLogo,
    links: [
      { label: "Recursos", target: "features" },
      { label: "Como funciona", target: "how-it-works" },
      { label: "Planos", target: "pricing" },
      { label: "Depoimentos", target: "testimonials" },
      { label: "FAQ", target: "faq" },
    ],
    cta: {
      label: "Começar no WhatsApp",
      target: "pricing",
    },
  },
};
