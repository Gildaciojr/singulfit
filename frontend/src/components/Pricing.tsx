import { useCommercialOffers } from "@/hooks/useCommercialOffers";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  Lock,
  MessageCircle,
  Sparkles,
} from "lucide-react";
import { PricingPlan } from "@/engine/landing.types";
import { trackEvent } from "@/lib/tracking";

type Props = {
  data: { monthly: PricingPlan; annual: PricingPlan };
};

function FeatureRow({ label }: { label: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-800">
        <Check aria-hidden="true" className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 text-sm leading-6 text-zinc-700">{label}</span>
    </li>
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
    <article
      data-plan-type={planType}
      aria-labelledby={`pricing-${planType}-title`}
      className={`relative flex min-w-0 flex-col rounded-2xl border border-t-[3px] p-5 transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none sm:p-6 ${featured ? "border-emerald-700/50 border-t-emerald-800 bg-[#f3f9f5] shadow-[0_16px_40px_-24px_rgba(6,78,59,0.3)] [@media(hover:hover)]:hover:border-emerald-700" : "border-zinc-200 border-t-emerald-200 bg-white shadow-[0_12px_30px_-24px_rgba(6,78,59,0.2)] [@media(hover:hover)]:hover:border-emerald-300"}`}
    >
      {featured && (
        <div className="mb-4 inline-flex w-fit items-center gap-2 rounded-xl bg-emerald-900 px-3 py-2 text-white">
          <Sparkles aria-hidden="true" className="h-4 w-4 shrink-0" />
          <div>
            <p className="text-xs font-bold">Melhor Escolha</p>
            <p className="mt-0.5 text-xs leading-5 text-emerald-100">
              Preferido pelos usuários
            </p>
          </div>
        </div>
      )}
      <div>
        <span
          className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${featured ? "border-emerald-200 bg-white text-emerald-900" : "border-emerald-100 bg-emerald-50 text-emerald-800"}`}
        >
          {featured ? "Experiência Premium" : "Plano Inicial"}
        </span>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3
            id={`pricing-${planType}-title`}
            className="min-w-0 break-words text-2xl font-black tracking-[-0.04em] text-zinc-950 sm:text-3xl"
          >
            {plan.name}
          </h3>
          {featured && (
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900">
              Melhor custo-benefício
            </span>
          )}
        </div>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          {plan.description}
        </p>
      </div>
      <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className={`min-w-0 break-words font-black leading-tight tracking-[-0.05em] text-zinc-950 ${plan.price > 0 ? (featured ? "text-[2.75rem] sm:text-5xl" : "text-[2.5rem] sm:text-[2.75rem]") : "text-2xl"}`}
        >
          {plan.price > 0
            ? "R$ " + plan.price.toFixed(2).replace(".", ",")
            : "Indisponível"}
        </span>
        <span className="text-sm font-medium text-zinc-600">
          {plan.interval}
        </span>
      </div>
      <ul className="mt-5 space-y-2.5 border-t border-emerald-100 pt-5">
        {plan.features.map((feature, index) => (
          <FeatureRow key={index} label={feature.name} />
        ))}
      </ul>
      {featured && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-white/70 px-3 py-2.5">
          <BadgeCheck
            aria-hidden="true"
            className="mt-0.5 h-4 w-4 shrink-0 text-emerald-800"
          />
          <span className="text-xs font-semibold leading-5 text-emerald-900">
            Inclui todos os recursos do Plano Básico
          </span>
        </div>
      )}
      <div className="flex-1" />
      <a
        href={plan.cta?.href ?? "#pricing"}
        onClick={() => trackEvent("cta_click", { plan: planType })}
        className={`mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-center text-sm font-bold leading-5 transition-[background-color,border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 motion-reduce:transition-none ${featured ? "bg-emerald-900 text-white shadow-[0_8px_20px_-12px_rgba(6,78,59,0.4)] hover:bg-emerald-950" : "border border-emerald-200 bg-emerald-50 text-emerald-950 hover:border-emerald-400 hover:bg-emerald-100"}`}
      >
        {ctaLabel}
        <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
      </a>
    </article>
  );
}

export default function Pricing({ data }: Props) {
  const offers = useCommercialOffers();
  function presented(
    type: "BASIC" | "PREMIUM",
    original: PricingPlan,
  ): PricingPlan {
    const offer = offers.data?.[type];
    return {
      ...original,
      name: offer?.displayName ?? original.name,
      price: offer?.price ?? 0,
      description: offer?.description ?? "Oferta indisponível no momento.",
      features: offer?.features.map((name) => ({ name, included: true })) ?? [],
      cta: offer
        ? {
            text: "Conhecer esta oferta",
            href: "/checkout/" + offer.routeParam,
          }
        : { text: "Oferta indisponível", href: "#pricing" },
    };
  }
  const monthly = presented("BASIC", data.monthly);
  const annual = presented("PREMIUM", data.annual);

  return (
    <section
      id="pricing"
      aria-labelledby="pricing-title"
      className="bg-[#f8f7f3] py-12 sm:py-16"
    >
      <div className="mx-auto w-full max-w-[1040px] px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-900">
            Planos
          </span>
          <h2
            id="pricing-title"
            className="mt-4 text-[clamp(1.875rem,3.4vw,2.75rem)] font-black leading-[1.12] tracking-[-0.04em] text-zinc-950"
          >
            Escolha sua evolução.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-base leading-7 text-zinc-600">
            Comece hoje e tenha acompanhamento nutricional inteligente
            diretamente no WhatsApp.
          </p>
        </div>
        <ul
          aria-label="Resumo da experiência"
          className="mx-auto mt-5 flex max-w-2xl flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-zinc-700"
        >
          <li className="flex items-center gap-2">
            <Sparkles
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-emerald-800"
            />{" "}
            Acesso imediato
          </li>
          <li className="flex items-center gap-2">
            <Lock
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-emerald-800"
            />{" "}
            Pagamento seguro
          </li>
          <li className="flex items-center gap-2">
            <BadgeCheck
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-emerald-800"
            />{" "}
            Sem burocracia
          </li>
        </ul>
        <div className="mx-auto mt-7 grid w-full max-w-[430px] min-w-0 gap-5 md:max-w-[900px] md:grid-cols-2 md:items-center md:gap-6">
          <PlanCard plan={monthly} planType="basic" />
          <PlanCard plan={annual} planType="premium" featured />
        </div>
        <div className="mx-auto mt-6 flex max-w-xl items-start justify-center gap-3 rounded-xl border border-emerald-100 bg-white/70 p-3 sm:p-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
            <MessageCircle
              aria-hidden="true"
              className="h-4 w-4 text-emerald-800"
            />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-950">
              WhatsApp integrado
            </p>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              Nutrição inteligente • Acompanhamento no WhatsApp • Sua rotina,
              seu ritmo
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
