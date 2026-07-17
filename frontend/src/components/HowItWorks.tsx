"use client";

import { motion } from "framer-motion";
import {
  Camera,
  CheckCircle2,
  Clock3,
  MessageCircle,
  Sparkles,
  TrendingUp,
} from "lucide-react";

const steps = [
  {
    number: "01",
    title: "Envie uma foto",
    description:
      "Basta enviar uma foto da refeição pelo WhatsApp. Sem aplicativos, sem formulários e sem complicação.",
    icon: Camera,
  },
  {
    number: "02",
    title: "Receba análise instantânea",
    description:
      "A IA identifica alimentos, calorias, macronutrientes e contexto nutricional em poucos segundos.",
    icon: Sparkles,
  },
  {
    number: "03",
    title: "Evolua continuamente",
    description:
      "Cada refeição ajuda a IA a entender melhor seus hábitos e entregar orientações mais inteligentes.",
    icon: TrendingUp,
  },
];

export default function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="relative overflow-hidden py-16 lg:py-20"
    >
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(900px_540px_at_50%_0%,rgba(34,120,84,0.10),transparent_70%)]" />
      <div className="absolute inset-0 -z-10 opacity-[0.028] bg-[linear-gradient(to_right,#111_1px,transparent_1px),linear-gradient(to_bottom,#111_1px,transparent_1px)] bg-[size:56px_56px]" />

      <div className="container mx-auto max-w-[1500px] px-6">
        <div className="mx-auto mb-20 max-w-4xl text-center lg:mb-24">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-5 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-900 shadow-sm">
            <Sparkles className="h-3.5 w-3.5" />
            Como funciona
          </div>

          <h2 className="mt-7 text-5xl font-black tracking-[-0.06em] text-zinc-950 md:text-7xl">
            Três passos.
            <span className="block text-emerald-800">Nenhuma complicação.</span>
          </h2>

          <p className="mx-auto mt-7 max-w-3xl text-lg leading-8 text-zinc-600 md:text-xl md:leading-9">
            A experiência foi construída para funcionar como uma conversa
            natural. Você envia. A IA entende. Você evolui.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_0.88fr] xl:gap-6 items-start">
          <div className="relative">
            <div className="absolute left-4 top-10 hidden h-[calc(100%-5rem)] w-px bg-gradient-to-b from-transparent via-zinc-200/70 to-transparent md:block" />

            <div className="space-y-5">
              {steps.map((step, index) => {
                const Icon = step.icon;

                return (
                  <motion.div
                    key={step.number}
                    initial={{ opacity: 0, y: 24 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.35 }}
                    transition={{
                      duration: 0.5,
                      delay: index * 0.08,
                    }}
                    className="relative rounded-[1.75rem] border border-zinc-200/90 bg-white/92 px-6 py-5 shadow-[0_10px_24px_-18px_rgba(15,23,42,.12)] transition-all duration-300 hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-[0_24px_55px_-34px_rgba(6,78,59,.22)] md:ml-10 md:p-5"
                  >
                    <div className="absolute -left-[2.5rem] top-6 hidden h-8 w-8 items-center justify-center rounded-xl bg-emerald-900 text-[11px] font-black text-white shadow-[0_16px_35px_-16px_rgba(6,78,59,0.55)] md:flex">
                      {step.number}
                    </div>

                    <div className="flex items-start gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-900">
                        <Icon className="h-5 w-5" />
                      </div>

                      <div>
                        <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-800 md:hidden">
                          Passo {step.number}
                        </div>

                        <h3 className="text-[1.75rem] font-black tracking-[-0.04em] text-zinc-950">
                          {step.title}
                        </h3>

                        <p className="mt-2 text-sm leading-7 text-zinc-500 md:text-base md:leading-8">
                          {step.description}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>

          <div className="flex w-full flex-col justify-between gap-5 lg:py-2">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.35 }}
              transition={{ duration: 0.35, delay: 0.08 }}
              className="flex min-h-[118px] lg:min-h-[122px] items-center rounded-[1.5rem] border border-zinc-200/90 bg-white/92 px-5 py-4 shadow-[0_8px_20px_-16px_rgba(15,23,42,.10)] sm:px-6"
            >
              <div className="flex w-full flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-900">
                    <Camera className="h-5 w-5" />
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-zinc-500">
                      Foto recebida
                    </div>

                    <div className="mt-0.5 text-base font-black tracking-[-0.02em] text-zinc-950">
                      Processando refeição
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      <span className="h-2 w-2 rounded-full bg-emerald-400" />
                      <span className="h-2 w-2 rounded-full bg-emerald-300" />
                      <span className="h-2 w-2 rounded-full bg-emerald-200" />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 pl-[3.75rem] text-sm font-bold text-emerald-800 sm:pl-0">
                  <Clock3 className="h-4 w-4" />8 segundos
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.35 }}
              transition={{ duration: 0.35, delay: 0.16 }}
              className="flex min-h-[118px] lg:min-h-[122px] items-center rounded-[1.5rem] border border-zinc-200/90 bg-white/92 px-5 py-4 shadow-[0_8px_20px_-16px_rgba(15,23,42,.10)] sm:px-6"
            >
              <div className="flex w-full flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-900">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-zinc-500">
                      Análise concluída
                    </div>

                    <div className="mt-0.5 text-[1.6rem] font-black tracking-[-0.03em] text-zinc-950">
                      520 kcal
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-4 pl-[3.75rem] lg:pl-0">
                  <div className="rounded-full bg-zinc-50 px-3 py-2">
                    <div className="text-sm font-black text-zinc-950">42g</div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      Proteína
                    </div>
                  </div>

                  <div className="rounded-full bg-zinc-50 px-3 py-2">
                    <div className="text-sm font-black text-zinc-950">58g</div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      Carbo
                    </div>
                  </div>

                  <div className="rounded-full bg-zinc-50 px-3 py-2">
                    <div className="text-sm font-black text-emerald-800">
                      87
                    </div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      Qualidade
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.35 }}
              transition={{ duration: 0.35, delay: 0.24 }}
              className="flex min-h-[118px] lg:min-h-[122px] items-center rounded-[1.5rem] border border-zinc-200/90 bg-white/92 px-5 py-4 shadow-[0_8px_20px_-16px_rgba(15,23,42,.10)]sm:px-6"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-900">
                  <MessageCircle className="h-5 w-5" />
                </div>

                <div>
                  <div className="text-xs font-semibold text-zinc-500">
                    Mensagem do seu coach
                  </div>

                  <div className="mt-0.5 text-[1.05rem] font-black leading-7 tracking-[-0.02em] text-zinc-950">
                    Parabéns, você atingiu sua meta semanal!
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="
    mt-14
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
              ⚡
            </div>

            <div className="rounded-full bg-zinc-50 px-3 py-2">
              <div className="text-xl font-black tracking-[-0.04em] text-zinc-950">
                8 s
              </div>

              <div className="text-[13px] text-zinc-500">
                Análise instantânea
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
              📊
            </div>

            <div className="rounded-full bg-zinc-50 px-3 py-2">
              <div className="text-xl font-black tracking-[-0.04em] text-emerald-800">
                8.500+
              </div>

              <div className="text-[13px] text-zinc-500">
                Refeições analisadas
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
              🕒
            </div>

            <div className="rounded-full bg-zinc-50 px-3 py-2">
              <div className="text-xl font-black tracking-[-0.04em] text-zinc-950">
                24/7
              </div>

              <div className="text-[13px] text-zinc-500">Sempre disponível</div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
