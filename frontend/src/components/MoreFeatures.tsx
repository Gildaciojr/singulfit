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
      aria-labelledby="features-title"
      className="relative isolate bg-white py-12 sm:py-16"
    >
      <div className="mx-auto w-full max-w-[1160px] px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-900">
            {data.subtitle ?? "Recursos inteligentes"}
          </div>

          <h2
            id="features-title"
            className="mt-4 text-[clamp(1.875rem,3.4vw,2.75rem)] font-black leading-[1.12] tracking-[-0.04em] text-zinc-950"
          >
            {data.title}
          </h2>

          <p className="mx-auto mt-3 max-w-2xl text-base leading-7 text-zinc-600">
            Um acompanhamento completo no WhatsApp para entender sua rotina,
            adaptar suas escolhas e ajudar você a evoluir com mais consistência.
          </p>
        </div>

        {/* Features */}
        <div className="mt-7 grid min-w-0 gap-3 md:grid-cols-2 lg:grid-cols-3 sm:gap-4">
          {data.items.map((item, index) => {
            const Icon = iconMap[item.icon as keyof typeof iconMap];

            if (!Icon) {
              return null;
            }

            return (
              <article
                key={`${item.title}-${index}`}
                data-cta-protected
                className="min-w-0 rounded-2xl border border-zinc-200 bg-[#fafbf9] p-4 shadow-[0_8px_24px_-20px_rgba(6,78,59,0.16)] transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none [@media(hover:hover)]:hover:border-emerald-300 [@media(hover:hover)]:hover:shadow-[0_12px_28px_-18px_rgba(6,78,59,0.18)] sm:p-5"
              >
                <div>
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-900">
                      <Icon aria-hidden="true" className="h-4 w-4 stroke-[2]" />
                    </div>
                    <h3 className="pt-1 text-base font-bold leading-6 tracking-tight text-zinc-950">
                      {item.title}
                    </h3>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-zinc-600">
                    {item.description}
                  </p>
                </div>
              </article>
            );
          })}
        </div>

        {/* Bottom message */}
        <div className="mx-auto mt-6 flex max-w-3xl items-start justify-center gap-2 text-center text-sm leading-6 text-zinc-600">
          <Shield
            aria-hidden="true"
            className="mt-1 h-4 w-4 shrink-0 text-emerald-800"
          />

          <span>
            Tecnologia para simplificar sua rotina — sem substituir a conversa,
            o contexto e a personalização.
          </span>
        </div>
      </div>
    </section>
  );
}
