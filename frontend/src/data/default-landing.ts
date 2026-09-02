import { LandingData } from "@/engine/landing.types";
import { checkoutPath, COMMERCIAL_PLANS } from "@/lib/commercial-plans";
import singulfitLogo from "@/assets/images/singulfit-logo.png";

import { Shield } from "lucide-react";

const iconMap = { Shield };

export const landingData: LandingData = {
  hero: {
    badge: "Inteligência nutricional que evolui com você.",
    title: "Nutrição inteligente. Sua evolução começa agora.",
    subtitle:
      "Fotografe suas refeições, converse naturalmente pelo WhatsApp e receba orientações inteligentes que evoluem junto com sua rotina.",
    cta: {
      label: "Começar agora no WhatsApp",
      link: checkoutPath("PREMIUM"),
    },
    metrics: [
      {
        value: "+4.500",
        label: "pessoas já evoluíram",
      },
      {
        value: "95%",
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
          "Nunca consegui manter uma rotina tão simples. Uso todos os dias.",
        name: "Carlos Eduardo",
        role: "Esportista",
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
        role: "Servidora pública",
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
      question: "A SingulFit serve apenas para emagrecimento?",
      answer:
        "Não. Nosso agente se adapta conforme seus objetivos, seja emagrecimento, ganho de massa, melhora da qualidade alimentar e treinos.",
    },
    {
      question: "Posso cancelar quando quiser?",
      answer: "Sim e sem burocracia.",
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
      title: "Converse naturalmente",
      description:
        "Fale sobre refeições, dúvidas, rotina e objetivos do mesmo jeito que você já conversa no WhatsApp.",
    },
    {
      icon: "Activity",
      title: "Respostas rápidas",
      description:
        "Receba análises e orientações claras para tomar decisões melhores no seu dia a dia.",
    },
    {
      icon: "Target",
      title: "Objetivos personalizados",
      description:
        "O acompanhamento considera seu perfil, suas preferências e o objetivo que você deseja alcançar.",
    },
    {
      icon: "TrendingUp",
      title: "Evolução contínua",
      description:
        "Seu contexto acompanha sua jornada para que as orientações evoluam junto com seus resultados.",
    },
    {
      icon: "ClipboardCheck",
      title: "Hábitos consistentes",
      description:
        "Acompanhamento e orientação contínua ajudam boas escolhas a se transformarem em rotina.",
    },
    {
      icon: "Shield",
      title: "Privacidade e segurança",
      description:
        "Seus dados são protegidos e utilizados para tornar sua experiência mais personalizada.",
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
      label: "Começar agora",
      target: "pricing",
    },
  },
};
