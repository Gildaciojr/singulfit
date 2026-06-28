"use client";
import { motion } from "framer-motion";
import {
  ShieldCheck,
  BadgeCheck,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
export default function Guarantee() {
  return (
    <section id="guarantee" className="relative overflow-hidden py-24 lg:py-32">
      {" "}
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(700px_420px_at_50%_20%,rgba(34,120,84,0.08),transparent_70%)]" />{" "}
      <div className="container mx-auto max-w-6xl px-6">
        {" "}
        <div className=" relative overflow-hidden rounded-[2.5rem] border border-zinc-200 bg-white p-8 shadow-[0_35px_80px_-35px_rgba(0,0,0,0.18)] lg:p-12 ">
          {" "}
          <div className="grid items-center gap-10 lg:grid-cols-[1.18fr_0.82fr]">
            {/* LADO ESQUERDO */}

            <div>
              <div
                className="
      inline-flex
      items-center
      gap-2
      rounded-full
      border
      border-emerald-200
      bg-emerald-50
      px-4
      py-2
      text-[11px]
      font-bold
      uppercase
      tracking-[0.22em]
      text-emerald-900
    "
              >
                <ShieldCheck className="h-4 w-4" />
                Garantia Total
              </div>

              <h2
                className="
      mt-6
      text-4xl
      font-black
      tracking-[-0.05em]
      text-zinc-950
      md:text-[3.4rem]
      md:leading-[1]
    "
              >
                Teste a SingulFit sem risco.
                <span className="mt-2 block text-emerald-800">
                  Você decide depois.
                </span>
              </h2>

              <p className="mt-7 max-w-2xl text-lg leading-8 text-zinc-600">
                Experimente a plataforma durante 7 dias completos. Se não fizer
                sentido para sua rotina, basta cancelar.
              </p>

              <p className="mt-4 max-w-2xl text-lg leading-8 text-zinc-600">
                Sem burocracia. Sem formulários intermináveis. Sem letras
                miúdas.
              </p>

              <div className="mt-9 grid gap-x-8 gap-y-4 sm:grid-cols-2">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-[18px] w-[18px] text-emerald-700" />
                  <span className="font-semibold text-zinc-700">
                    Garantia de 07 dias
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-700" />
                  <span className="font-semibold text-zinc-700">
                    Cancelamento simples
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-700" />
                  <span className="font-semibold text-zinc-700">
                    Reembolso integral
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-700" />
                  <span className="font-semibold text-zinc-700">
                    Sem burocracia
                  </span>
                </div>
              </div>

              <a
                href="#pricing"
                className="
      group
      mt-10
      inline-flex
      items-center
      gap-2.5
      rounded-[1.15rem]
      bg-gradient-to-r
      from-emerald-950
      via-emerald-900
      to-emerald-800
      px-7
      py-3.5
      text-[15px]
      font-semibold
      tracking-[-0.01em]
      text-white
      shadow-[0_22px_48px_-22px_rgba(6,78,59,.45)]
      transition-all
      duration-300
      hover:-translate-y-0.5
      hover:shadow-[0_28px_56px_-22px_rgba(6,78,59,.55)]
    "
              >
                Começar sem risco
                <ArrowRight
                  className="
        h-5
        w-5
        transition-transform
        duration-300
        group-hover:translate-x-1
      "
                />
              </a>
            </div>

            {/* CARD DIREITO */}

            <motion.div
              animate={{ y: [0, -4, 0] }}
              transition={{
                duration: 5,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              className="relative max-w-md mx-auto lg:ml-auto"
            >
              <div className="absolute inset-0 rounded-full bg-emerald-500/15 blur-[80px]" />

              <div
                className="
      relative
      overflow-hidden
      rounded-[2rem]
      border
      border-white/10
      bg-gradient-to-br
      from-emerald-950
      via-emerald-900
      to-emerald-800
      px-7
      py-6
      text-white
      shadow-[0_32px_70px_-34px_rgba(6,78,59,0.40)]
      lg:px-8
      lg:py-7
    "
              >
                <div className="flex items-center gap-4">
                  <div
                    className="
      flex
      h-12
      w-12
      shrink-0
      items-center
      justify-center
      rounded-xl
      border
      border-white/10
      bg-white/10
      backdrop-blur-md
    "
                  >
                    <BadgeCheck className="h-5 w-5 text-white" />
                  </div>

                  <div className="min-w-0">
                    <div
                      className="
        text-[11px]
        font-semibold
        uppercase
        tracking-[0.22em]
        text-emerald-200/90
      "
                    >
                      Garantia
                    </div>

                    <div
                      className="
        mt-1
        text-lg
        font-bold
        tracking-[-0.03em]
        text-white
      "
                    >
                      SingulFit
                    </div>
                  </div>
                </div>

                <div
                  className="
    mt-8
    flex
    items-end
    gap-3
  "
                >
                  <div
                    className="
      text-[5.2rem]
      lg:text-[5.6rem]
      font-black
      leading-[0.85]
      tracking-[-0.08em]
      text-white
    "
                  >
                    7
                  </div>

                  <div className="pb-2">
                    <div
                      className="
        text-[11px]
        font-semibold
        uppercase
        tracking-[0.22em]
        text-emerald-200
      "
                    >
                      dias de
                    </div>

                    <div
                      className="
        text-[1.5rem]
        font-bold
        tracking-[-0.03em]
        text-white
      "
                    >
                      garantia
                    </div>
                  </div>
                </div>

                <div className="mt-7 border-t border-white/10 pt-5">
                  <div className="space-y-4">
                    {[
                      "Teste completo da plataforma",
                      "Reembolso integral garantido",
                      "Cancelamento simples e imediato",
                    ].map((item) => (
                      <div
                        key={item}
                        className="
          flex
          items-center
          gap-3
          rounded-xl
          border
          border-white/5
          bg-white/[0.04]
          px-3.5
          py-3
          transition-all
          duration-300
          hover:border-emerald-400/20
          hover:bg-white/[0.06]
        "
                      >
                        <div
                          className="
            flex
            h-7
            w-7
            shrink-0
            items-center
            justify-center
            rounded-full
            bg-emerald-400/15
          "
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                        </div>

                        <span
                          className="
            text-[14px]
            font-semibold
            leading-6
            text-white/90
          "
                        >
                          {item}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
