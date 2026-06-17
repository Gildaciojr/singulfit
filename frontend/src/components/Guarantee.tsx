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
          <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
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
                Experimente a plataforma durante 07 dias completos. Se não fizer
                sentido para sua rotina, basta cancelar.
              </p>

              <p className="mt-4 max-w-2xl text-lg leading-8 text-zinc-600">
                Sem burocracia. Sem formulários intermináveis. Sem letras
                miúdas.
              </p>

              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-700" />
                  <span className="font-medium text-zinc-700">
                    Garantia de 07 dias
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-700" />
                  <span className="font-medium text-zinc-700">
                    Cancelamento simples
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-700" />
                  <span className="font-medium text-zinc-700">
                    Reembolso integral
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-700" />
                  <span className="font-medium text-zinc-700">
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
      gap-2
      rounded-2xl
      bg-emerald-900
      px-8
      py-4
      font-bold
      text-white
      shadow-[0_20px_45px_-18px_rgba(6,78,59,0.55)]
      transition-all
      duration-300
      hover:bg-emerald-950
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
              animate={{ y: [0, -6, 0] }}
              transition={{
                duration: 5,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              className="relative"
            >
              <div className="absolute inset-0 rounded-full bg-emerald-500/20 blur-[100px]" />

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
      p-8
      text-white
      shadow-[0_40px_100px_-35px_rgba(6,78,59,0.55)]
    "
              >
                <div
                  className="
        flex
        h-14
        w-14
        items-center
        justify-center
        rounded-2xl
        bg-white/10
      "
                >
                  <BadgeCheck className="h-7 w-7 text-white" />
                </div>

                <div className="mt-8 text-xs uppercase tracking-[0.28em] text-white/60">
                  Garantia SingulFit
                </div>

                <div className="mt-4">
                  <div className="text-[5rem] font-black leading-none tracking-[-0.06em]">
                    07
                  </div>

                  <div className="text-xl font-semibold text-white/90">
                    dias
                  </div>
                </div>

                <div className="mt-8 border-t border-white/10 pt-6">
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                      <span className="text-sm text-white/85">
                        Teste completo da plataforma
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                      <span className="text-sm text-white/85">
                        Reembolso integral
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                      <span className="text-sm text-white/85">
                        Processo simples e rápido
                      </span>
                    </div>
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
