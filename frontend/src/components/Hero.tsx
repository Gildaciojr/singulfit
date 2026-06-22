"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import mockupPhone from "@/assets/mockups/mockup-phone.png";
import heroAthlete from "@/assets/images/hero-athlete.png";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  MessageCircle,
  Play,
  Shield,
  Sparkles,
  Star,
  Target,
  TrendingUp,
} from "lucide-react";

type HeroProps = {
  data: {
    badge: string;
    title: string;
    subtitle: string;
    cta: {
      label: string;
      link: string;
    };
    metrics: {
      value: string;
      label: string;
    }[];
  };
};

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.65, ease: [0.22, 1, 0.36, 1] as const },
  },
};

const visualIn = {
  hidden: { opacity: 0, y: 28, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.85, ease: [0.22, 1, 0.36, 1] as const },
  },
};

const benefitItems = [
  {
    icon: MessageCircle,
    title: "Converse de forma simples",
    description: "natural",
  },
  {
    icon: Sparkles,
    title: "IA que entende seu",
    description: "contexto",
  },
  {
    icon: BarChart3,
    title: "Análises precisas e",
    description: "personalizadas",
  },
  {
    icon: Shield,
    title: "Privacidade total",
    description: "e dados seguros",
  },
];

const avatarInitials = ["A", "J", "M", "R", "L"];

