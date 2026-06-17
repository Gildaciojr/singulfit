"use client";

import { motion } from "framer-motion";
import { Check, Shield, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PricingCardProps {
  title: string;
  price: string;
  period: string;
  subtitle?: string;
  badge?: string;
  checkoutUrl: string;
  highlight?: boolean;
}

const features = [
  "Registro por foto",
  "Registro por áudio",
  "IA nutricionista",
  "Histórico completo",
  "Metas automáticas",
  "Dashboard inteligente",
  "Análise completa",
  "Suporte prioritário",
];

function PricingCard({
  title,
  price,
  period,
  subtitle,
  badge,
  checkoutUrl,
  highlight,
}: PricingCardProps) {
  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 200 }}
      className={`
        relative rounded-2xl p-6 lg:p-7
        transition-all duration-500

        ${
          highlight
            ? `
            bg-gradient-to-br from-purple-700 via-purple-600 to-pink-500
            text-white
            shadow-[0_30px_80px_-20px_rgba(124,58,237,0.45)]
            scale-[1.02]
          `
            : `
            bg-white/70 backdrop-blur-xl
            border border-white/40
            shadow-[0_15px_40px_-10px_rgba(0,0,0,0.08)]
          `
        }
      `}
    >
      {/* BADGE */}
      {highlight && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <div className="flex items-center gap-2 bg-yellow-400 text-gray-900 text-xs font-bold px-4 py-1 rounded-full shadow">
            <Flame className="w-3 h-3" />
            MELHOR ESCOLHA
          </div>
        </div>
      )}

      {/* HEADER */}
      <div className="text-center mb-6">
        <h3 className={`text-xl font-bold ${highlight ? "text-white" : "text-gray-900"}`}>
          {title}
        </h3>

        <div className="mt-4">
          <span className="text-4xl lg:text-5xl font-black">
            R$ {price}
          </span>
          <span className={`ml-1 text-sm ${highlight ? "text-white/80" : "text-gray-500"}`}>
            {period}
          </span>
        </div>

        {subtitle && (
          <p className={`mt-2 text-xs ${highlight ? "text-white/70" : "text-gray-500"}`}>
            {subtitle}
          </p>
        )}
      </div>

      {/* FEATURES */}
      <div className="space-y-3 mb-6">
        {features.map((f) => (
          <div key={f} className="flex items-center gap-2 text-sm">
            <Check className={`w-4 h-4 ${highlight ? "text-white" : "text-purple-600"}`} />
            <span className={highlight ? "text-white/90" : "text-gray-700"}>
              {f}
            </span>
          </div>
        ))}
      </div>

      {/* CTA */}
      <Button
        variant={highlight ? "premium" : "outline"}
        className="w-full"
        onClick={() => window.open(checkoutUrl, "_blank")}
      >
        {highlight ? "Quero acesso completo" : "Testar por 1 mês"}
      </Button>

      {/* FOOTER */}
      <p
        className={`mt-4 text-center text-xs ${
          highlight ? "text-white/70" : "text-gray-500"
        }`}
      >
        {highlight
          ? "Mais economia + melhor experiência"
          : "Sem compromisso"}
      </p>
    </motion.div>
  );
}

export const PricingPage = () => {
  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-6">

      {/* HEADER */}
      <div className="text-center mb-12 max-w-2xl">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-gray-900">
          Invista na sua saúde por menos que um lanche
        </h1>

        <p className="mt-4 text-gray-600 text-lg">
          Tenha acesso completo ao sistema e transforme sua rotina com clareza.
        </p>
      </div>

      {/* CARDS */}
      <div className="grid md:grid-cols-2 gap-6 w-full max-w-5xl">

        <PricingCard
          title="Plano Mensal"
          price="29,99"
          period="/ mês"
          checkoutUrl="https://pay.hotmart.com/K102603335O?off=oe515n4q&checkoutMode=6"
        />

        <PricingCard
          title="Plano Anual"
          price="19,99"
          period="/ mês"
          subtitle="Cobrança de R$ 239,88 por ano"
          checkoutUrl="https://pay.hotmart.com/K102603335O?off=ms9bkn4k&checkoutMode=6"
          highlight
        />

      </div>

      {/* TRUST */}
      <div className="mt-8 flex items-center gap-2 text-gray-600">
        <Shield className="w-4 h-4" />
        <span className="text-sm">Sem compromisso • Cancele quando quiser</span>
      </div>

    </div>
  );
};