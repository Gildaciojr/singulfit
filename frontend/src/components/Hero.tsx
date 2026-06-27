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
    title: "Conversa de forma natural",
  },
  {
    icon: Sparkles,
    title: "IA que te compreende",
  },
  {
    icon: BarChart3,
    title: "Análises personalizadas",
  },
  {
    icon: Shield,
    title: "Segurança e privacidade total",
  },
];

const avatarInitials = ["A", "J", "M", "R", "L"];

export default function Hero({ data }: HeroProps) {
  return (
    <section className="relative overflow-hidden pt-24 pb-20 sm:pt-28 sm:pb-24 lg:pt-36 lg:pb-28">
      <div className="absolute inset-0 -z-30 bg-[#f7f8fc]" />

      <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_72%_18%,rgba(16,185,129,0.12),transparent_30%),radial-gradient(circle_at_20%_22%,rgba(6,95,70,0.06),transparent_34%),linear-gradient(180deg,#f7f8fc_0%,#f4f6fb_48%,#eef6f1_100%)]" />

      <div className="absolute inset-0 -z-10 opacity-[0.018] bg-[linear-gradient(to_right,#111827_1px,transparent_1px),linear-gradient(to_bottom,#111827_1px,transparent_1px)] bg-[size:72px_72px]" />

      <div className="mx-auto w-full max-w-[1540px] px-6 sm:px-8 xl:px-10">
        <div
          className="
    grid
    items-center
    gap-14
    xl:gap-20
    lg:grid-cols-[0.8fr_1.2fr]
  "
        >
          <motion.div
            initial="hidden"
            animate="visible"
            className="relative z-20 mx-auto max-w-[640px] text-center lg:mx-0 lg:max-w-[560px] lg:text-left"
          >
            <motion.div
              variants={fadeUp}
              className="mb-8 inline-flex items-center gap-2 rounded-full border border-emerald-900/8 bg-white/80 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-900 shadow-[0_10px_30px_-18px_rgba(6,78,59,0.22)] backdrop-blur-2xl"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {data.badge}
            </motion.div>

            <motion.h1
              variants={fadeUp}
              className="mx-auto max-w-[760px] text-[3.35rem] font-black leading-[0.88] tracking-[-0.07em] text-zinc-950 sm:text-[4.25rem] lg:max-w-[680px] lg:text-[5rem] xl:text-[5.05rem] "
            >
              Nutrição inteligente
              <span className="block text-zinc-950">no WhatsApp.</span>
              <span className="mt-2 block text-emerald-800">
                Você quem evolui.
              </span>
            </motion.h1>

            <motion.p
              variants={fadeUp}
              className="mx-auto mt-8 max-w-[560px] text-[1.05rem] leading-8 text-zinc-600 sm:text-lg lg:mx-0"
            >
              {data.subtitle}
            </motion.p>

            <motion.div
              variants={fadeUp}
              className="mt-8 grid grid-cols-1 gap-x-10 gap-y-5 sm:grid-cols-2 xl:grid-cols-2"
            >
              {benefitItems.map((item) => {
                const Icon = item.icon;

                return (
                  <div
                    key={item.title}
                    className="
        flex
        items-center
        gap-4
        rounded-2xl
        py-2
        transition-all
        duration-300
      "
                  >
                    <div
                      className="
          flex
          h-14
          w-14
          shrink-0
          items-center
          justify-center
          rounded-2xl
          bg-gradient-to-br
          from-emerald-50
          to-emerald-100
          text-emerald-900
          shadow-[0_12px_28px_-18px_rgba(6,78,59,.28)]
        "
                    >
                      <Icon className="h-6 w-6" />
                    </div>

                    <span
                      className="
          text-[15px]
          font-semibold
          leading-6
          tracking-[-0.015em]
          text-zinc-800
        "
                    >
                      {item.title}
                    </span>
                  </div>
                );
              })}
            </motion.div>

            <motion.div
              variants={fadeUp}
              className="mt-14 flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-center lg:justify-start"
            >
              <Button
                size="lg"
                className="group h-14 rounded-2xl bg-gradient-to-r from-emerald-900 via-emerald-800 to-emerald-900 px-9 text-base font-bold text-white shadow-[0_22px_55px_-22px_rgba(6,78,59,.45)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_60px_-18px_rgba(6,78,59,.55)]"
                onClick={() => window.location.assign(data.cta.link)}
              >
                {data.cta.label}
                <ArrowRight className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" />
              </Button>

              <Button
                variant="outline"
                size="lg"
                className="w-full sm:w-auto h-14 rounded-2xl border-zinc-200/80 bg-white/70 px-9 text-base font-semibold text-zinc-900 shadow-[0_12px_35px_-25px_rgba(15,23,42,.22)] transition-all duration-300 hover:bg-white hover:-translate-y-0.5"
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
                    className="flex h-11 w-11 ring-2 ring-white items-center justify-center rounded-full border-2 border-white bg-emerald-900 text-sm font-bold text-white shadow-sm"
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

                  <span className="ml-2 text-base font-black text-zinc-950">
                    4.9
                  </span>
                </div>

                <p className="mt-1 text-[15px] leading-6 text-zinc-600">
                  Mais de 4.500 pessoas já começaram sua evolução
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
    h-[640px]
    w-full
    max-w-[820px]
    lg:block
  "
          >
            <div className="absolute right-[3%] top-[6%] z-0 h-[500px] w-[500px] rounded-full bg-emerald-100/55 blur-[1px]" />

            <div className="absolute left-[5%] top-[22%] -z-10 h-[420px] w-[420px] rounded-full bg-emerald-400/10 blur-[90px]" />

            <div className="absolute right-[0%] top-[5%] -z-10 h-[500px] w-[500px] rounded-full bg-white/80 blur-[90px]" />

            <div
              className="
      absolute
      right-[3%]
      top-[5%]
      z-10
      h-[520px]
      w-[520px]
      overflow-hidden
      rounded-full
      bg-gradient-to-br
      from-emerald-50
      via-white
      to-emerald-100/70
      shadow-[inset_0_0_0_1px_rgba(255,255,255,.75)]
    "
            >
              <img
                src={heroAthlete}
                alt="Pessoa usando o SingulFit"
                className="
        h-full
        w-full
        scale-[1.02]
        object-cover
        object-[57%_48%]
        opacity-95
      "
              />
            </div>

            <motion.img
              src={mockupPhone}
              alt="Demonstração do SingulFit no WhatsApp"
              className="
      absolute
      left-[-14%]
      top-[9%]
      z-40
      w-[280px]
      object-contain
      mix-blend-multiply
      drop-shadow-[0_38px_80px_rgba(15,23,42,.24)]
      xl:left-[-10%]
      xl:w-[292px]
    "
              animate={{ y: [0, -8, 0] }}
              transition={{
                duration: 6,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />

            {/* CARD DESEMPENHO */}

            <motion.div
              initial={{ opacity: 0, x: 28, y: 14 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              transition={{ delay: 0.55, duration: 0.55 }}
              className="
      absolute
      right-[29%]
      top-[57%]
      z-50
      w-[185px]
      rounded-[1.35rem]
      border
      border-white/15
      bg-zinc-950/88
      p-3
      text-white
      shadow-[0_30px_70px_-32px_rgba(0,0,0,.62)]
      backdrop-blur-2xl
    "
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[12px] font-bold leading-4">
                  Desempenho semanal
                </h3>
                <TrendingUp className="h-4 w-4 shrink-0 text-emerald-300" />
              </div>

              <div className="mt-3 space-y-2.5">
                {[
                  ["Treinos", "5 / 6", "78%"],
                  ["Adesão", "92%", "92%"],
                  ["Sono médio", "7h 23m", "55%"],
                  ["Passos", "12.430", "64%"],
                ].map(([label, value, width]) => (
                  <div key={label}>
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="text-white/72">{label}</span>
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
      right-[3%]
      top-[57%]
      z-50
      w-[220px]
      rounded-[1.45rem]
      border
      border-white/80
      bg-white/95
      p-3
      shadow-[0_30px_80px_-38px_rgba(15,23,42,.34)]
      backdrop-blur-2xl
    "
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[11px] font-extrabold tracking-[-0.02em] text-zinc-950">
                  Evolução de peso
                </h3>

                <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                  Ver mais
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  ["84,0 kg", "Semana 1"],
                  ["82,8 kg", "Semana 4"],
                  ["80,9 kg", "Semana 8"],
                ].map(([value, label]) => (
                  <div key={label}>
                    <div className="text-[11px] font-black text-zinc-950">
                      {value}
                    </div>

                    <div className="mt-1 text-[10px] text-zinc-500">
                      {label}
                    </div>
                  </div>
                ))}
              </div>

              <div className="relative mt-3 h-[36px]">
                <svg
                  viewBox="0 0 320 72"
                  className="absolute inset-0 h-full w-full"
                >
                  <path
                    d="M20 18 C90 18,130 28,170 35 C220 42,270 50,300 60"
                    fill="none"
                    stroke="#DDEAE4"
                    strokeWidth="7"
                    strokeLinecap="round"
                  />

                  <path
                    d="M20 18 C90 18,130 28,170 35 C220 42,270 50,300 60"
                    fill="none"
                    stroke="#0B7A5A"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />

                  <circle
                    cx="20"
                    cy="18"
                    r="4.5"
                    fill="#0B7A5A"
                    stroke="white"
                    strokeWidth="2"
                  />
                  <circle
                    cx="170"
                    cy="35"
                    r="4.5"
                    fill="#0B7A5A"
                    stroke="white"
                    strokeWidth="2"
                  />
                  <circle
                    cx="300"
                    cy="60"
                    r="4.5"
                    fill="#0B7A5A"
                    stroke="white"
                    strokeWidth="2"
                  />
                </svg>
              </div>
            </motion.div>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55, duration: 0.65 }}
          className="mt-14 overflow-hidden rounded-[2.25rem] border border-white/10 bg-gradient-to-r from-zinc-950 via-[#08261f] to-zinc-950 p-6 py-5 text-white shadow-[0_45px_90px_-45px_rgba(15,23,42,.45)] lg:px-8 lg:py-6"
        >
          <div className="grid grid-cols-1 items-start gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:items-center lg:gap-8">
            <div className="flex items-center gap-4 lg:border-r lg:border-white/10 lg:pr-6">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400/20 to-emerald-500/10  shadow-[0_12px_30px_-18px_rgba(16,185,129,.45)]">
                <Sparkles className="h-6 w-6" />
              </div>

              <div>
                <p className="text-[15px] font-medium leading-7 text-white/90">
                  Finalmente encontrei algo que entende minha rotina de verdade.
                </p>

                <p className="mt-2 text-[10px] uppercase tracking-[0.14em] text-white/55">
                  — Juliana R.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4 lg:border-r lg:border-white/10 lg:px-6">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
                <MessageCircle className="h-6 w-6" />
              </div>

              <div>
                <div className="text-[2.1rem] leading-none font-black">
                  4.500+
                </div>
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
                <div className="text-[1.3rem] tracking-[-0.02em] font-black">
                  Resultados reais
                </div>
                <p className="text-sm leading-7 text-white/70">
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
                <p className="text-sm leading-7 text-white/70">
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
