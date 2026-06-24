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
          className="mb-6 flex justify-center"
        >
          <div className="mb-8 flex justify-center">
            <img
              src={singulfitLogo}
              alt="SingulFit"
              className="h-11 w-auto"
            />
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200/70 bg-white/70 backdrop-blur-xl px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-900 shadow-sm">
            <Sparkles className="h-4 w-4" />
            Comece hoje
          </div>
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mx-auto max-w-4xl text-4xl font-black tracking-[-0.045em] text-zinc-950 md:text-6xl"
        >
          Pronto para transformar sua alimentação?
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.58 }}
          className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-zinc-600"
        >
          A SingulFit acompanha sua rotina, entende seu contexto e ajuda você a
          criar consistência todos os dias direto pelo WhatsApp.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.65 }}
          className="mt-9 flex justify-center"
        >
          <Button
            size="lg"
            onClick={() => window.location.assign(checkoutPath("PREMIUM"))}
            className="group h-14 rounded-[1.35rem] bg-gradient-to-r from-emerald-950 via-emerald-900 to-emerald-800 px-8 text-base font-bold text-white shadow-[0_30px_60px_-25px_rgba(6,78,59,0.45)] hover:shadow-[0_40px_80px_-25px_rgba(6,78,59,0.60)]"
          >
            Começar no WhatsApp
            <ArrowRight className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" />
          </Button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55 }}
          className="mx-auto mt-10 grid max-w-3xl gap-4 md:grid-cols-3"
        >
          <div
            className="
flex
items-center
justify-center
gap-2
rounded-[1.4rem]
border
border-white/60
bg-white/70
backdrop-blur-xl
px-4
py-4
text-sm
font-semibold
text-zinc-700
shadow-[0_20px_45px_-30px_rgba(0,0,0,0.18)]
"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-800" />
            Sem aplicativo extra
          </div>

          <div
            className="
flex
items-center
justify-center
gap-2
rounded-[1.4rem]
border
border-white/60
bg-white/70
backdrop-blur-xl
px-4
py-4
text-sm
font-semibold
text-zinc-700
shadow-[0_20px_45px_-30px_rgba(0,0,0,0.18)]
"
          >
            <Sparkles className="h-4 w-4 text-emerald-800" />
            IA contextual
          </div>

          <div
            className="
flex
items-center
justify-center
gap-2
rounded-[1.4rem]
border
border-white/60
bg-white/70
backdrop-blur-xl
px-4
py-4
text-sm
font-semibold
text-zinc-700
shadow-[0_20px_45px_-30px_rgba(0,0,0,0.18)]
"
          >
            <ShieldCheck className="h-4 w-4 text-emerald-800" />
            Dados protegidos
          </div>
        </motion.div>

        <div className="mt-20 border-t border-zinc-200 pt-8">
          <div className="flex flex-col items-center justify-between gap-4 text-sm text-zinc-500 md:flex-row">
            <div>
              <div className="font-bold text-zinc-900">SingulFit</div>

              <div className="text-xs text-zinc-500">
                Nutrição inteligente via WhatsApp
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-emerald-800" />
              Pagamento seguro e cancelamento simples
            </div>

            <div className="flex items-center gap-5 text-xs">
              <a href="#faq" className="hover:text-zinc-900">
                FAQ
              </a>

              <a href="#pricing" className="hover:text-zinc-900">
                Planos
              </a>

              <a href="#guarantee" className="hover:text-zinc-900">
                Garantia
              </a>
            </div>

            <div>
              © {new Date().getFullYear()} SingulFit. Todos os direitos
              reservados.
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
