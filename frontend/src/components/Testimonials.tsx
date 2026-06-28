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
          transition={{ duration: 0.55 }}
          className="mx-auto mb-20 max-w-[780px] text-center"
        >
          <div
            className="
    inline-flex
    items-center
    gap-2
    rounded-full
    border
    border-emerald-100
    bg-white/85
    px-4
    py-2
    backdrop-blur-xl
    shadow-[0_12px_35px_-24px_rgba(15,23,42,.12)]
  "
          >
            <Sparkles className="h-3.5 w-3.5 text-emerald-700" />

            <span
              className="
      text-[11px]
      font-semibold
      uppercase
      tracking-[0.20em]
      text-emerald-900
    "
            >
              Pessoas reais • Resultados reais
            </span>
          </div>

          <h2
            className="
    mt-7
    text-4xl
    font-black
    leading-[1.05]
    tracking-[-0.055em]
    text-zinc-950
    md:text-6xl
  "
          >
            Quem usa,
            <span className="block text-emerald-800">continua usando.</span>
          </h2>

          <p
            className="
    mx-auto
    mt-7
    max-w-[650px]
    text-[18px]
    leading-9
    text-zinc-600
  "
          >
            A melhor prova de que uma tecnologia funciona é quando ela se torna
            parte da rotina. Veja como pessoas comuns transformaram sua
            alimentação apenas conversando naturalmente pelo WhatsApp.
          </p>
        </motion.div>

        <div className="grid items-start gap-8 lg:grid-cols-[0.72fr_1.28fr]">
          <motion.aside
            initial={{ opacity: 0, x: -24 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.55 }}
            className="space-y-6 lg:sticky lg:top-24"
          >
            <div
              className="
      overflow-hidden
      rounded-[2rem]
      border
      border-zinc-200/70
      bg-white/82
      p-7
      backdrop-blur-2xl
      shadow-[0_28px_70px_-42px_rgba(15,23,42,.18)]
    "
            >
              <div
                className="
        inline-flex
        items-center
        gap-2
        rounded-full
        border
        border-emerald-100
        bg-emerald-50/80
        px-3.5
        py-1.5
      "
              >
                <Sparkles className="h-3.5 w-3.5 text-emerald-700" />

                <span
                  className="
          text-[11px]
          font-semibold
          uppercase
          tracking-[0.18em]
          text-emerald-900
        "
                >
                  Experiência simples
                </span>
              </div>

              <h3
                className="
        mt-6
        text-[2rem]
        font-black
        leading-[1.05]
        tracking-[-0.05em]
        text-zinc-950
      "
              >
                Uma conversa.
                <br />
                Todo o acompanhamento.
              </h3>

              <p
                className="
        mt-5
        text-[15px]
        leading-8
        text-zinc-600
      "
              >
                A SingulFit elimina aplicativos complexos, planilhas e cadastros
                intermináveis. Você simplesmente conversa pelo WhatsApp enquanto
                a IA acompanha sua evolução.
              </p>

              <div className="mt-8 space-y-3">
                {[
                  "Conversa totalmente natural",
                  "Nutrição adaptada ao seu contexto",
                  "Evolução acompanhada diariamente",
                ].map((item) => (
                  <div
                    key={item}
                    className="
            flex
            items-center
            gap-3
            rounded-2xl
            border
            border-zinc-100
            bg-zinc-50/70
            px-4
            py-3.5
            transition-all
            duration-300
            hover:border-emerald-100
            hover:bg-emerald-50/40
          "
                  >
                    <div
                      className="
              flex
              h-8
              w-8
              items-center
              justify-center
              rounded-full
              bg-emerald-100
            "
                    >
                      <CheckCircle2 className="h-4 w-4 text-emerald-800" />
                    </div>

                    <span
                      className="
              text-[15px]
              font-medium
              text-zinc-700
            "
                    >
                      {item}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div
              className="
    overflow-hidden
    rounded-[1.5rem]
    border
    border-emerald-100
    bg-gradient-to-r
    from-emerald-50
    via-white
    to-emerald-50/60
    p-5
    shadow-[0_16px_45px_-30px_rgba(6,78,59,.12)]
  "
            >
              <div className="flex items-start gap-4">
                <div
                  className="
        flex
        h-11
        w-11
        shrink-0
        items-center
        justify-center
        rounded-2xl
        bg-emerald-900
        text-white
      "
                >
                  <Quote className="h-4 w-4" />
                </div>

                <div>
                  <div
                    className="
          text-[11px]
          font-semibold
          uppercase
          tracking-[0.18em]
          text-emerald-700
        "
                  >
                    Filosofia SingulFit
                  </div>

                  <p
                    className="
          mt-2
          text-[15px]
          font-semibold
          leading-7
          text-zinc-800
        "
                  >
                    A melhor tecnologia é aquela que desaparece.
                    <br />
                    Você percebe apenas os resultados.
                  </p>
                </div>
              </div>
            </div>
          </motion.aside>
          <div className="space-y-8">
            <div
              className="
    inline-flex
    items-center
    gap-2
    rounded-full
    border
    border-emerald-100
    bg-emerald-50/80
    px-3.5
    py-1.5
  "
            >
              <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />

              <span
                className="
      text-[11px]
      font-semibold
      uppercase
      tracking-[0.18em]
      text-emerald-900
    "
              >
                Depoimentos verificados
              </span>
            </div>

            <div className="flex gap-5 overflow-x-auto pb-2 no-scrollbar">
              {data.videos.map((video, index) => (
                <motion.div
                  key={`${video.src}-${index}`}
                  initial={{ opacity: 0, y: 28 }}
                  animate={isInView ? { opacity: 1, y: 0 } : {}}
                  transition={{ delay: index * 0.06 }}
                  className="min-w-[310px] md:min-w-[385px]"
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
            rounded-[1.2rem]
            border
            border-white/10
            bg-zinc-950
            shadow-[0_45px_90px_-42px_rgba(15,23,42,.45)]
          "
                  >
                    <div
                      className="
              absolute
              left-4
              top-4
              z-20
              rounded-full
              bg-white/90
              px-4
              py-1.5
              text-[10px]
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
              h-[240px]
              w-full
              object-cover
              transition
              duration-700
              group-hover:scale-105
            "
                    />

                    <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/35 to-transparent" />

                    <div className="absolute inset-0 z-10 flex items-center justify-center">
                      <motion.div
                        whileHover={{ scale: 1.08 }}
                        className="
                flex
                h-14
                w-14
                items-center
                justify-center
                rounded-full
                bg-white/92
                shadow-[0_18px_40px_-18px_rgba(0,0,0,.30)]
              "
                      >
                        <Play className="h-4 w-4 fill-current text-emerald-900" />
                      </motion.div>
                    </div>

                    <div className="absolute bottom-0 left-0 right-0 z-10 px-6 py-5">
                      <div className="flex items-end justify-between gap-4">
                        <div>
                          <div className="text-[15px] font-bold text-white">
                            {video.person.name}
                          </div>

                          <div className="mt-1 text-[12px] text-white/70">
                            {video.person.age} anos • Usuária SingulFit
                          </div>
                        </div>

                        <div
                          className="
                  rounded-full
                  border
                  border-white/20
                  bg-white/12
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
