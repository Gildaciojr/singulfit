"use client";

import { motion } from "framer-motion";
import { Activity, Smartphone, Watch, Zap } from "lucide-react";

export default function Integration() {
  return (
    <section
      id="integration"
      className="relative overflow-hidden py-24 lg:py-36"
    >
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(700px_400px_at_50%_0%,rgba(34,120,84,0.08),transparent_70%)]" />

      <div className="container mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-4xl text-center">
          <div
            className="
              inline-flex
              items-center
              rounded-full
              border
              border-emerald-200
              bg-white
              px-5
              py-2
              text-xs
              font-semibold
              uppercase
              tracking-[0.18em]
              text-emerald-900
              shadow-sm
            "
          >
            Ecossistema conectado
          </div>

          <h2
            className="
              mt-6
              text-4xl
              font-black
              tracking-[-0.04em]
              text-zinc-950
              md:text-6xl
            "
          >
            Seus dados trabalham
            <span className="block text-emerald-800">juntos.</span>
          </h2>

          <p
            className="
              mt-6
              text-lg
              leading-8
              text-zinc-600
            "
          >
            A SingulFit foi construída para evoluir com você. Integre atividades
            físicas, passos, calorias e informações corporais para gerar
            análises cada vez mais inteligentes.
          </p>
        </div>

        <div className="mt-16 grid gap-6 lg:grid-cols-3">
          <motion.div
            whileHover={{ y: -5 }}
            className="
              rounded-[2rem]
              border
              border-zinc-200
              bg-white
              p-8
              shadow-[0_25px_60px_-30px_rgba(0,0,0,0.18)]
            "
          >
            <div
              className="
                mb-6
                flex
                h-14
                w-14
                items-center
                justify-center
                rounded-2xl
                bg-emerald-50
              "
            >
              <Watch className="h-6 w-6 text-emerald-900" />
            </div>

            <h3 className="text-xl font-black text-zinc-950">
              Dispositivos inteligentes
            </h3>

            <p className="mt-4 text-sm leading-7 text-zinc-600">
              Sincronize dados de relógios e dispositivos para acompanhar
              atividades físicas e gasto energético.
            </p>
          </motion.div>

          <motion.div
            whileHover={{ y: -5 }}
            className="
              rounded-[2rem]
              border
              border-zinc-200
              bg-white
              p-8
              shadow-[0_25px_60px_-30px_rgba(0,0,0,0.18)]
            "
          >
            <div
              className="
                mb-6
                flex
                h-14
                w-14
                items-center
                justify-center
                rounded-2xl
                bg-emerald-50
              "
            >
              <Activity className="h-6 w-6 text-emerald-900" />
            </div>

            <h3 className="text-xl font-black text-zinc-950">
              Dados em contexto
            </h3>

            <p className="mt-4 text-sm leading-7 text-zinc-600">
              Alimentação, exercícios e hábitos passam a fazer parte da mesma
              análise inteligente.
            </p>
          </motion.div>

          <motion.div
            whileHover={{ y: -5 }}
            className="
              rounded-[2rem]
              border
              border-zinc-200
              bg-white
              p-8
              shadow-[0_25px_60px_-30px_rgba(0,0,0,0.18)]
            "
          >
            <div
              className="
                mb-6
                flex
                h-14
                w-14
                items-center
                justify-center
                rounded-2xl
                bg-emerald-50
              "
            >
              <Zap className="h-6 w-6 text-emerald-900" />
            </div>

            <h3 className="text-xl font-black text-zinc-950">
              IA mais precisa
            </h3>

            <p className="mt-4 text-sm leading-7 text-zinc-600">
              Quanto mais contexto você fornece, melhores se tornam as
              recomendações e análises da plataforma.
            </p>
          </motion.div>
        </div>

        <div
          className="
            mt-16
            rounded-[2rem]
            border
            border-zinc-200
            bg-white
            p-8
            shadow-sm
          "
        >
          <div className="flex flex-col items-center gap-8 lg:flex-row lg:justify-between">
            <div>
              <h3 className="text-2xl font-black text-zinc-950">
                Integrações planejadas
              </h3>

              <p className="mt-2 text-zinc-600">
                Expansão contínua para conectar saúde, atividade física e
                nutrição em um único lugar.
              </p>
            </div>

            <div className="flex flex-wrap justify-center gap-4">
              {["Garmin", "Strava", "Apple Health", "Google Fit"].map(
                (item) => (
                  <div
                    key={item}
                    className="
                      rounded-full
                      border
                      border-zinc-200
                      bg-zinc-50
                      px-5
                      py-3
                      text-sm
                      font-semibold
                      text-zinc-700
                    "
                  >
                    {item}
                  </div>
                ),
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
