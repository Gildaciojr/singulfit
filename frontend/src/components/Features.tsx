"use client";

import { motion } from "framer-motion";
import { ArrowRight, Brain, Camera, MessageSquare } from "lucide-react";

import { useState } from "react";
import { FeatureItem } from "@/engine/landing.types";
import { useIsMobile } from "@/hooks/use-mobile";

type Props = {
  data: FeatureItem[];
};

const icons = [MessageSquare, Camera, Brain];

export default function Features({ data }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const isMobile = useIsMobile();

  return (
    <section id="features" className="relative py-24 lg:py-32 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-emerald-50/40 to-transparent -z-20" />

      <div className="container mx-auto max-w-[1500px] px-6">
        {/* HEADER */}

        <div className="mx-auto mb-24 max-w-5xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-5 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-800 shadow-sm">
            COMO FUNCIONA
          </div>

          <h2 className="mt-8 text-5xl font-black tracking-[-0.06em] text-zinc-950 md:text-7xl">
            Três passos.
            <span className="block text-emerald-800">Nenhuma complicação.</span>
          </h2>

          <p className="mx-auto mt-8 max-w-3xl text-xl leading-9 text-zinc-600">
            A experiência foi construída para funcionar como uma conversa
            natural. Você envia. A IA entende. Você evolui.
          </p>
        </div>

        <div className="grid gap-16 lg:grid-cols-[0.75fr_1.25fr] items-center">
          {/* LEFT */}

          <div className="space-y-5">
            {data.map((item, index) => {
              const Icon = icons[index] ?? Brain;
              const active = activeIndex === index;

              return (
                <motion.button
                  key={item.id}
                  onMouseEnter={() => !isMobile && setActiveIndex(index)}
                  onClick={() => setActiveIndex(index)}
                  whileHover={{ y: -3 }}
                  className={`
                w-full text-left rounded-[2rem] p-8 transition-all duration-300
                ${
                  active
                    ? "bg-zinc-950 text-white shadow-[0_25px_60px_-20px_rgba(0,0,0,0.35)]"
                    : "bg-white border border-zinc-200 hover:border-emerald-300"
                }
              `}
                >
                  <div className="flex items-start gap-5">
                    <div
                      className={`
                    h-14 w-14 rounded-2xl flex items-center justify-center
                    ${active ? "bg-white/10" : "bg-emerald-50"}
                  `}
                    >
                      <Icon
                        className={`h-6 w-6 ${
                          active ? "text-white" : "text-emerald-800"
                        }`}
                      />
                    </div>

                    <div className="flex-1">
                      <div
                        className={`
                      text-sm font-semibold mb-2
                      ${active ? "text-emerald-300" : "text-emerald-700"}
                    `}
                      >
                        PASSO 0{index + 1}
                      </div>

                      <h3
                        className={`
                      text-xl font-bold mb-3
                      ${active ? "text-white" : "text-zinc-950"}
                    `}
                      >
                        {item.title}
                      </h3>

                      <p
                        className={
                          active
                            ? "text-zinc-300 leading-relaxed"
                            : "text-zinc-600 leading-relaxed"
                        }
                      >
                        {item.text}
                      </p>

                      <div
                        className={`
                      mt-5 inline-flex items-center gap-2 text-sm font-semibold
                      ${active ? "text-white" : "text-emerald-800"}
                    `}
                      >
                        Continuar
                        <ArrowRight className="h-4 w-4" />
                      </div>
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>

          {/* RIGHT */}

          <div className="relative">
            <motion.div
              key={data[activeIndex].media}
              initial={{ opacity: 0.6, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.35 }}
              className="
            overflow-hidden rounded-[2.5rem]
            border border-zinc-200
            bg-white
            shadow-[0_50px_120px_-35px_rgba(15,23,42,0.22)]
          "
            >
              <div className="border-b border-zinc-100 px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">
                    SingulFit AI
                  </p>

                  <p className="font-bold text-zinc-950">
                    Assistente nutricional
                  </p>
                </div>

                <div className="flex gap-2">
                  <div className="h-3 w-3 rounded-full bg-zinc-300" />
                  <div className="h-3 w-3 rounded-full bg-zinc-300" />
                  <div className="h-3 w-3 rounded-full bg-zinc-300" />
                </div>
              </div>

              <div className="bg-zinc-50 p-10">
                <img
                  src={data[activeIndex].media}
                  alt={data[activeIndex].title}
                  className="
                w-full
                rounded-[2rem]
                object-cover
                shadow-[0_30px_80px_-25px_rgba(15,23,42,0.25)]
              "
                />
              </div>
            </motion.div>

            {!isMobile && (
              <>
                <div className="absolute -left-6 top-10 rounded-2xl bg-white border border-zinc-200 px-4 py-3 shadow-xl">
                  <div className="text-xs text-zinc-500">Resposta do agente</div>

                  <div className="text-lg font-black text-zinc-950">
                    5 segundos
                  </div>
                </div>

                <div className="absolute -right-6 bottom-10 rounded-2xl bg-white border border-zinc-200 px-4 py-3 shadow-xl">
                  <div className="text-xs text-zinc-500">média de processamento</div>

                  <div className="text-lg font-black text-emerald-800">97%</div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
