"use client";

import { motion } from "framer-motion";
import mockupPhone from "@/assets/mockups/mockup-phone.png";
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

        <div className="grid items-center gap-16 lg:grid-cols-[0.82fr_1.18fr]">
          <div className="relative">
            <div className="absolute left-5 top-4 hidden h-[calc(100%-2rem)] w-px bg-gradient-to-b from-transparent via-zinc-200 to-transparent md:block" />

            <div className="space-y-7">
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
                    className="relative rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-[0_24px_70px_-40px_rgba(0,0,0,0.24)] transition-all duration-300 hover:-translate-y-1 hover:border-emerald-200 hover:shadow-[0_32px_90px_-46px_rgba(6,78,59,0.34)] md:ml-12 md:p-7"
                  >
                    <div className="absolute -left-[3.05rem] top-7 hidden h-10 w-10 items-center justify-center rounded-2xl bg-emerald-900 text-xs font-black text-white shadow-[0_16px_35px_-16px_rgba(6,78,59,0.55)] md:flex">
                      {step.number}
                    </div>

                    <div className="flex items-start gap-5">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-900">
                        <Icon className="h-6 w-6" />
                      </div>

                      <div>
                        <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-800 md:hidden">
                          Passo {step.number}
                        </div>

                        <h3 className="text-2xl font-black tracking-[-0.03em] text-zinc-950">
                          {step.title}
                        </h3>

                        <p className="mt-3 text-sm leading-7 text-zinc-600 md:text-base md:leading-8">
                          {step.description}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.98 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="relative mx-auto flex min-h-[620px] w-full max-w-[720px] items-center justify-center"
          >
            <div className="absolute left-1/2 top-1/2 h-[620px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-800/10 blur-[120px]" />

            <div className="absolute left-1/2 top-1/2 h-[470px] w-[470px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-900/[0.06]" />

            <motion.img
              src={mockupPhone}
              alt="Demonstração da análise nutricional no WhatsApp"
              className="relative z-20 w-full max-w-[430px] drop-shadow-[0_46px_95px_rgba(15,23,42,0.26)]"
              animate={{ y: [0, -9, 0] }}
              transition={{
                duration: 6,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />

            <motion.div
              initial={{ opacity: 0, x: -24, y: 14 }}
              whileInView={{ opacity: 1, x: 0, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.25, duration: 0.5 }}
              className="absolute left-0 top-[18%] z-30 hidden w-[235px] rounded-[1.5rem] border border-zinc-200 bg-white/92 p-5 shadow-[0_30px_70px_-32px_rgba(0,0,0,0.34)] backdrop-blur-2xl lg:block"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-900">
                  <Camera className="h-5 w-5" />
                </div>

                <div>
                  <div className="text-xs font-semibold text-zinc-500">
                    Foto recebida
                  </div>
                  <div className="mt-0.5 text-sm font-black text-zinc-950">
                    Processando refeição
                  </div>
                </div>
              </div>

              <div className="mt-5 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="h-2 w-2 rounded-full bg-emerald-300" />
                <span className="h-2 w-2 rounded-full bg-emerald-200" />
              </div>

              <div className="mt-4 flex items-center gap-2 text-sm font-bold text-emerald-800">
                <Clock3 className="h-4 w-4" />8 segundos
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 24, y: 14 }}
              whileInView={{ opacity: 1, x: 0, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.38, duration: 0.5 }}
              className="absolute bottom-[15%] right-0 z-30 hidden w-[260px] rounded-[1.5rem] border border-zinc-200 bg-white/92 p-5 shadow-[0_30px_70px_-32px_rgba(0,0,0,0.34)] backdrop-blur-2xl lg:block"
            >
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-zinc-500">
                    Análise concluída
                  </div>
                  <div className="mt-1 text-2xl font-black text-zinc-950">
                    520 kcal
                  </div>
                </div>

                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-900 text-white">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-2xl bg-zinc-50 px-2 py-3">
                  <div className="text-sm font-black text-zinc-950">42g</div>
                  <div className="mt-1 text-[10px] text-zinc-500">Proteína</div>
                </div>

                <div className="rounded-2xl bg-zinc-50 px-2 py-3">
                  <div className="text-sm font-black text-zinc-950">58g</div>
                  <div className="mt-1 text-[10px] text-zinc-500">Carbo</div>
                </div>

                <div className="rounded-2xl bg-zinc-50 px-2 py-3">
                  <div className="text-sm font-black text-emerald-800">87</div>
                  <div className="mt-1 text-[10px] text-zinc-500">
                    Qualidade
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.55 }}
          className="mt-20 grid gap-4 rounded-[2rem] border border-zinc-200 bg-white/90 p-7 shadow-[0_24px_70px_-45px_rgba(0,0,0,0.22)] backdrop-blur-xl md:grid-cols-3 lg:mt-24"
        >
          <div className="text-center">
            <div className="text-3xl font-black text-zinc-950">8 segundos</div>
            <div className="mt-2 text-sm text-zinc-500">
              Tempo médio de análise
            </div>
          </div>

          <div className="text-center">
            <div className="text-3xl font-black text-emerald-800">+8.500</div>
            <div className="mt-2 text-sm text-zinc-500">
              Refeições analisadas
            </div>
          </div>

          <div className="text-center">
            <div className="text-3xl font-black text-zinc-950">24h</div>
            <div className="mt-2 text-sm text-zinc-500">
              Disponível todos os dias
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