export default function Hero({ data }: HeroProps) {
  return (
    <section className="relative overflow-hidden pt-28 pb-28 lg:pt-32 lg:pb-32">
      <div className="absolute inset-0 -z-30 bg-[#f8f7f3]" />

      <div className="absolute inset-0 -z-20 bg-[radial-gradient(900px_520px_at_64%_18%,rgba(34,120,84,0.14),transparent_62%),radial-gradient(760px_460px_at_10%_18%,rgba(6,78,59,0.08),transparent_60%),linear-gradient(180deg,rgba(255,255,255,0.92),rgba(255,255,255,0.72))]" />

      <div className="absolute inset-0 -z-10 opacity-[0.035] bg-[linear-gradient(to_right,#111_1px,transparent_1px),linear-gradient(to_bottom,#111_1px,transparent_1px)] bg-[size:56px_56px]" />

      <div className="container mx-auto max-w-[1500px] px-6">
        <div
          className="
    grid
    items-center
    gap-11
    lg:grid-cols-[0.95fr_1.05fr]
  "
        >
          <motion.div
            initial="hidden"
            animate="visible"
            className="relative z-20 text-center lg:text-left"
          >
            <motion.div
              variants={fadeUp}
              className="mb-7 inline-flex items-center gap-2 rounded-full border border-emerald-900/10 bg-white/85 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-900 shadow-sm backdrop-blur-xl"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {data.badge}
            </motion.div>

            <motion.h1
              variants={fadeUp}
              className="mx-auto max-w-4xl text-5xl font-black leading-[0.94] tracking-[-0.065em] text-zinc-950 md:text-7xl lg:mx-0 lg:text-[5.25rem]"
            >
              Nutrição inteligente
              <span className="block text-zinc-950">no WhatsApp.</span>
              <span className="block text-emerald-800">Você quem evolui.</span>
            </motion.h1>

            <motion.p
              variants={fadeUp}
              className="mx-auto mt-7 max-w-2xl text-base leading-8 text-zinc-600 md:text-lg lg:mx-0"
            >
              {data.subtitle}
            </motion.p>

            <motion.div
              variants={fadeUp}
              className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
            >
              {benefitItems.map((item) => {
                const Icon = item.icon;

                return (
                  <div
                    key={`${item.title}-${item.description}`}
                    className="flex items-center gap-3 text-left"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-900">
                      <Icon className="h-5 w-5" />
                    </div>

                    <div>
                      <div className="text-xs font-semibold leading-5 text-zinc-700">
                        {item.title}
                      </div>
                      <div className="text-xs leading-5 text-zinc-500">
                        {item.description}
                      </div>
                    </div>
                  </div>
                );
              })}
            </motion.div>

            <motion.div
              variants={fadeUp}
              className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start"
            >
              <Button
                size="lg"
                className="group h-14 rounded-2xl bg-emerald-900 px-8 text-base font-bold text-white shadow-[0_18px_45px_-18px_rgba(6,78,59,0.55)] hover:bg-emerald-950"
                onClick={() => window.location.assign(data.cta.link)}
              >
                {data.cta.label}
                <ArrowRight className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" />
              </Button>

              <Button
                variant="outline"
                size="lg"
                className="h-14 rounded-2xl border-zinc-200 bg-white/85 px-8 text-base font-semibold text-zinc-900 shadow-sm backdrop-blur-xl hover:bg-white"
                onClick={() =>
                  document
                    .getElementById("how-it-works")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
              >
                <Play className="h-4 w-4" />
                Ver como funciona
              </Button>
            </motion.div>

            <motion.div
              variants={fadeUp}
              className="mt-8 flex flex-col items-center gap-4 sm:flex-row lg:justify-start"
            >
              <div className="flex -space-x-3">
                {avatarInitials.map((initial, index) => (
                  <div
                    key={`${initial}-${index}`}
                    className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-white bg-emerald-900 text-sm font-bold text-white shadow-sm"
                  >
                    {initial}
                  </div>
                ))}
              </div>

              <div className="text-center sm:text-left">
                <div className="flex items-center justify-center gap-1 sm:justify-start">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Star
                      key={index}
                      className="h-4 w-4 fill-emerald-700 text-emerald-700"
                    />
                  ))}

                  <span className="ml-2 text-sm font-black text-zinc-950">
                    4.9
                  </span>
                </div>

                <p className="mt-1 text-sm text-zinc-600">
                  Mais de 8.500 pessoas já começaram sua evolução
                </p>
              </div>
            </motion.div>
          </motion.div>

          {/* BLOCO VISUAL HERO */}

          <motion.div
            initial="hidden"
            animate="visible"
            variants={visualIn}
            className="
              relative
              mx-auto
              hidden
              h-[620px]
              w-full
              max-w-[820px]
              lg:block
            "
          >
            <div className="absolute left-[20%] top-[48%] -z-10 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-emerald-800/10 blur-2xl" />

            <div className="absolute right-[-2%] top-[7%] h-[560px] w-[560px] rounded-full bg-emerald-900/5 blur-2xl" />

            <div
              className="
    absolute
    left-[-8%]
    top-[3%]
    z-10
    h-[620px]
    w-[320px]
    rounded-[4rem]
    bg-gradient-to-b
    from-[#f6f4fb]
    via-[#f2f1f8]
    to-[#f6f4fb]
    blur-[50px]
  "
            />

            <motion.img
              src={mockupPhone}
              alt="Demonstração do SingulFit no WhatsApp"
              className="
                absolute
                left-[-8%]
                top-[3%]
                z-20
                w-[300px]
                mix-blend-darken
                -translate-x-1/1
                object-contain
                drop-shadow-[0_42px_80px_rgba(15,23,42,0.28)]
                xl:w-[320px]
              "
              animate={{ y: [0, -10, 0] }}
              transition={{
                duration: 6,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />

            <img
              src={heroAthlete}
              alt="Pessoa usando o SingulFit"
              className="
                absolute
                right-[0%]
                top-[3%]
                z-10
                h-[600px]
                w-auto
                -translate-x-1/1
                object-contain
                rounded-[1.8rem]
                opacity-100
                drop-shadow-[0_35px_70px_rgba(15,23,42,0.16)]
              "
            />

            {/* CARD DESEMPENHO */}

            <motion.div
              initial={{ opacity: 0, x: 28, y: 14 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              transition={{ delay: 0.55, duration: 0.55 }}
              className="
                absolute
                left-[35%]
                top-[72%]
                z-20
                w-[230px]
                rounded-[1.6rem]
                border
                border-white/20
                bg-zinc-950/88
                p-3
                text-white
                shadow-[0_30px_70px_-25px_rgba(0,0,0,0.55)]
                backdrop-blur-xl
              "
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold">Desempenho semanal</h3>
                <TrendingUp className="h-4 w-4 text-emerald-300" />
              </div>

              <div className="mt-4 space-y-4">
                {[
                  ["Treinos", "5 / 6", "78%"],
                  ["Adesão", "92%", "92%"],
                  ["Sono médio", "7h 23m", "55%"],
                  ["Passos", "12.430", "64%"],
                ].map(([label, value, width]) => (
                  <div key={label}>
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="text-white/75">{label}</span>
                      <span className="font-bold text-white">{value}</span>
                    </div>

                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-emerald-400"
                        style={{ width }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* CARD EVOLUÇÃO */}

            <motion.div
              initial={{ opacity: 0, x: 32, y: 18 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              transition={{ delay: 0.7, duration: 0.55 }}
              className="
                absolute
                right-[0%]
                top-[76%]
                z-50
                w-[248px]
                rounded-[1.8rem]
                border
                border-white/70
                bg-white/96
                p-2
                shadow-[0_35px_90px_-35px_rgba(15,23,42,0.28)]
                backdrop-blur-2xl
              "
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-black text-zinc-950">
                  Evolução de peso
                </h3>

                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-900">
                  Ver mais
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                {[
                  ["84,0 kg", "Semana 1"],
                  ["82,8 kg", "Semana 4"],
                  ["80,9 kg", "Semana 8"],
                ].map(([value, label]) => (
                  <div key={label}>
                    <div className="text-sm font-black text-zinc-950">
                      {value}
                    </div>

                    <div className="mt-1 text-[11px] text-zinc-500">
                      {label}
                    </div>
                  </div>
                ))}
              </div>

              <div className="relative mt-6 h-[70px]">
                <svg
                  viewBox="0 0 320 70"
                  className="absolute inset-0 h-full w-full"
                >
                  <path
                    d="M20 18 C90 18,130 28,170 35 C220 42,270 50,300 60"
                    fill="none"
                    stroke="#0f5c43"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />

                  <circle cx="20" cy="18" r="4" fill="#0f5c43" />
                  <circle cx="170" cy="35" r="4" fill="#0f5c43" />
                  <circle cx="300" cy="60" r="4" fill="#0f5c43" />
                </svg>
              </div>
            </motion.div>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55, duration: 0.65 }}
          className="mt-8 overflow-hidden rounded-[2rem] bg-gradient-to-r from-zinc-950 via-emerald-950 to-zinc-950 p-6 text-white shadow-[0_35px_90px_-45px_rgba(0,0,0,0.65)] lg:mt-2 lg:p-7"
        >
          <div className="grid gap-6 lg:grid-cols-4 lg:items-center">
            <div className="flex items-center gap-4 lg:border-r lg:border-white/10 lg:pr-6">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
                <Sparkles className="h-6 w-6" />
              </div>

              <div>
                <p className="text-sm font-medium leading-6 text-white/90">
                  Finalmente encontrei algo que entende minha rotina de verdade.
                </p>

                <p className="mt-2 text-xs text-white/55">— Juliana R.</p>
              </div>
            </div>

            <div className="flex items-center gap-4 lg:border-r lg:border-white/10 lg:px-6">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
                <MessageCircle className="h-6 w-6" />
              </div>

              <div>
                <div className="text-3xl font-black">8.500+</div>
                <p className="text-sm leading-6 text-white/70">
                  pessoas já começaram com o SingulFit
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4 lg:border-r lg:border-white/10 lg:px-6">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
                <Target className="h-6 w-6" />
              </div>

              <div>
                <div className="text-xl font-black">Resultados reais</div>
                <p className="text-sm leading-6 text-white/70">
                  mais energia, foco e consistência todos os dias
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4 lg:px-6">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
                <Shield className="h-6 w-6" />
              </div>

              <div>
                <div className="text-xl font-black">Segurança e confiança</div>
                <p className="text-sm leading-6 text-white/70">
                  tecnologia para cuidar da sua privacidade e bem-estar
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
