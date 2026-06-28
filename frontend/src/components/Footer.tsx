"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  CheckCircle2,
  Lock,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { checkoutPath } from "@/lib/commercial-plans";
import singulfitLogo from "@/assets/images/singulfit-logo.webp";

export default function Footer() {
  return (
    <footer className="relative overflow-hidden">
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(800px_500px_at_50%_0%,rgba(34,120,84,0.10),transparent_70%)]" />
      <div className="absolute inset-0 -z-10 opacity-[0.03] bg-[linear-gradient(to_right,#111_1px,transparent_1px),linear-gradient(to_bottom,#111_1px,transparent_1px)] bg-[size:56px_56px]" />

      <div className="container relative z-10 mx-auto max-w-6xl px-6 py-16 lg:py-36  text-center">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.45 }}
          className="flex flex-col items-center"
        >
          <img src={singulfitLogo} alt="SingulFit" className="h-10 w-auto" />

          <div
            className="
      mt-6
      inline-flex
      items-center
      gap-2
      rounded-full
      border
      border-emerald-100
      bg-white/80
      px-4
      py-2
      backdrop-blur-xl
      shadow-[0_10px_30px_-22px_rgba(15,23,42,.10)]
    "
          >
            <Sparkles className="h-3.5 w-3.5 text-emerald-700" />

            <span
              className="
        text-[10px]
        font-semibold
        uppercase
        tracking-[0.22em]
        text-emerald-900
      "
            >
              Comece hoje
            </span>
          </div>
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="
    mx-auto
    mt-8
    max-w-3xl
    text-4xl
    font-black
    leading-[1.05]
    tracking-[-0.055em]
    text-zinc-950
    md:text-6xl
  "
        >
          Pronto para transformar
          <span className="block text-emerald-800">sua alimentação?</span>
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.58 }}
          className="
    mx-auto
    mt-7
    max-w-xl
    text-[17px]
    leading-8
    text-zinc-600
  "
        >
          A SingulFit entende seu contexto, acompanha sua evolução e transforma
          conversas no WhatsApp em hábitos alimentares consistentes.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.65 }}
          className="mt-10 flex justify-center"
        >
          <Button
            size="lg"
            onClick={() => window.location.assign(checkoutPath("PREMIUM"))}
            className="
      group
      h-13
      rounded-full
      bg-emerald-900
      px-8
      text-[15px]
      font-semibold
      text-white
      shadow-[0_20px_45px_-22px_rgba(6,78,59,.35)]
      transition-all
      duration-300
      hover:-translate-y-0.5
      hover:bg-emerald-950
      hover:shadow-[0_28px_55px_-22px_rgba(6,78,59,.42)]
    "
          >
            Começar no WhatsApp
            <ArrowRight
              className="
        ml-2
        h-4
        w-4
        transition-transform
        duration-300
        group-hover:translate-x-1
      "
            />
          </Button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55 }}
          className="
    mx-auto
    mt-12
    flex
    flex-wrap
    items-center
    justify-center
    gap-4
  "
        >
          <div
            className="
      inline-flex
      items-center
      gap-3
      rounded-full
      border
      border-zinc-200
      bg-white/80
      px-5
      py-3
      backdrop-blur-xl
      shadow-[0_12px_35px_-24px_rgba(15,23,42,.14)]
      transition-all
      duration-300
      hover:-translate-y-0.5
      hover:border-emerald-200
    "
          >
            <div
              className="
        flex
        h-9
        w-9
        items-center
        justify-center
        rounded-full
        bg-emerald-50
      "
            >
              <CheckCircle2 className="h-4 w-4 text-emerald-800" />
            </div>

            <div className="text-left">
              <div className="text-sm font-semibold text-zinc-900">
                Sem aplicativo
              </div>

              <div className="text-xs text-zinc-500">Tudo pelo WhatsApp</div>
            </div>
          </div>

          <div
            className="
      inline-flex
      items-center
      gap-3
      rounded-full
      border
      border-zinc-200
      bg-white/80
      px-5
      py-3
      backdrop-blur-xl
      shadow-[0_12px_35px_-24px_rgba(15,23,42,.14)]
      transition-all
      duration-300
      hover:-translate-y-0.5
      hover:border-emerald-200
    "
          >
            <div
              className="
        flex
        h-9
        w-9
        items-center
        justify-center
        rounded-full
        bg-emerald-50
      "
            >
              <Sparkles className="h-4 w-4 text-emerald-800" />
            </div>

            <div className="text-left">
              <div className="text-sm font-semibold text-zinc-900">
                IA Contextual
              </div>

              <div className="text-xs text-zinc-500">
                Aprende com sua rotina
              </div>
            </div>
          </div>

          <div
            className="
      inline-flex
      items-center
      gap-3
      rounded-full
      border
      border-zinc-200
      bg-white/80
      px-5
      py-3
      backdrop-blur-xl
      shadow-[0_12px_35px_-24px_rgba(15,23,42,.14)]
      transition-all
      duration-300
      hover:-translate-y-0.5
      hover:border-emerald-200
    "
          >
            <div
              className="
        flex
        h-9
        w-9
        items-center
        justify-center
        rounded-full
        bg-emerald-50
      "
            >
              <ShieldCheck className="h-4 w-4 text-emerald-800" />
            </div>

            <div className="text-left">
              <div className="text-sm font-semibold text-zinc-900">
                Dados protegidos
              </div>

              <div className="text-xs text-zinc-500">
                Segurança e privacidade
              </div>
            </div>
          </div>
        </motion.div>

        <div className="mt-20 border-t border-zinc-200/70 pt-8">
          <div
            className="
      flex
      flex-col
      items-center
      gap-8
      lg:flex-row
      lg:justify-between
    "
          >
            {/* Marca */}

            <div className="text-center lg:text-left">
              <div
                className="
          text-lg
          font-black
          tracking-[-0.03em]
          text-zinc-950
        "
              >
                SingulFit
              </div>

              <p
                className="
          mt-1
          text-sm
          leading-6
          text-zinc-500
        "
              >
                Nutrição inteligente.
                <br />
                Conversa natural.
              </p>
            </div>

            {/* Segurança */}

            <div
              className="
        inline-flex
        items-center
        gap-3
        rounded-full
        border
        border-zinc-200
        bg-white/75
        px-5
        py-3
        backdrop-blur-xl
      "
            >
              <div
                className="
          flex
          h-9
          w-9
          items-center
          justify-center
          rounded-full
          bg-emerald-50
        "
              >
                <Lock className="h-4 w-4 text-emerald-800" />
              </div>

              <div className="text-left">
                <div className="text-sm font-semibold text-zinc-900">
                  Checkout seguro
                </div>

                <div className="text-xs text-zinc-500">
                  Cancelamento quando desejar
                </div>
              </div>
            </div>

            {/* Navegação */}

            <nav
              className="
        flex
        flex-wrap
        items-center
        justify-center
        gap-6
        text-sm
      "
            >
              <a
                href="#pricing"
                className="transition-colors hover:text-emerald-800"
              >
                Planos
              </a>

              <a
                href="#faq"
                className="transition-colors hover:text-emerald-800"
              >
                FAQ
              </a>

              <a
                href="#guarantee"
                className="transition-colors hover:text-emerald-800"
              >
                Garantia
              </a>
            </nav>
          </div>

          {/* Copyright */}

          <div
            className="
      mt-8
      border-t
      border-zinc-100
      pt-6
      text-center
      text-xs
      text-zinc-400
    "
          >
            © {new Date().getFullYear()} SingulFit • Todos os direitos
            reservados.
          </div>
        </div>
      </div>
    </footer>
  );
}
