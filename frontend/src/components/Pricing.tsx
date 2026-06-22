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
      relative
      flex
      h-full
      flex-col
      overflow-hidden
      rounded-[2.25rem]
      border
      bg-white
      transition-all
      duration-500
      ${
        featured
          ? `
            -translate-y-2
            border-emerald-800/20
            p-8
            shadow-[0_50px_120px_-40px_rgba(6,78,59,0.30)]
            ring-1
            ring-emerald-800/10
          `
          : `
             border-zinc-200/70
             bg-[linear-gradient(180deg,#fbfbfa_0%,#f7f8f7_100%)]
            p-4
            shadow-[0_25px_70px_-45px_rgba(15,23,42,0.12)]
          `
      }
    `}
    >
      {featured && (
        <>
          <div
            className="
        absolute
        inset-0
        bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.14),transparent_55%)]
        pointer-events-none
      "
          />

          <div
            className="
        absolute
        right-5
        top-5
        flex
        items-center
        gap-3
        rounded-full
        border
        border-emerald-300/40
        bg-gradient-to-r
        from-emerald-900
        via-emerald-800
        to-emerald-700
        px-4
        py-2
        text-white
        shadow-[0_18px_45px_-18px_rgba(6,78,59,0.55)]
      "
          >
            <div
              className="
          flex
          h-7
          w-7
          items-center
          justify-center
          rounded-full
          bg-white/15
        "
            >
              <Sparkles className="h-3.5 w-3.5" />
            </div>

            <div className="leading-none">
              <div className="text-[10px] font-black uppercase tracking-[0.22em]">
                Melhor Escolha
              </div>

              <div className="mt-1 text-[11px] font-medium text-white/80">
                Preferido pelos usuários
              </div>
            </div>
          </div>
        </>
      )}

      <div className="relative mb-6">
        <div
          className={`
      mb-5
      inline-flex
      items-center
      rounded-full
      px-3.5
      py-1.5
      text-[11px]
      font-bold
      uppercase
      tracking-[0.18em]
      ${
        featured
          ? "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200"
          : "border border-zinc-200 bg-zinc-100/80 text-zinc-600"
      }
    `}
        >
          {featured ? "Experiência Premium" : "Plano Inicial"}
        </div>

        <div className="flex items-center gap-3">
          <h3
            className={`
        font-black
        tracking-[-0.05em]
        text-zinc-950
        ${featured ? "text-[2.8rem]" : "text-[1.9rem]"}
      `}
          >
            {plan.name}
          </h3>

          {featured && (
            <div
              className="
          rounded-full
          bg-emerald-100
          px-3
          py-1
          text-[11px]
          font-bold
          uppercase
          tracking-[0.12em]
          text-emerald-900
        "
            >
              Melhor custo-benefício
            </div>
          )}
        </div>

        <p
          className="
      mt-4
      min-h-[48px]
      text-[14px]
      leading-7
      text-zinc-600
    "
        >
          {plan.description}
        </p>
      </div>

      <div className="relative mb-6">
        <div className="flex items-end gap-2">
          <span
            className={`
        font-black
        tracking-[-0.07em]
        text-zinc-950
        ${featured ? "text-[4.4rem]" : "text-[3rem]"}
      `}
          >
            R$ {plan.price.toFixed(2).replace(".", ",")}
          </span>

          <span
            className={`
        pb-3
        font-medium
        ${featured ? "text-lg text-emerald-800" : "text-base text-zinc-500"}
      `}
          >
            {plan.interval}
          </span>
        </div>

        {!featured && (
          <div className="mt-2 text-xs text-zinc-500">
          </div>
        )}
      </div>

      <div
        className={`
    mt-6
    mb-6
    h-px
    w-full
    ${
      featured
        ? "bg-gradient-to-r from-transparent via-emerald-300 to-transparent"
        : "bg-zinc-200"
    }
  `}
      />

      <div className="space-y-2.5">
        {plan.features.map((feature, index) => (
          <FeatureRow key={index} label={feature.name} />
        ))}
      </div>

      {featured && (
        <div
          className="
      mt-6
      rounded-2xl
      border
      border-emerald-200
      bg-emerald-50/80
      px-4
      py-3
    "
        >
          <div className="flex items-center gap-2">
            <BadgeCheck className="h-4 w-4 text-emerald-800" />

            <span className="text-xs font-bold text-emerald-900">
              Inclui todos os recursos do Plano Básico
            </span>
          </div>
        </div>
      )}

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
    group
    mt-8
    flex
    h-12
    w-full
    items-center
    justify-center
    gap-2
    rounded-2xl
    px-6
    text-[15px]
    font-bold
    transition-all
    duration-300
    ${
      featured
        ? `
          bg-gradient-to-r
          from-emerald-900
          via-emerald-800
          to-emerald-900
          text-white
          shadow-[0_25px_55px_-20px_rgba(6,78,59,0.60)]
          hover:shadow-[0_35px_70px_-20px_rgba(6,78,59,0.70)]
        `
        : `
          border
          border-zinc-200
          bg-white
          text-zinc-950
          hover:border-emerald-500
          hover:bg-emerald-50
        `
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
    <section id="pricing" className="relative overflow-hidden py-16 lg:py-20">
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(800px_500px_at_50%_0%,rgba(34,120,84,0.08),transparent_70%)]" />

      <div className="absolute inset-0 -z-10 opacity-[0.03] bg-[linear-gradient(to_right,#111_1px,transparent_1px),linear-gradient(to_bottom,#111_1px,transparent_1px)] bg-[size:56px_56px]" />

      <div className="container mx-auto max-w-7xl px-6">
        {/* HEADER */}

        <motion.div
          initial={isMobile ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.45 }}
          className="mx-auto mb-16 max-w-4xl text-center"
        >
          <div
            className="
              inline-flex
              items-center
              rounded-full
              border
              border-emerald-200
              bg-white/80
              px-5
              py-2
              text-[11px]
              font-bold
              uppercase
              tracking-[0.22em]
              text-emerald-900
              backdrop-blur-xl
              shadow-sm
            "
          >
            Planos
          </div>

          <h2
            className="
              mt-7
              text-5xl
              font-black
              tracking-[-0.06em]
              text-zinc-950
              md:text-7xl
            "
          >
            Escolha sua evolução.
          </h2>

          <p
            className="
              mx-auto
              mt-7
              max-w-2xl
              text-lg
              leading-8
              text-zinc-600
            "
          >
            Comece hoje e tenha acompanhamento nutricional inteligente
            diretamente no WhatsApp.
          </p>
        </motion.div>

        {/* BENEFÍCIOS */}

        <motion.div
          initial={isMobile ? false : { opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.45 }}
          className="
            mx-auto
            mb-12
            flex
            flex-wrap
            items-center
            justify-center
            gap-4
          "
        >
          <div
            className="
              flex
              items-center
              gap-3
              rounded-full
              border
              border-zinc-200
              bg-white/80
              px-5
              py-3
              backdrop-blur-xl
              shadow-sm
            "
          >
            <Sparkles className="h-4 w-4 text-emerald-800" />

            <span className="text-sm font-semibold text-zinc-700">
              Acesso imediato
            </span>
          </div>

          <div
            className="
              flex
              items-center
              gap-3
              rounded-full
              border
              border-zinc-200
              bg-white/80
              px-5
              py-3
              backdrop-blur-xl
              shadow-sm
            "
          >
            <Lock className="h-4 w-4 text-emerald-800" />

            <span className="text-sm font-semibold text-zinc-700">
              Pagamento seguro
            </span>
          </div>

          <div
            className="
              flex
              items-center
              gap-3
              rounded-full
              border
              border-zinc-200
              bg-white/80
              px-5
              py-3
              backdrop-blur-xl
              shadow-sm
            "
          >
            <BadgeCheck className="h-4 w-4 text-emerald-800" />

            <span className="text-sm font-semibold text-zinc-700">
              Sem burocracia
            </span>
          </div>
        </motion.div>

        {/* PLANOS */}

        <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
          <PlanCard plan={monthly} planType="basic" />

          <PlanCard plan={annual} planType="premium" featured />
        </div>

        {/* WHATSAPP */}

        <motion.div
          initial={isMobile ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          className="
            mx-auto
            mt-14
            flex
            w-fit
            items-center
            gap-4
            rounded-full
            border
            border-zinc-200/80
            bg-white/85
            px-5
            py-3
            backdrop-blur-xl
            shadow-[0_15px_40px_-25px_rgba(0,0,0,0.15)]
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
              rounded-full
              bg-[#25D366]/10
            "
          >
            <MessageCircle className="h-5 w-5 text-[#25D366]" />
          </div>

          <div>
            <div className="text-sm font-semibold text-zinc-900">
              WhatsApp integrado
            </div>

            <div className="mt-1 text-[12px] text-zinc-500">
              Pagamento seguro • Cancelamento simples • Garantia de 7 dias
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
