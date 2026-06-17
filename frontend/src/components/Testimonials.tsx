"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { TestimonialsData } from "@/engine/landing.types";
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Play,
  Quote,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

type Props = {
  data: TestimonialsData;
};

export default function Testimonials({ data }: Props) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const isInView = useInView(sectionRef, { margin: "-18%" });

  return (
    <section
      ref={sectionRef}
      id="testimonials"
      className="relative overflow-hidden py-24 lg:py-36"
    >
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(800px_500px_at_50%_0%,rgba(34,120,84,0.08),transparent_70%)]" />
      <div className="absolute inset-0 -z-10 opacity-[0.03] bg-[linear-gradient(to_right,#111_1px,transparent_1px),linear-gradient(to_bottom,#111_1px,transparent_1px)] bg-[size:56px_56px]" />

      <div className="container mx-auto max-w-7xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.45 }}
          className="mx-auto mb-16 max-w-3xl text-center"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-5 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-900 shadow-sm">
            <Sparkles className="h-4 w-4" />
            Histórias de evolução
          </div>

          <h2 className="mt-6 text-4xl font-black tracking-[-0.04em] text-zinc-950 md:text-6xl">
            Resultados reais.
            <span className="block text-emerald-800">Histórias reais.</span>
          </h2>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-zinc-600">
            Veja como a SingulFit ajuda pessoas comuns a criar consistência
            alimentar sem depender de planilhas, aplicativos complexos ou
            contagem manual.
          </p>
        </motion.div>

        <div className="grid items-start gap-8 lg:grid-cols-[0.72fr_1.28fr]">
          <motion.aside
            initial={{ opacity: 0, x: -22 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.5 }}
            className="space-y-5 lg:sticky lg:top-28"
          >
            <div className="rounded-[2rem] border border-zinc-200 bg-white p-7 shadow-[0_25px_70px_-35px_rgba(0,0,0,0.20)]">
              <div className="mb-5 inline-flex items-center rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-emerald-900">
                Uso contínuo
              </div>

              <h3 className="text-2xl font-black tracking-tight text-zinc-950">
                Por que as pessoas permanecem usando?
              </h3>

              <p className="mt-4 text-sm leading-7 text-zinc-600">
                A SingulFit foi pensada para entrar na rotina sem atrito. O
                usuário conversa pelo WhatsApp, recebe análises claras e
                constrói consistência com orientação contextual.
              </p>

              <div className="mt-6 h-px w-full bg-zinc-200" />

              <div className="mt-6 space-y-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-800" />
                  <div>
                    <h4 className="text-sm font-bold text-zinc-950">
                      Mais clareza alimentar
                    </h4>
                    <p className="mt-1 text-sm leading-6 text-zinc-600">
                      Entendimento simples sobre refeições, calorias e hábitos.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <BadgeCheck className="mt-0.5 h-5 w-5 text-emerald-800" />
                  <div>
                    <h4 className="text-sm font-bold text-zinc-950">
                      Menos esforço diário
                    </h4>
                    <p className="mt-1 text-sm leading-6 text-zinc-600">
                      Registro natural por foto, texto ou conversa no WhatsApp.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-800" />
                  <div>
                    <h4 className="text-sm font-bold text-zinc-950">
                      Evolução sem pressão
                    </h4>
                    <p className="mt-1 text-sm leading-6 text-zinc-600">
                      Acompanhamento inteligente para criar consistência real.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[2rem] border border-zinc-200 bg-zinc-950 p-7 text-white shadow-[0_30px_80px_-40px_rgba(0,0,0,0.45)]">
              <Quote className="h-7 w-7 text-emerald-300" />

              <p className="mt-5 text-lg font-semibold leading-8">
                Tecnologia boa desaparece na rotina. Você conversa, entende e
                evolui sem sentir que está usando mais um aplicativo.
              </p>

              <div className="mt-6 text-sm text-zinc-400">
                Filosofia SingulFit
              </div>
            </div>
          </motion.aside>

          <div className="space-y-8">
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.45 }}
              className="rounded-[2rem] border border-zinc-200 bg-white p-4 shadow-[0_25px_70px_-35px_rgba(0,0,0,0.22)] md:p-5"
            >
              <div className="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-center">
                <div>
                  <h3 className="text-xl font-black tracking-tight text-zinc-950">
                    Rotina real em movimento
                  </h3>

                  <p className="mt-1 text-sm leading-6 text-zinc-600">
                    Depoimentos visuais com contexto, presença e percepção de
                    uso no dia a dia.
                  </p>
                </div>

                <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-emerald-900">
                  Experiência real
                </div>
              </div>

              <div className="flex gap-5 overflow-x-auto pb-3 no-scrollbar">
                {data.videos.map((video, index) => (
                  <motion.div
                    key={`${video.src}-${index}`}
                    initial={{ opacity: 0, y: 36 }}
                    animate={isInView ? { opacity: 1, y: 0 } : {}}
                    transition={{ delay: index * 0.07 }}
                    className="min-w-[270px] md:min-w-[340px]"
                  >
                    <motion.div
                      whileHover={{ y: -6, scale: 1.02 }}
                      transition={{ duration: 0.25 }}
                      className="group relative overflow-hidden rounded-[1.75rem] border border-zinc-800 bg-black shadow-[0_30px_70px_-32px_rgba(0,0,0,0.55)]"
                    >
                      <div className="absolute left-4 top-4 z-20 rounded-full bg-white/92 px-3 py-1 text-xs font-semibold text-emerald-900 shadow">
                        Experiência real
                      </div>

                      <video
                        src={video.src}
                        poster={video.poster}
                        autoPlay={isInView}
                        loop
                        muted
                        playsInline
                        className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
                      />

                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />

                      <div className="absolute inset-0 z-10 flex items-center justify-center">
                        <motion.div
                          whileHover={{ scale: 1.06 }}
                          className="flex h-14 w-14 items-center justify-center rounded-full border border-white/50 bg-white/90 shadow-2xl backdrop-blur-md"
                        >
                          <Play className="h-5 w-5 fill-current text-emerald-900" />
                        </motion.div>
                      </div>

                      <div className="absolute bottom-0 left-0 right-0 z-10 p-5 text-white">
                        <div className="flex items-end justify-between gap-4">
                          <div>
                            <div className="text-sm font-semibold">
                              {video.person.name}, {video.person.age}
                            </div>

                            <div className="mt-1 text-xs text-white/75">
                              Usuária SingulFit
                            </div>
                          </div>

                          <div className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/90 backdrop-blur-md">
                            Vídeo
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.45 }}
              className="rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-sm"
            >
              <div className="flex flex-col items-center justify-between gap-5 text-center md:flex-row md:text-left">
                <div>
                  <div className="text-xl font-black tracking-tight text-zinc-950">
                    Nutrição inteligente. Conversa natural. Resultados
                    consistentes.
                  </div>

                  <p className="mt-2 text-sm leading-6 text-zinc-600">
                    A experiência foi criada para se encaixar na rotina sem
                    atrito, com análise alimentar e acompanhamento direto pelo
                    WhatsApp.
                  </p>
                </div>

                <div className="inline-flex shrink-0 items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-900">
                  <Sparkles className="h-4 w-4" />
                  WhatsApp-first
                </div>
              </div>
            </motion.div>

            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {data.comments.map((item, index) => (
                <motion.div
                  key={`${item.name}-${index}`}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.25 }}
                  transition={{ delay: index * 0.05 }}
                  whileHover={{ y: -5 }}
                  className="group relative overflow-hidden rounded-[1.75rem] border border-zinc-200 bg-white p-6 shadow-[0_20px_55px_-34px_rgba(0,0,0,0.22)] transition-all"
                >
                  <div className="mb-5 flex items-center justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-900">
                      <Quote className="h-5 w-5" />
                    </div>

                    <div className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                      Experiência
                    </div>
                  </div>

                  <p className="mb-6 text-sm leading-7 text-zinc-700">
                    {item.quote}
                  </p>

                  <div>
                    <div className="text-sm font-bold text-zinc-950">
                      {item.name}
                    </div>

                    <div className="mt-1 text-xs text-zinc-500">
                      {item.role}
                    </div>
                  </div>

                  <div className="absolute inset-x-0 bottom-0 h-1 w-0 bg-emerald-800 transition-all duration-300 group-hover:w-full" />
                </motion.div>
              ))}
            </div>

            <motion.div
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.45 }}
              className="rounded-[2rem] border border-zinc-200 bg-zinc-950 p-6 text-white shadow-[0_35px_90px_-45px_rgba(0,0,0,0.6)]"
            >
              <div className="flex flex-col items-center justify-between gap-5 text-center md:flex-row md:text-left">
                <div>
                  <h3 className="text-2xl font-black tracking-tight">
                    Pronto para começar sua evolução?
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-zinc-400">
                    Em menos de um minuto você já pode iniciar sua jornada pela
                    SingulFit.
                  </p>
                </div>

                <a
                  href="#pricing"
                  className="group inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-6 text-sm font-bold text-zinc-950 transition hover:bg-emerald-50"
                >
                  Ver planos
                  <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                </a>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
