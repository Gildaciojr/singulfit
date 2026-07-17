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
    <section id="features" className="relative py-18 lg:py-28 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-emerald-50/40 to-transparent -z-20" />

      <div className="container mx-auto max-w-[1500px] px-6">
        {/* HEADER */}

        <div className="mx-auto mb-20 max-w-4xl text-center lg:mb-24">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-5 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-800 shadow-sm">
            COMO FUNCIONA
          </div>

          <h2 className="mt-8 text-4xl font-black tracking-[-0.06em] text-zinc-950 md:text-6xl xl:text-7xl">
            Três passos.
            <span className="block text-emerald-800">Nenhuma complicação.</span>
          </h2>

          <p className="mx-auto mt-8 max-w-3xl text-lg leading-8 text-zinc-600 md:text-xl md:leading-9">
            Converse naturalmente pelo Whatsapp. A Singulfit analisa, aprende com sua rotina e acompanha sua evolução diariamente.
          </p>
        </div>

         <div className="grid items-start gap-8 lg:grid-cols-[0.88fr_1.12fr] xl:gap-10">
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
                  whileHover={{ y: -2 }}
                  className={`
                w-full text-left rounded-[1.5rem] px-6 py-5 transition-all duration-300
                ${
                  active
                    ? "bg-zinc-950 text-white shadow-[0_25px_60px_-20px_rgba(0,0,0,0.35)]"
                    : "bg-white border border-zinc-200 shadow-[0_8px_22px_-18px_rgba(15,23,42,.10)] hover:border-emerald-300 hover:shadow-[0_16px_35px_-24px_rgba(6,78,59,.12)]"
                }
              `}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className={`
                    h-12 w-12 rounded-xl flex items-center justify-center
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
                      text-[1.3rem] lg:text-[1.4rem] font-bold mb-3
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
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="
            overflow-hidden rounded-[1.75rem]
            border border-zinc-200
            bg-white
            shadow-[0_18px_50px_-28px_rgba(15,23,42,.16)]
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

              <div className="bg-zinc-50 p-6 lg:p-7">
                <img
                  src={data[activeIndex].media}
                  alt={data[activeIndex].title}
                  className="
                w-full
                rounded-[1.25rem]
                object-cover
                shadow-[0_10px_26px_-16px_rgba(15,23,42,.12)]
              "
                />
              </div>
            </motion.div>

            {!isMobile && (
              <>
                <div className="absolute -left-6 top-10 rounded-xl bg-white border border-zinc-200 px-4 py-3 shadow-[0_12px_30px_-18px_rgba(15,23,42,.16)]">
                  <div className="text-xs text-zinc-500">Resposta do agente</div>

                  <div className="text-lg font-black text-zinc-950">
                    5 segundos
                  </div>
                </div>

                <div className="absolute -right-6 bottom-10 rounded-xl bg-white border border-zinc-200 px-4 py-3 shadow-[0_12px_30px_-18px_rgba(15,23,42,.16)]">
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
