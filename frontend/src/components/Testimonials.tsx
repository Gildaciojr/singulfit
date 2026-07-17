"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { TestimonialsData } from "@/engine/landing.types";
import {
  ArrowRight,
  BadgeCheck,
  MessageCircle,
  Quote,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";

type Props = {
  data: TestimonialsData;
};

const experienceItems = [
  {
    title: "Acompanhamento que entende você",
    description: "Respostas personalizadas e humanas via WhatsApp.",
    icon: MessageCircle,
  },
  {
    title: "Nutrição adaptada à sua rotina",
    description: "A IA considera seu dia, seus treinos e seus hábitos.",
    icon: Sparkles,
  },
  {
    title: "Evolução contínua e consistente",
    description: "Pequenos ajustes diários que geram grandes mudanças.",
    icon: TrendingUp,
  },
];

export default function Testimonials({ data }: Props) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const isInView = useInView(sectionRef, {
    margin: "-12%",
    once: true,
  });
  const hasVideos = data.videos.length > 0;

  return (
    <section
      ref={sectionRef}
      id="testimonials"
      className="relative overflow-hidden py-16 sm:py-24 lg:py-28"
    >
      <div className="pointer-events-none absolute inset-0 -z-20 bg-[radial-gradient(950px_650px_at_75%_25%,rgba(16,185,129,0.08),transparent_72%)]" />

      <div className="pointer-events-none absolute inset-0 -z-10 opacity-[0.015] bg-[linear-gradient(to_right,#111_1px,transparent_1px),linear-gradient(to_bottom,#111_1px,transparent_1px)] bg-[size:72px_72px]" />

      <div className="container mx-auto max-w-[1440px] px-5 sm:px-6 lg:px-8">
        <div className="grid items-start gap-10 lg:grid-cols-[0.70fr_1.30fr] lg:gap-12 xl:grid-cols-[0.66fr_1.34fr] xl:gap-16">
          <motion.aside
            initial={{ opacity: 0, x: -18 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{
              duration: 0.5,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="lg:sticky lg:top-24"
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-white px-4 py-2 shadow-[0_12px_28px_-22px_rgba(15,23,42,.12)]">
              <Sparkles className="h-3.5 w-3.5 text-emerald-700" />

              <span className="text-[11px] font-bold uppercase tracking-[0.20em] text-emerald-900">
                Experiências reais
              </span>
            </div>

            <h2 className="mt-8 max-w-[560px] text-[2.8rem] font-black leading-[0.96] tracking-[-0.065em] text-zinc-950 sm:text-5xl lg:text-[3.25rem] xl:text-[3.65rem]">
              Resultados reais.
              <span className="mt-1 block">
                Histórias que{" "}
                <span className="text-emerald-800">inspiram.</span>
              </span>
            </h2>

            <p className="mt-6 max-w-[510px] text-[17px] leading-8 text-zinc-600">
              Pessoas reais, com rotinas reais, conquistando resultados reais
              com a SingulFit.
            </p>

            <div className="mt-9 space-y-3.5">
              {experienceItems.map((item, index) => {
                const Icon = item.icon;

                return (
                  <motion.div
                    key={item.title}
                    initial={{ opacity: 0, y: 12 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.35 }}
                    transition={{
                      duration: 0.32,
                      delay: 0.08 + index * 0.06,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    className="
      group
      flex
      items-center
      gap-4
      rounded-[1.35rem]
      border
      border-zinc-200/80
      bg-white
      px-5
      py-4
      shadow-[0_10px_24px_-20px_rgba(15,23,42,.10)]
      transition-all
      duration-300
      hover:-translate-y-0.5
      hover:border-emerald-200
      hover:shadow-[0_18px_36px_-24px_rgba(6,78,59,.12)]
    "
                  >
                    <div
                      className="
        flex
        h-11
        w-11
        shrink-0
        items-center
        justify-center
        rounded-2xl
        bg-emerald-50
        text-emerald-800
        transition-colors
        duration-300
        group-hover:bg-emerald-100
      "
                    >
                      <Icon className="h-5 w-5" />
                    </div>

                    <div className="min-w-0">
                      <h3 className="text-[15px] font-bold leading-5 text-zinc-950">
                        {item.title}
                      </h3>

                      <p className="mt-1 text-[13px] leading-6 text-zinc-500">
                        {item.description}
                      </p>
                    </div>
                  </motion.div>
                );
              })}
            </div>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{
                duration: 0.4,
                delay: 0.22,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="
    mt-9
    overflow-hidden
    rounded-[1.6rem]
    border
    border-emerald-100/80
    bg-gradient-to-br
    from-emerald-50
    via-white
    to-white
    p-6
    shadow-[0_16px_36px_-28px_rgba(6,78,59,.10)]
  "
            >
              <div className="flex items-start gap-4">
                <div
                  className="
        flex
        h-12
        w-12
        shrink-0
        items-center
        justify-center
        rounded-2xl
        bg-emerald-900
        text-white
      "
                >
                  <Quote className="h-4 w-4" />
                </div>

                <div className="min-w-0">
                  <div
                    className="
          text-[11px]
          font-bold
          uppercase
          tracking-[0.22em]
          text-emerald-700
        "
                  >
                    Filosofia SingulFit
                  </div>

                  <p
                    className="
          mt-3
          text-[16px]
          font-semibold
          leading-8
          tracking-[-0.01em]
          text-zinc-900
        "
                  >
                    A melhor tecnologia é aquela que desaparece.
                    <br />
                    Você percebe apenas os resultados.
                  </p>
                </div>
              </div>
            </motion.div>
          </motion.aside>
          <div className="relative space-y-8">
            <div className="flex justify-center lg:justify-start">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-white px-4 py-2 shadow-[0_12px_28px_-22px_rgba(15,23,42,.12)]">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />

                <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-900">
                  Depoimentos verificados
                </span>
              </div>
            </div>

            <div className="relative isolate overflow-hidden px-1 pb-10 pt-6 sm:px-3 sm:pb-14 lg:min-h-[720px] lg:px-5 lg:pb-20 lg:pt-10">
              <div className="pointer-events-none absolute left-1/2 top-[44%] -z-20 h-[480px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-300/18 blur-[180px]" />

              <svg
                aria-hidden="true"
                viewBox="0 0 900 720"
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 -z-10 hidden h-full w-full lg:block"
              >
                <path
                  d="M58 124 C 220 62, 340 170, 470 118 S 720 50, 842 132"
                  fill="none"
                  stroke="rgba(16,185,129,0.16)"
                  strokeWidth="1.5"
                  strokeDasharray="5 9"
                />

                <path
                  d="M86 334 C 240 252, 360 410, 514 318 S 722 236, 844 348"
                  fill="none"
                  stroke="rgba(16,185,129,0.18)"
                  strokeWidth="2"
                  strokeDasharray="4 10"
                />

                <path
                  d="M98 556 C 264 482, 382 628, 540 536 S 726 470, 830 574"
                  fill="none"
                  stroke="rgba(16,185,129,0.11)"
                  strokeWidth="1.5"
                  strokeDasharray="5 10"
                />

                <circle cx="58" cy="124" r="4" fill="rgba(16,185,129,0.24)" />
                <circle cx="470" cy="118" r="4" fill="rgba(16,185,129,0.20)" />
                <circle cx="842" cy="132" r="4" fill="rgba(16,185,129,0.24)" />

                <circle cx="86" cy="334" r="4" fill="rgba(16,185,129,0.20)" />
                <circle cx="514" cy="318" r="4" fill="rgba(16,185,129,0.18)" />
                <circle cx="844" cy="348" r="4" fill="rgba(16,185,129,0.20)" />

                <circle cx="98" cy="556" r="4" fill="rgba(16,185,129,0.18)" />
                <circle cx="540" cy="536" r="4" fill="rgba(16,185,129,0.16)" />
                <circle cx="830" cy="574" r="4" fill="rgba(16,185,129,0.18)" />
              </svg>

              <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-16 bg-gradient-to-b from-white via-white/75 to-transparent sm:h-20" />

              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-20 bg-gradient-to-t from-white via-white/80 to-transparent sm:h-28" />

              <div className="relative z-10 grid gap-5 md:grid-cols-2 md:gap-6 lg:grid-cols-12 lg:gap-x-7 lg:gap-y-7">
                {data.comments.map((item, index) => {
                  const placementClasses = [
                    "lg:col-span-4 lg:col-start-1 lg:translate-y-0",
                    "lg:col-span-4 lg:col-start-7 lg:translate-y-16",
                    "lg:col-span-4 lg:col-start-2 lg:translate-y-8",
                    "lg:col-span-4 lg:col-start-8 lg:translate-y-28",
                    "lg:col-span-4 lg:col-start-3 lg:translate-y-18",
                  ];

                  const placementClass =
                    placementClasses[index % placementClasses.length];

                  const rotations = [-1.8, 1.5, -0.9, 1.9, -1.2];

                  const rotation = rotations[index % rotations.length];

                  const initials = item.name
                    .split(" ")
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((part) => part.charAt(0).toUpperCase())
                    .join("");

                  return (
                    <motion.article
                      key={`${item.name}-${index}`}
                      initial={{ opacity: 0, y: 22 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, amount: 0.2 }}
                      transition={{
                        duration: 0.45,
                        delay: Math.min(index * 0.07, 0.28),
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      whileHover={{
                        y: -5,
                        rotate: rotation,
                        scale: 1.015,
                      }}
                      className={`
    group
    relative
    overflow-hidden
    rounded-[1.6rem]
    border
    border-white/80
    bg-white/95
    backdrop-blur-md
    p-6
    shadow-[0_20px_45px_-28px_rgba(15,23,42,.12)]
    transition-all
    duration-500
    hover:border-emerald-100
    hover:shadow-[0_55px_110px_-52px_rgba(16,185,129,.18)]
    sm:p-7
    ${placementClass}
  `}
                    >
                      <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,.08),transparent_62%)] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

                      <div className="relative z-10">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                            <Quote className="h-5 w-5" />
                          </div>

                          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-white px-3 py-1.5 shadow-[0_8px_20px_-16px_rgba(15,23,42,.20)]">
                            <BadgeCheck className="h-3.5 w-3.5 text-emerald-700" />

                            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-800">
                              Verificado
                            </span>
                          </div>
                        </div>

                        <p className="mt-7 text-[15px] leading-8 text-zinc-700">
                          “{item.quote}”
                        </p>

                        <div className="mt-7 flex items-center gap-3.5">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white bg-gradient-to-br from-emerald-100 via-white to-emerald-50 text-[13px] font-black tracking-[-0.02em] text-emerald-900 shadow-[0_15px_35px_-22px_rgba(16,185,129,.30)]">
                            {initials || "SF"}
                          </div>

                          <div className="min-w-0">
                            <div className="truncate text-[15px] font-bold text-zinc-950">
                              {item.name}
                            </div>

                            <div className="mt-1 truncate text-[13px] text-zinc-500">
                              {item.role}
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.article>
                  );
                })}
              </div>
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 22 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{
              duration: 0.55,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="
    relative
    isolate
    overflow-hidden
    rounded-[2.4rem]
    border
    border-zinc-800
    bg-gradient-to-br
    from-zinc-950
    via-[#111315]
    to-[#0A3F35]
    px-7
    py-8
    shadow-[0_50px_120px_-55px_rgba(0,0,0,.70)]
    sm:px-10
    sm:py-10
    lg:px-14
    lg:py-14
  "
          >
            <div className="absolute -right-20 top-0 h-72 w-72 rounded-full bg-emerald-500/10 blur-[120px]" />

            <div className="absolute bottom-0 left-0 h-52 w-52 rounded-full bg-emerald-400/5 blur-[90px]" />

            <div className="relative z-10 grid items-center gap-12 lg:grid-cols-[1fr_340px]">
              <div>
                <div
                  className="
      inline-flex
      items-center
      gap-2
      rounded-full
      border
      border-white/10
      bg-white/5
      px-5
      py-2.5
      backdrop-blur-xl
    "
                >
                  <Sparkles className="h-4 w-4 text-emerald-300" />

                  <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/90">
                    Comece hoje
                  </span>
                </div>

                <h3
                  className="
      mt-8
      max-w-[560px]
      text-[2.35rem]
      font-black
      leading-[0.96]
      tracking-[-0.06em]
      text-white
      sm:text-[3rem]
    "
                >
                  Sua evolução começa
                  <span className="block text-emerald-300">
                    na próxima mensagem.
                  </span>
                </h3>

                <p
                  className="
      mt-6
      max-w-[500px]
      text-[17px]
      leading-8
      text-white/88
    "
                >
                  Em menos de um minuto você inicia sua jornada, recebe
                  orientações personalizadas e passa a contar com um coach
                  inteligente disponível diretamente no WhatsApp.
                </p>

                <div className="mt-9 flex flex-wrap items-center gap-4">
                  <a
                    href="#pricing"
                    className="
        group
        inline-flex
        h-14
        items-center
        justify-center
        gap-3
        rounded-2xl
        bg-white
        px-8
        text-[15px]
        font-bold
        text-zinc-950
        shadow-[0_25px_55px_-24px_rgba(255,255,255,.35)]
        transition-all
        duration-300
        hover:-translate-y-1
      "
                  >
                    Começar agora
                    <ArrowRight
                      className="
          h-4
          w-4
          transition-transform
          duration-300
          group-hover:translate-x-1
        "
                    />
                  </a>

                  <div
                    className="
        inline-flex
        items-center
        gap-2
        rounded-full
        border
        border-white/10
        bg-white/5
        px-4
        py-3
        backdrop-blur-xl
      "
                  >
                    <BadgeCheck className="h-4 w-4 text-emerald-300" />

                    <span className="text-sm font-medium text-white/85">
                      Ativação imediata
                    </span>
                  </div>
                </div>

                <div
                  className="
      mt-8
      flex
      flex-wrap
      items-center
      gap-6
      text-[13px]
      text-white/65
    "
                >
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-300" />
                    Seguro e privado
                  </div>

                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-emerald-300" />
                    Resposta em segundos
                  </div>

                  <div className="flex items-center gap-2">
                    <BadgeCheck className="h-4 w-4 text-emerald-300" />
                    Sem burocracia
                  </div>
                </div>
              </div>

              <div className="relative hidden lg:flex justify-center">
                <div className="relative">
                  <div className="absolute inset-0 scale-110 rounded-full bg-emerald-400/20 blur-[110px]" />

                  <div
                    className="
            relative
            flex
            h-[420px]
            w-[210px]
            items-center
            justify-center
            rounded-[2.6rem]
            border
            border-white/10
            bg-zinc-900
            shadow-[0_40px_90px_-40px_rgba(0,0,0,.75)]
          "
                  >
                    <div
                      className="
              flex
              h-[88%]
              w-[84%]
              flex-col
              justify-center
              rounded-[2rem]
              bg-gradient-to-b
              from-emerald-500
              to-emerald-700
              p-6
            "
                    >
                      <div className="text-center">
                        <div className="text-sm text-white/80">SingulFit</div>

                        <div className="mt-5 text-5xl">💬</div>

                        <div className="mt-6 text-lg font-bold text-white">
                          Seu coach já está esperando.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
