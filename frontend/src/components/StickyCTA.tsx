"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles, ShieldCheck, CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";

export default function StickyCTA() {
  const [isVisible, setIsVisible] = useState(false);
  const [footerInView, setFooterInView] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsVisible(window.scrollY > 500);
    };

    handleScroll();

    window.addEventListener("scroll", handleScroll, {
      passive: true,
    });

    const footer = document.querySelector("footer");

    let observer: IntersectionObserver | null = null;

    if (footer) {
      observer = new IntersectionObserver(
        ([entry]) => {
          setFooterInView(entry.isIntersecting);
        },
        {
          threshold: 0.15,
        },
      );

      observer.observe(footer);
    }

    return () => {
      window.removeEventListener("scroll", handleScroll);

      if (observer) {
        observer.disconnect();
      }
    };
  }, []);

  return (
    <AnimatePresence>
      {isVisible && !footerInView && (
        <motion.div
          initial={{ y: 90, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 90, opacity: 0 }}
          transition={{
            duration: 0.45,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="
            fixed
            bottom-5
            left-1/2
            z-50
            w-[94%]
            max-w-2xl
            -translate-x-1/2
          "
        >
          <motion.div
            animate={{
              y: [0, -3, 0],
            }}
            transition={{
              duration: 5,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          >
            <div
              className="
                overflow-hidden
                rounded-[2rem]
                border
                border-zinc-200
                bg-white/92
                backdrop-blur-2xl
                shadow-[0_30px_80px_-35px_rgba(0,0,0,0.28)]
              "
            >
              {/* LIGHT */}
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(6,95,70,0.06),transparent_60%)]" />

              {/* TOP BAR */}
              <div className="border-b border-zinc-100 px-4 py-2">
                <div
                  className="
                    inline-flex
                    items-center
                    gap-2
                    rounded-full
                    bg-emerald-50
                    px-3
                    py-1
                    text-[10px]
                    font-bold
                    uppercase
                    tracking-[0.18em]
                    text-emerald-900
                  "
                >
                  <Sparkles className="h-3 w-3" />
                  SingulFit AI
                </div>
              </div>

              <div className="relative px-4 py-4 md:px-5">
                <div className="flex items-center gap-4">
                  <div
                    className="
                      flex
                      h-12
                      w-12
                      shrink-0
                      items-center
                      justify-center
                      rounded-2xl
                      bg-emerald-900
                      text-white
                    "
                  >
                    <ShieldCheck className="h-5 w-5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-bold text-zinc-950 md:text-base">
                      Comece sua evolução hoje
                    </h3>

                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                      <div className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-emerald-700" />
                        IA nutricional
                      </div>

                      <div className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-emerald-700" />
                        WhatsApp
                      </div>

                      <div className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-emerald-700" />
                        Acesso imediato
                      </div>
                    </div>
                  </div>

                  <Button
                    size="sm"
                    className="
                      group
                      rounded-2xl
                      bg-emerald-900
                      px-5
                      text-white
                      hover:bg-emerald-950
                    "
                    onClick={() =>
                      document.getElementById("pricing")?.scrollIntoView({
                        behavior: "smooth",
                      })
                    }
                  >
                    Começar
                    <ArrowRight
                      className="
                        h-4
                        w-4
                        transition-transform
                        duration-300
                        group-hover:translate-x-1
                      "
                    />
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
