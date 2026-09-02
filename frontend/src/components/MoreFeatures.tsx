"use client";

import {
  Activity,
  ClipboardCheck,
  MessageSquare,
  Shield,
  Target,
  TrendingUp,
} from "lucide-react";

import { MoreFeaturesData } from "@/engine/landing.types";

const iconMap = {
  Activity,
  ClipboardCheck,
  MessageSquare,
  Shield,
  Target,
  TrendingUp,
};

type Props = {
  data: MoreFeaturesData;
};

export default function MoreFeatures({ data }: Props) {
  return (
    <section
      id="features"
      className="relative overflow-hidden py-16 lg:py-24"
    >
      {/* Background */}
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(900px_520px_at_50%_-5%,rgba(16,185,129,0.09),transparent_68%)]" />

      <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgba(24,24,27,0.025)_1px,transparent_1px),linear-gradient(to_bottom,rgba(24,24,27,0.025)_1px,transparent_1px)] bg-[size:56px_56px]" />

      <div className="container mx-auto max-w-[1280px] px-6">
        {/* Header */}
        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50/70 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-900">
            {data.subtitle ?? "Recursos inteligentes"}
          </div>

          <h2 className="mt-6 text-4xl font-black tracking-[-0.055em] text-zinc-950 sm:text-5xl md:text-6xl">
            {data.title}
          </h2>

          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-zinc-600 md:text-lg md:leading-8">
            Um acompanhamento completo no WhatsApp para entender sua rotina,
            adaptar suas escolhas e ajudar você a evoluir com mais consistência.
          </p>
        </div>

        {/* Features */}
        <div className="mt-14 grid gap-4 md:grid-cols-2 lg:mt-16 lg:grid-cols-3 lg:gap-5">
          {data.items.map((item, index) => {
            const Icon = iconMap[item.icon as keyof typeof iconMap];

            if (!Icon) {
              return null;
            }

            return (
              <article
                key={`${item.title}-${index}`}
                className="
                  group
                  relative
                  overflow-hidden
                  rounded-[1.75rem]
                  border
                  border-zinc-200/90
                  bg-white
                  p-6
                  shadow-[0_14px_40px_-30px_rgba(15,23,42,0.28)]
                  transition-[transform,border-color,box-shadow]
                  duration-300
                  hover:-translate-y-1
                  hover:border-emerald-200
                  hover:shadow-[0_24px_55px_-32px_rgba(6,78,59,0.30)]
                  md:p-7
                "
              >
                {/* Subtle highlight */}
                <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-emerald-50 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                <div className="relative">
                  <div className="flex items-start justify-between">
                    <div
                      className="
                        flex
                        h-12
                        w-12
                        items-center
                        justify-center
                        rounded-2xl
                        border
                        border-emerald-100
                        bg-emerald-50
                        text-emerald-900
                        transition-transform
                        duration-300
                        group-hover:scale-105
                      "
                    >
                      <Icon className="h-5 w-5 stroke-[2.1]" />
                    </div>

                    <span className="text-xs font-bold tracking-[0.16em] text-zinc-300">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>

                  <h3 className="mt-7 text-xl font-black tracking-[-0.035em] text-zinc-950">
                    {item.title}
                  </h3>

                  <p className="mt-3 text-sm leading-7 text-zinc-500 md:text-[15px]">
                    {item.description}
                  </p>

                  <div className="mt-7 h-px w-10 bg-emerald-200 transition-all duration-300 group-hover:w-16 group-hover:bg-emerald-500" />
                </div>
              </article>
            );
          })}
        </div>

        {/* Bottom message */}
        <div className="mx-auto mt-12 flex max-w-3xl items-center justify-center gap-3 text-center text-sm leading-6 text-zinc-500 lg:mt-14">
          <Shield className="h-4 w-4 shrink-0 text-emerald-800" />

          <span>
            Tecnologia para simplificar sua rotina — sem substituir a conversa,
            o contexto e a personalização.
          </span>
        </div>
      </div>
    </section>
  );
}