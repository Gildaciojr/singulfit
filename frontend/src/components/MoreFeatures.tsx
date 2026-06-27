"use client";

import {
  Calendar,
  History,
  TrendingUp,
  Target,
  PieChart,
  FileText,
  Utensils,
  MessageSquare,
  Zap,
  Dumbbell,
  Activity,
  ClipboardCheck,
} from "lucide-react";

import { motion } from "framer-motion";
import { useIsMobile } from "@/hooks/use-mobile";
import { MoreFeaturesData } from "@/engine/landing.types";

const iconMap = {
  Calendar,
  History,
  TrendingUp,
  Target,
  PieChart,
  FileText,
  Utensils,
  MessageSquare,
  Zap,
  Dumbbell,
  Activity,
  ClipboardCheck,
};

type Props = {
  data: MoreFeaturesData;
};

export default function MoreFeatures({ data }: Props) {
  const isMobile = useIsMobile();

  return (
    <section className="relative overflow-hidden py-16 lg:py-20">
      {/* BACKGROUND */}
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(700px_450px_at_50%_0%,rgba(34,120,84,0.08),transparent_70%)]" />

      <div className="absolute inset-0 -z-10 opacity-[0.03] bg-[linear-gradient(to_right,#111_1px,transparent_1px),linear-gradient(to_bottom,#111_1px,transparent_1px)] bg-[size:56px_56px]" />

      <div className="container mx-auto max-w-7xl px-6">
        {/* HEADER */}
        <div className="mx-auto mb-16 max-w-3xl text-center">
          <div className="inline-flex items-center rounded-full border border-emerald-100 bg-white px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-900">
            {data.subtitle ?? "Funcionalidades"}
          </div>

          <h2 className="mt-6 text-4xl font-black tracking-[-0.05em] text-zinc-950 md:text-6xl">
            {data.title}
          </h2>

          <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-zinc-600 md:text-lg">
            Tudo o que você precisa para transformar uma simples conversa em um
            acompanhamento nutricional inteligente, contínuo e personalizado.
          </p>
        </div>

        {/* GRID */}
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((item, index) => {
            const Icon = iconMap[item.icon as keyof typeof iconMap];

            if (!Icon) return null;

            return (
              <motion.div
                key={index}
                initial={isMobile ? false : { opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                whileHover={!isMobile ? { y: -5 } : {}}
                transition={{
                  duration: 0.4,
                  delay: index * 0.05,
                }}
                className="
group
relative
overflow-hidden
rounded-[1.75rem]
border
border-zinc-200
bg-white
p-6
transition-all
duration-300
hover:border-emerald-200
hover:shadow-[0_20px_50px_-30px_rgba(0,0,0,0.18)]
"
              >
                {/* ICON */}
                <div
                  className="
    mb-5
    flex h-12 w-12 items-center justify-center
    rounded-xl
    bg-emerald-50
    text-emerald-800
  "
                >
                  <Icon className="h-5 w-5" />
                </div>

                {/* TITLE */}
                <h3 className="text-lg font-bold text-zinc-950">
                  {item.title}
                </h3>

                {/* DESCRIPTION */}
                <p className="mt-5 text-[15px] leading-8 text-zinc-600">
                  {item.description}
                </p>
              </motion.div>
            );
          })}
        </div>

        {/* TRUST STRIP */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55 }}
          className="
    mt-20
    flex
    flex-wrap
    items-center
    justify-center
    gap-4
    lg:gap-5
  "
        >
          <div
            className="
    group
    inline-flex
    items-center
    gap-3
    rounded-full
    border
    border-zinc-200
    bg-white/80
    px-5
    py-3
    backdrop-blur-xl
    shadow-[0_10px_35px_-24px_rgba(15,23,42,.18)]
    transition-all
    duration-300
    hover:-translate-y-0.5
    hover:border-emerald-200
  "
          >
            <div
              className="
      flex
      h-10
      w-10
      items-center
      justify-center
      rounded-full
      bg-emerald-50
      text-lg
    "
            >
              🎯
            </div>

            <div className="text-left">
              <div className="text-lg font-black text-zinc-950">Clareza</div>

              <div className="text-[13px] text-zinc-500">
                Entenda sua alimentação.
              </div>
            </div>
          </div>

          <div
            className="
    group
    inline-flex
    items-center
    gap-3
    rounded-full
    border
    border-zinc-200
    bg-white/80
    px-5
    py-3
    backdrop-blur-xl
    shadow-[0_10px_35px_-24px_rgba(15,23,42,.18)]
    transition-all
    duration-300
    hover:-translate-y-0.5
    hover:border-emerald-200
    hover:shadow-[0_16px_40px_-26px_rgba(6,78,59,.18)]
  "
          >
            <div
              className="
      flex
      h-10
      w-10
      items-center
      justify-center
      rounded-full
      bg-emerald-50
      text-emerald-700
      text-lg
      font-bold
    "
            >
              🌱
            </div>

            <div className="text-left">
              <div className="text-lg font-black tracking-[-0.03em] text-zinc-950">
                Consistência
              </div>

              <div className="text-[13px] text-zinc-500">
                Pequenos hábitos diários
              </div>
            </div>
          </div>

          <div
            className="
    group
    inline-flex
    items-center
    gap-3
    rounded-full
    border
    border-zinc-200
    bg-white/80
    px-5
    py-3
    backdrop-blur-xl
    shadow-[0_10px_35px_-24px_rgba(15,23,42,.18)]
    transition-all
    duration-300
    hover:-translate-y-0.5
    hover:border-emerald-200
    hover:shadow-[0_16px_40px_-26px_rgba(6,78,59,.18)]
  "
          >
            <div
              className="
      flex
      h-10
      w-10
      items-center
      justify-center
      rounded-full
      bg-emerald-50
      text-emerald-700
      text-lg
      font-bold
    "
            >
              📈
            </div>

            <div className="text-left">
              <div className="text-lg font-black tracking-[-0.03em] text-emerald-800">
                Evolução
              </div>

              <div className="text-[13px] text-zinc-500">
                Coach nutricional que se adapta com você
              </div>
            </div>
          </div>

          <div
            className="
    group
    inline-flex
    items-center
    gap-3
    rounded-full
    border
    border-zinc-200
    bg-white/80
    px-5
    py-3
    backdrop-blur-xl
    shadow-[0_10px_35px_-24px_rgba(15,23,42,.18)]
    transition-all
    duration-300
    hover:-translate-y-0.5
    hover:border-emerald-200
    hover:shadow-[0_16px_40px_-26px_rgba(6,78,59,.18)]
  "
          >
            <div
              className="
      flex
      h-10
      w-10
      items-center
      justify-center
      rounded-full
      bg-emerald-50
      text-emerald-700
      text-lg
      font-bold
    "
            >
              🏆
            </div>

            <div className="text-left">
              <div className="text-lg font-black tracking-[-0.03em] text-zinc-950">
                Resultado
              </div>

              <div className="text-[13px] text-zinc-500">
                Decisões mais inteligentes
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
