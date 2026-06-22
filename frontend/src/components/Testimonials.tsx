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
  const hasVideos = data.videos.length > 0;

  return (
    <section
      ref={sectionRef}
      id="testimonials"
      className="relative overflow-hidden py-16 lg:py-20"
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
            className="space-y-4 lg:sticky lg:top-24"
          >
            <div
              className="
      overflow-hidden
      rounded-[1.75rem]
      border
      border-zinc-200
      bg-white/85
      p-6
      backdrop-blur-xl
      shadow-[0_20px_60px_-35px_rgba(0,0,0,0.18)]
    "
            >
              <div
                className="
        inline-flex
        items-center
        rounded-full
        bg-emerald-50
        px-3
        py-1.5
        text-[11px]
        font-bold
        uppercase
        tracking-[0.18em]
        text-emerald-900
      "
              >
                Uso diário
              </div>

              <h3
                className="
        mt-5
        text-[1.75rem]
        font-black
        leading-tight
        tracking-[-0.04em]
        text-zinc-950
      "
              >
                Feito para entrar na rotina.
              </h3>

              <p
                className="
        mt-4
        text-[14px]
        leading-7
        text-zinc-600
      "
              >
                Sem aplicativos complexos. Sem planilhas. Apenas uma conversa
                natural pelo WhatsApp.
              </p>

              <div className="mt-6 space-y-3">
                <div
                  className="
          flex
          items-center
          gap-3
          rounded-2xl
          bg-zinc-50
          px-4
          py-3
        "
                >
                  <CheckCircle2 className="h-4 w-4 text-emerald-800" />

                  <span className="text-sm font-medium text-zinc-700">
                    Mais clareza alimentar
                  </span>
                </div>

                <div
                  className="
          flex
          items-center
          gap-3
          rounded-2xl
          bg-zinc-50
          px-4
          py-3
        "
                >
                  <BadgeCheck className="h-4 w-4 text-emerald-800" />

                  <span className="text-sm font-medium text-zinc-700">
                    Menos esforço diário
                  </span>
                </div>

                <div
                  className="
          flex
          items-center
          gap-3
          rounded-2xl
          bg-zinc-50
          px-4
          py-3
        "
                >
                  <ShieldCheck className="h-4 w-4 text-emerald-800" />

                  <span className="text-sm font-medium text-zinc-700">
                    Evolução consistente
                  </span>
                </div>
              </div>
            </div>

            <div
              className="
      overflow-hidden
      rounded-[1.75rem]
      bg-gradient-to-br
      from-emerald-950
      via-emerald-900
      to-emerald-800
      p-6
      text-white
      shadow-[0_25px_70px_-35px_rgba(6,78,59,0.55)]
    "
            >
              <Quote className="h-6 w-6 text-emerald-300" />

              <p
                className="
        mt-4
        text-base
        font-semibold
        leading-7
      "
              >
                A melhor tecnologia é aquela que desaparece e deixa apenas o
                resultado.
              </p>

              <div
                className="
        mt-4
        text-xs
        uppercase
        tracking-[0.18em]
        text-white/60
      "
              >
                Filosofia SingulFit
              </div>
            </div>
          </motion.aside>
          <div className="space-y-8">
            {hasVideos ? (
              <div
                className="
    mb-6
    flex
    flex-col
    gap-4
    rounded-[2rem]
    border
    border-zinc-200
    bg-gradient-to-br
    from-white
    via-white
    to-emerald-50/40
    p-5
    shadow-[0_25px_60px_-40px_rgba(0,0,0,0.18)]
  "
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div
                      className="
          mb-3
          inline-flex
          items-center
          gap-2
          rounded-full
          border
          border-emerald-200
          bg-emerald-50
          px-3
          py-1.5
          text-[11px]
          font-bold
          uppercase
          tracking-[0.18em]
          text-emerald-900
        "
                    >
                      <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      Uso real
                    </div>

                    <h3
                      className="
          text-[2rem]
          font-black
          tracking-[-0.05em]
          text-zinc-950
        "
                    >
                      Resultados que fazem parte da rotina
                    </h3>

                    <p
                      className="
          mt-2
          max-w-2xl
          text-sm
          leading-7
          text-zinc-600
        "
                    >
                      Pessoas reais utilizando a SingulFit diariamente para
                      criar hábitos, melhorar a alimentação e manter
                      consistência sem esforço.
                    </p>
                  </div>

                  <div
                    className="
        inline-flex
        w-fit
        items-center
        gap-2
        rounded-full
        bg-zinc-950
        px-4
        py-2
        text-xs
        font-bold
        uppercase
        tracking-[0.18em]
        text-white
      "
                  >
                    <div className="h-2 w-2 rounded-full bg-emerald-400" />
                    Depoimentos verificados
                  </div>
                </div>

                <div className="flex gap-5 overflow-x-auto pb-2 no-scrollbar">
                  {data.videos.map((video, index) => (
                    <motion.div
                      key={`${video.src}-${index}`}
                      initial={{ opacity: 0, y: 28 }}
                      animate={isInView ? { opacity: 1, y: 0 } : {}}
                      transition={{ delay: index * 0.06 }}
                      className="min-w-[290px] md:min-w-[360px]"
                    >
                      <motion.div
                        whileHover={{
                          y: -4,
                        }}
                        transition={{ duration: 0.25 }}
                        className="
            group
            relative
            overflow-hidden
            rounded-[1.75rem]
            border
            border-zinc-800
            bg-zinc-950
            shadow-[0_35px_70px_-35px_rgba(0,0,0,0.55)]
          "
                      >
                        <div
                          className="
              absolute
              left-4
              top-4
              z-20
              rounded-full
              bg-white/95
              px-3
              py-1
              text-[11px]
              font-bold
              uppercase
              tracking-[0.16em]
              text-emerald-900
            "
                        >
                          Caso real
                        </div>

                        <video
                          src={video.src}
                          poster={video.poster}
                          autoPlay={isInView}
                          loop
                          muted
                          playsInline
                          className="
              h-[190px]
              w-full
              object-cover
              transition
              duration-700
              group-hover:scale-105
            "
                        />

                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />

                        <div className="absolute inset-0 z-10 flex items-center justify-center">
                          <motion.div
                            whileHover={{ scale: 1.08 }}
                            className="
                flex
                h-12
                w-12
                items-center
                justify-center
                rounded-full
                bg-white/95
                shadow-xl
              "
                          >
                            <Play className="h-4 w-4 fill-current text-emerald-900" />
                          </motion.div>
                        </div>

                        <div className="absolute bottom-0 left-0 right-0 z-10 p-5">
                          <div className="flex items-end justify-between gap-4">
                            <div>
                              <div className="text-base font-bold text-white">
                                {video.person.name}
                              </div>

                              <div className="mt-1 text-xs text-white/70">
                                {video.person.age} anos • Usuária SingulFit
                              </div>
                            </div>

                            <div
                              className="
                  rounded-full
                  border
                  border-white/15
                  bg-white/10
                  px-3
                  py-1
                  text-[10px]
                  font-bold
                  uppercase
                  tracking-[0.18em]
                  text-white
                  backdrop-blur-md
                "
                            >
                              Vídeo
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    </motion.div>
                  ))}
                </div>
              </div>
            ) : null}

            <motion.div
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45 }}
              className="flex justify-center"
            >
              <div
                className="
      inline-flex
      items-center
      gap-4
      rounded-full
      border
      border-zinc-200
      bg-white/90
      px-5
      py-3
      backdrop-blur-xl
      shadow-[0_18px_40px_-28px_rgba(0,0,0,0.18)]
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
      "
                >
                  <Sparkles className="h-4 w-4 text-emerald-800" />
                </div>

                <div>
                  <div className="text-sm font-bold text-zinc-950">
                    Nutrição inteligente via WhatsApp
                  </div>

                  <div className="mt-1 text-xs text-zinc-500">
                    Sem aplicativos extras • Simples • Natural
                  </div>
                </div>

                <div
                  className="
        hidden
        md:inline-flex
        items-center
        rounded-full
        bg-emerald-900
        px-3
        py-1.5
        text-[10px]
        font-bold
        uppercase
        tracking-[0.18em]
        text-white
      "
                >
                  WhatsApp First
                </div>
              </div>
            </motion.div>

            <div className="grid gap-4 md:grid-cols-2">
              {data.comments.map((item, index) => (
                <motion.div
                  key={`${item.name}-${index}`}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.04 }}
                  whileHover={{ y: -4 }}
                  className="
        group
        rounded-[1.5rem]
        border
        border-zinc-200
        bg-white
        p-5
        shadow-[0_18px_40px_-30px_rgba(0,0,0,0.18)]
        transition-all
      "
                >
                  <div className="mb-4 flex items-center justify-between">
                    <div
                      className="
            flex
            h-10
            w-10
            items-center
            justify-center
            rounded-2xl
            bg-emerald-50
            text-emerald-900
          "
                    >
                      <Quote className="h-4 w-4" />
                    </div>

                    <div
                      className="
            rounded-full
            bg-zinc-100
            px-3
            py-1
            text-[10px]
            font-bold
            uppercase
            tracking-[0.18em]
            text-zinc-500
          "
                    >
                      Verificado
                    </div>
                  </div>

                  <p
                    className="
          text-sm
          leading-7
          text-zinc-700
        "
                  >
                    {item.quote}
                  </p>

                  <div className="mt-5">
                    <div className="font-bold text-zinc-950">{item.name}</div>

                    <div className="mt-1 text-xs text-zinc-500">
                      {item.role}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            <motion.div
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45 }}
              className="
    relative
    overflow-hidden
    rounded-[2rem]
    bg-gradient-to-br
    from-zinc-950
    via-zinc-900
    to-emerald-950
    p-8
    text-white
    shadow-[0_40px_100px_-45px_rgba(0,0,0,0.65)]
  "
            >
              <div
                className="
      absolute
      right-0
      top-0
      h-40
      w-40
      rounded-full
      bg-emerald-500/10
      blur-[80px]
    "
              />

              <div className="relative z-10">
                <div
                  className="
        mb-4
        inline-flex
        items-center
        gap-2
        rounded-full
        bg-white/10
        px-4
        py-2
        text-xs
        font-bold
        uppercase
        tracking-[0.18em]
      "
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Comece hoje
                </div>

                <h3
                  className="
        max-w-2xl
        text-4xl
        font-black
        tracking-[-0.05em]
      "
                >
                  Sua evolução começa na próxima mensagem.
                </h3>

                <p
                  className="
        mt-4
        max-w-xl
        text-sm
        leading-7
        text-white/75
      "
                >
                  Em menos de um minuto você pode iniciar sua jornada, receber
                  orientações e começar a construir consistência diretamente
                  pelo WhatsApp.
                </p>

                <div className="mt-7">
                  <a
                    href="#pricing"
                    className="
          group
          inline-flex
          h-12
          items-center
          justify-center
          gap-2
          rounded-2xl
          bg-white
          px-6
          text-sm
          font-bold
          text-zinc-950
          transition-all
          hover:scale-[1.02]
        "
                  >
                    Ver planos
                    <ArrowRight
                      className="
            h-4
            w-4
            transition-transform
            duration-300
            group-hover:translate-x-1
          "
                    />
                  </a>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
