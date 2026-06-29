"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import mockupPhone from "@/assets/mockups/mockup-phone.png";
import heroAthlete from "@/assets/images/hero-athlete.png";
import {
  ArrowRight,
  BarChart3,
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

            <div className="hidden lg:block">
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
            </div>

            <div className="hidden lg:block">
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
                  className="h-14 w-full rounded-2xl border-zinc-200/80 bg-white/70 px-9 text-base font-semibold text-zinc-900 shadow-[0_12px_35px_-25px_rgba(15,23,42,.22)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-white sm:w-auto"
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
            </div>

            <div className="hidden lg:block">
              <motion.div
                variants={fadeUp}
                className="mt-8 flex flex-col items-center gap-4 sm:flex-row lg:justify-start"
              >
                <div className="flex -space-x-3">
                  {avatarInitials.map((initial, index) => (
                    <div
                      key={`${initial}-${index}`}
                      className="
            flex
            h-10
            w-10
            items-center
            justify-center
            rounded-full
            border-2
            border-white
            bg-emerald-900
            text-sm
            font-bold
            text-white
            shadow-sm
            ring-2
            ring-white
          "
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
            </div>
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
    right-[0%]
    top-[6%]
    z-10
    h-[500px]
    w-[500px]
    overflow-hidden
    rounded-[3.2rem]
  "
            >
              <img
                src={heroAthlete}
                alt="Pessoa usando o SingulFit"
                className="
      h-full
      w-full
      object-cover
      object-[58%_48%]
      scale-[1.04]
      opacity-100
    "
              />

              {/* Integração suave com o background */}
              <div
                className="
      absolute
      inset-0
      pointer-events-none
      rounded-[3.2rem]
      bg-[radial-gradient(circle_at_center,transparent_58%,rgba(247,248,252,0.18)_76%,rgba(247,248,252,0.62)_92%,#f7f8fc_100%)]
    "
              />

              {/* Glow muito sutil */}
              <div
                className="
      absolute
      -inset-8
      -z-10
      rounded-[4rem]
      bg-emerald-100/30
      blur-[70px]
    "
              />
            </div>

            <motion.img
              src={mockupPhone}
              alt="Demonstração do SingulFit no WhatsApp"
              className="
      absolute
      left-[-8%]
      top-[1%]
      z-40
      w-[300px]
      object-contain
      mix-blend-multiply
      drop-shadow-[0_38px_80px_rgba(15,23,42,.24)]
      xl:left-[-6%]
      xl:w-[315px]
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
      right-[27%]
      top-[84%]
      z-50
      w-[175px]
      rounded-[1.35rem]
      border
      border-white/60
      bg-zinc-950/88
      p-2.5
      text-white
      shadow-[0_30px_70px_-32px_rgba(0,0,0,.62)]
      backdrop-blur-xl
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
      right-[0%]
      top-[84%]
      z-50
      w-[205px]
      rounded-[1.45rem]
      border
      border-white/80
      bg-white/95
      p-2.5
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

              <div className="relative mt-2 h-[30px]">
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

        {/* HERO MOBILE */}

        <motion.div
          initial="hidden"
          animate="visible"
          variants={visualIn}
          className="
            relative
            mx-auto
            mt-8
            w-full
            max-w-[430px]
            lg:hidden
          "
        >
          <motion.div
            variants={fadeUp}
            className="
              flex
              flex-col
              gap-3
              px-1
            "
          >
            <Button
              size="lg"
              className="group h-14 w-full rounded-2xl bg-gradient-to-r from-emerald-900 via-emerald-800 to-emerald-900 px-6 text-[15px] font-bold text-white shadow-[0_22px_55px_-22px_rgba(6,78,59,.48)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_60px_-18px_rgba(6,78,59,.55)]"
              onClick={() => window.location.assign(data.cta.link)}
            >
              <MessageCircle className="h-5 w-5" />
              {data.cta.label}
              <ArrowRight className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" />
            </Button>

            <Button
              variant="outline"
              size="lg"
              className="h-14 w-full rounded-2xl border-emerald-900/10 bg-white/75 px-6 text-[15px] font-bold text-emerald-950 shadow-[0_14px_38px_-28px_rgba(15,23,42,.24)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:bg-white"
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
            className="
              mt-5
              grid
              grid-cols-2
              gap-3
              px-1
            "
          >
            {benefitItems.map((item) => {
              const Icon = item.icon;

              return (
                <div
                  key={item.title}
                  className="
                    flex
                    min-h-[72px]
                    items-center
                    gap-3
                    rounded-[1.25rem]
                    border
                    border-white/80
                    bg-white/72
                    px-3.5
                    py-3
                    shadow-[0_18px_42px_-34px_rgba(15,23,42,.28)]
                    backdrop-blur-2xl
                  "
                >
                  <div
                    className="
                      flex
                      h-10
                      w-10
                      shrink-0
                      items-center
                      justify-center
                      rounded-2xl
                      bg-emerald-50
                      text-emerald-800
                    "
                  >
                    <Icon className="h-5 w-5" />
                  </div>

                  <span
                    className="
                      text-[12px]
                      font-extrabold
                      leading-[1.2]
                      tracking-[-0.02em]
                      text-emerald-950
                    "
                  >
                    {item.title}
                  </span>
                </div>
              );
            })}
          </motion.div>

          <div
            className="
              relative
              mt-6
              min-h-[790px]
              overflow-visible
              px-1
            "
          >
            <div
              className="
                pointer-events-none
                absolute
                inset-x-[-44px]
                top-[-12px]
                h-[500px]
                rounded-full
                bg-emerald-100/70
                blur-[145px]
              "
            />

            <div
              className="
                pointer-events-none
                absolute
                right-[-86px]
                top-[42px]
                h-[310px]
                w-[310px]
                rounded-full
                bg-emerald-300/20
                blur-[90px]
              "
            />

            <div
              className="
                pointer-events-none
                absolute
                left-[-72px]
                top-[330px]
                h-[260px]
                w-[260px]
                rounded-full
                bg-white/90
                blur-[82px]
              "
            />

            <div
              className="
                absolute
                inset-x-0
                top-0
                h-[560px]
                overflow-hidden
                rounded-[2.25rem]
                border
                border-white/80
                bg-[radial-gradient(circle_at_76%_26%,rgba(16,185,129,0.18),transparent_28%),linear-gradient(135deg,#ffffff_0%,#f7faf9_44%,#eaf7f2_100%)]
                shadow-[0_34px_90px_-52px_rgba(15,23,42,.3)]
              "
            >
              <img
                src={heroAthlete}
                alt="Pessoa utilizando SingulFit"
                className="
                  pointer-events-none
                  absolute
                  right-[-8px]
                  top-0
                  z-10
                  w-[560px]
                  h-[520px]
                  select-none
                  object-cover
                  object-[50%_18%]
                  min-[390px]:right-[-18px]
                  min-[390px]:w-[500px]
                "
              />

              <div
                className="
                  pointer-events-none
                  absolute
                  inset-y-0
                  left-0
                  z-20
                  w-[10%]
                  bg-gradient-to-r
                  from-white
                  via-white/35
                  to-transparent
                "
              />

              <div
                className="
                  pointer-events-none
                  absolute
                  inset-x-0
                  bottom-0
                  z-20
                  h-36
                  bg-gradient-to-t
                  from-[#f7f8fc]
                  via-[#f7f8fc]/28
                  to-transparent
                "
              />
            </div>

            <motion.img
              src={mockupPhone}
              alt="Demonstração do SingulFit no WhatsApp"
              animate={{
                y: [0, -7, 0],
                rotate: [0, 0.2, 0],
              }}
              transition={{
                duration: 7.5,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              className="
                pointer-events-none
                absolute
                left-[50%]
                top-[255px]
                z-40
                w-[270px]
                -translate-x-1/2
                select-none
                object-contain
                drop-shadow-[0_72px_150px_rgba(15,23,42,.34)]
                min-[390px]:left-[50%]
                min-[390px]:top-[245px]
                min-[390px]:w-[255px]
              "
            />

            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.58, duration: 0.6 }}
              className="
                absolute
                inset-x-1
                top-[550px]
                z-30
                overflow-hidden
                rounded-[1.65rem]
                border
                border-white/75
                bg-white/90
                shadow-[0_20px_50px_-38px_rgba(15,23,42,.3)]
                backdrop-blur-2xl
              "
            >
              <div className="grid grid-cols-1">
                {data.metrics.map((metric, index) => (
                  <div
                    key={metric.label}
                    className={`
                      flex
                      items-center
                      justify-between
                      px-5
                      py-4
                      ${index !== data.metrics.length - 1 ? "border-b border-zinc-100" : ""}
                    `}
                  >
                    <span className="text-[12px] font-semibold tracking-[-0.01em] text-zinc-500">
                      {metric.label}
                    </span>

                    <span className="text-[21px] font-black tracking-[-0.045em] text-emerald-900">
                      {metric.value}
                    </span>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 border-t border-white/10 bg-gradient-to-r from-emerald-950 via-emerald-900 to-emerald-950 text-white">
                <div className="flex min-h-[84px] flex-col justify-center gap-1 px-3.5">
                  <MessageCircle className="h-5 w-5 text-emerald-200" />
                  <span className="text-[13px] font-black leading-tight">
                    +4.500
                  </span>
                  <span className="text-[10px] leading-tight text-white/68">
                    pessoas
                  </span>
                </div>

                <div className="flex min-h-[84px] flex-col justify-center gap-1 border-x border-white/10 px-3.5">
                  <Target className="h-5 w-5 text-emerald-200" />
                  <span className="text-[12px] font-black leading-tight">
                    Resultados reais
                  </span>
                  <span className="text-[10px] leading-tight text-white/68">
                    mais consistência
                  </span>
                </div>

                <div className="flex min-h-[84px] flex-col justify-center gap-1 px-3.5">
                  <Shield className="h-5 w-5 text-emerald-200" />
                  <span className="text-[12px] font-black leading-tight">
                    Privacidade
                  </span>
                  <span className="text-[10px] leading-tight text-white/68">
                    dados protegidos
                  </span>
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55, duration: 0.6 }}
          className="hidden lg:block mt-5 overflow-hidden rounded-[1.5rem] border border-emerald-950/10 bg-gradient-to-r from-zinc-950/95 via-[#08261f]/95 to-zinc-950/95 p-5 py-3 text-white shadow-[0_28px_70px_-48px_rgba(15,23,42,.45)] lg:px-6 lg:py-4"
        >
          <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
            <div className="flex items-center gap-3 lg:border-r lg:border-white/10 lg:pr-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-400/12 text-emerald-300">
                <Sparkles className="h-5 w-5" />
              </div>

              <div>
                <p className="text-[12px] font-medium leading-5 text-white/88">
                  Finalmente encontrei algo que entende minha rotina de verdade.
                </p>

                <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-white/45">
                  — Saray R.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 lg:border-r lg:border-white/10 lg:px-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-400/12 text-emerald-300">
                <MessageCircle className="h-5 w-5" />
              </div>

              <div>
                <div className="text-[2.1rem] leading-none font-black">
                  +4.500
                </div>
                <p className="text-[13px] leading-6 text-white/70">
                  pessoas já fazem parte da SingulFit
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 lg:border-r lg:border-white/10 lg:px-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-400/12 text-emerald-300">
                <Target className="h-5 w-5" />
              </div>

              <div>
                <div className="text-[15px] font-black tracking-[-0.02em]">
                  Resultados reais
                </div>
                <p className="mt-1 text-[12px] leading-5 text-white/62">
                  mais foco e consistência
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 lg:px-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-400/12 text-emerald-300">
                <Shield className="h-5 w-5" />
              </div>

              <div>
                <div className="text-[15px] font-black tracking-[-0.02em]">
                  Privacidade
                </div>
                <p className="mt-1 text-[12px] leading-5 text-white/62">
                  dados protegidos
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
