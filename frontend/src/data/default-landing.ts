import { LandingData } from "@/engine/landing.types";

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
      link: "https://wa.me/SEUNUMERO",
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

  features: [
    {
      id: 0,
      title: "Registre suas refeições de forma simples",
      text: "Adicione suas refeições em segundos e tenha tudo organizado automaticamente, sem precisar anotar manualmente.",
      media: "/gifs/chat-typing.gif",
    },
    {
      id: 1,
      title: "Acompanhe sua rotina com clareza",
      text: "Visualize seu dia completo e entenda exatamente o que está consumindo ao longo do tempo.",
      media: "/gifs/hero-chat.gif",
    },
    {
      id: 2,
      title: "Tenha controle real dos seus hábitos",
      text: "Transforme dados simples em decisões melhores e evolua com consistência na sua alimentação.",
      media: "/gifs/meal-animation.gif",
    },
  ],

  pricing: {
    monthly: {
      name: "Plano Básico",
      price: 29.9,
      interval: "/mês",
      description:
        "Ideal para quem deseja organizar a alimentação e receber análises inteligentes diariamente.",
      features: [
        { name: "Análise de refeições", included: true },
        { name: "Registro ilimitado", included: true },
        { name: "Acompanhamento diário", included: true },
        { name: "Histórico completo", included: true },
        { name: "Suporte padrão", included: true },
      ],
      cta: {
        text: "Começar agora",
        href: "#",
      },
    },

    annual: {
      name: "Plano Premium",
      price: 59.9,
      interval: "/mês",
      description:
        "Experiência completa com inteligência contextual, evolução contínua e acompanhamento avançado.",
      features: [
        { name: "Tudo do Básico", included: true },
        { name: "IA contextual avançada", included: true },
        { name: "Insights personalizados", included: true },
        { name: "Acompanhamento premium", included: true },
        { name: "Suporte prioritário", included: true },
      ],
      cta: {
        text: "Escolher Premium",
        href: "#",
      },
    },
  },

  testimonials: {
    videos: [
      {
        src: "/videos/depoimentolucy4.mp4",
        poster: "/videos/posters/depoimentolucy4.jpg",
        person: { name: "Luanna", age: 34 },
      },
      {
        src: "/videos/depoimentolucy1.mp4",
        poster: "/videos/posters/depoimentolucy1.jpg",
        person: { name: "Natalia", age: 30 },
      },
      {
        src: "/videos/depoimentolucy2.mp4",
        poster: "/videos/posters/depoimentolucy2.jpg",
        person: { name: "Adrielly", age: 24 },
      },
      {
        src: "/videos/depoimentolucy3.mp4",
        poster: "/videos/posters/depoimentolucy3.jpg",
        person: { name: "Amanda", age: 27 },
      },
      {
        src: "/videos/depoimentolucy5.mp4",
        poster: "/videos/posters/depoimentolucy5.jpg",
        person: { name: "Gabriela", age: 26 },
      },
    ],

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
    logo: "/images/singulfit-logo.png",
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
