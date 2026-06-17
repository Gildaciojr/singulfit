"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  Lock,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { useIsMobile } from "@/hooks/use-mobile";
import { PricingPlan } from "@/engine/landing.types";
import { trackEvent } from "@/lib/tracking";
import { MessageCircle } from "lucide-react";

type Props = {
  data: {
    monthly: PricingPlan;
    annual: PricingPlan;
  };
};

function FeatureRow({ label }: { label: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-800">
        <Check className="h-3.5 w-3.5" />
      </div>

      <span className="text-[14px] leading-relaxed text-zinc-600">{label}</span>
    </div>
  );
}

function PlanCard({
  plan,
  featured = false,
  planType,
}: {
  plan: PricingPlan;
  featured?: boolean;
  planType: "basic" | "premium";
}) {
  const ctaLabel =
    plan.cta?.text ?? (featured ? "Entrar para o Premium" : "Começar agora");

  return (
    <motion.div
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.45 }}
      className={`
        relative flex h-full flex-col overflow-hidden rounded-[2rem] border bg-white p-7
        ${
          featured
            ? "border-emerald-800 shadow-[0_35px_90px_-35px_rgba(6,78,59,0.38)] ring-1 ring-emerald-800/10"
            : "border-zinc-200 shadow-[0_25px_70px_-35px_rgba(0,0,0,0.18)]"
        }
      `}
    >
      {featured && (
        <div className="absolute right-5 top-5 inline-flex items-center gap-2 rounded-full bg-emerald-900 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white">
          <Sparkles className="h-3.5 w-3.5" />
          MAIS ESCOLHIDO
        </div>
      )}

      <div className="mb-8">
        <div
          className={`
            mb-4 inline-flex items-center rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em]
            ${
              featured
                ? "bg-emerald-50 text-emerald-900"
                : "bg-zinc-100 text-zinc-600"
            }
          `}
        >
          {featured ? "Experiência completa" : "Para começar"}
        </div>

        <h3 className="text-3xl font-black tracking-tight text-zinc-950">
          {plan.name}
        </h3>

        <p className="mt-4 min-h-[72px] text-[14px] leading-7 text-zinc-600">
          {plan.description}
        </p>
      </div>

      <div className="mb-8">
        <div className="flex items-end gap-2">
          <span className="text-5xl font-black tracking-[-0.05em] text-zinc-950">
            R$ {plan.price.toFixed(2).replace(".", ",")}
          </span>

          <span className="pb-2 text-base font-medium text-zinc-500">
            {plan.interval}
          </span>
        </div>

        <p className="mt-3 text-[14px] text-zinc-500">
          Pagamento seguro. Cancele quando quiser.
        </p>
      </div>

      <div className="mb-8 h-px w-full bg-zinc-200" />

      <div className="space-y-3">
        {plan.features.map((feature, index) => (
          <FeatureRow key={index} label={feature.name} />
        ))}
      </div>

      <div className="flex-1" />

      <motion.a
        href={plan.cta?.href ?? "#pricing"}
        onClick={() =>
          trackEvent("cta_click", {
            plan: planType,
          })
        }
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.985 }}
        className={`
          group mt-9 flex h-14 w-full items-center justify-center gap-2 rounded-2xl px-6 text-base font-bold transition-all duration-300
          ${
            featured
              ? "bg-emerald-900 text-white shadow-[0_18px_45px_-20px_rgba(6,78,59,0.65)] hover:bg-emerald-950"
              : "border border-zinc-200 bg-white text-zinc-950 hover:border-emerald-800 hover:bg-emerald-50"
          }
        `}
      >
        {ctaLabel}
        <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
      </motion.a>
    </motion.div>
  );
}

export default function Pricing({ data }: Props) {
  const isMobile = useIsMobile();
  const { monthly, annual } = data;

  return (
    <section id="pricing" className="relative overflow-hidden py-24 lg:py-36">
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(800px_500px_at_50%_0%,rgba(34,120,84,0.08),transparent_70%)]" />
      <div className="absolute inset-0 -z-10 opacity-[0.03] bg-[linear-gradient(to_right,#111_1px,transparent_1px),linear-gradient(to_bottom,#111_1px,transparent_1px)] bg-[size:56px_56px]" />

      <div className="container mx-auto max-w-7xl px-6">
        <motion.div
          initial={isMobile ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.45 }}
          className="mx-auto mb-16 max-w-3xl text-center"
        >
          <div className="inline-flex items-center rounded-full border border-emerald-200 bg-white px-5 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-900 shadow-sm">
            Planos
          </div>

          <h2 className="mt-6 text-4xl font-black tracking-[-0.04em] text-zinc-950 md:text-6xl">
            Comece sua evolução hoje.
          </h2>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-zinc-600">
            Escolha o nível de acompanhamento ideal para sua rotina.
          </p>
        </motion.div>

        <motion.div
          initial={isMobile ? false : { opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.45 }}
          className="mb-5  grid gap-5 md:grid-cols-3"
        >
          <div className="flex items-center justify-center gap-5 rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
            <Sparkles className="h-6 w-6 text-emerald-800" />
            <span className="text-[14px] font-semibold text-zinc-700">
              Acesso imediato
            </span>
          </div>

          <div className="flex items-center justify-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-4 shadow-sm">
            <BadgeCheck className="h-5 w-5 text-emerald-800" />
            <span className="text-[14px] font-semibold text-zinc-700">
              Sem aplicativo extra e sem burocracia.
            </span>
          </div>
        </motion.div>

        <div className="grid gap-6 lg:grid-cols-2">
          <PlanCard plan={monthly} planType="basic" />
          <PlanCard plan={annual} planType="premium" featured />
        </div>

        <div className="mt-3 inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">
          Melhor custo-benefício
        </div>

<motion.div
  initial={isMobile ? false : { opacity: 0, y: 16 }}
  whileInView={{ opacity: 1, y: 0 }}
  viewport={{ once: true }}
  transition={{ duration: 0.4 }}
  className="
    mx-auto
    mt-18
    flex
    w-fit
    items-center
    gap-5
    rounded-full
    border
    border-zinc-200/80
    bg-white/85
    px-5
    py-4
    backdrop-blur-2xl
    shadow-[0_15px_40px_-25px_rgba(0,0,0,0.15)]
  "
>
  <div
    className="
      flex
      h-12
      w-12
      shrink-0
      items-center
      justify-center
      rounded-full
      bg-[#25D366]/10
    "
  >
    <MessageCircle className="h-6 w-6 text-[#25D366]" />
  </div>

  <div className="leading-none">
    <div className="text-sm font-semibold text-zinc-900">
      WhatsApp integrado
    </div>

    <div className="mt-1 text-[12px] text-zinc-500">
      Pagamento seguro • Cancelamento simples • Sarisfação Garantida
    </div>
  </div>
</motion.div>
      </div>
    </section>
  );
}
