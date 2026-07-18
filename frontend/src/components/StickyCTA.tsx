"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

export default function StickyCTA() {
  const [footerInView, setFooterInView] = useState(false);
  const [canRender, setCanRender] = useState(false);
  const [lastTrigger, setLastTrigger] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      const hero = document.getElementById("hero");
      const pricing = document.getElementById("pricing");

      if (!hero || !pricing) return;

      const heroBottom = hero.getBoundingClientRect().bottom + window.scrollY;

      const pricingTop = pricing.getBoundingClientRect().top + window.scrollY;

      const current = window.scrollY + window.innerHeight * 0.5;

      const insideRange = current > heroBottom && current < pricingTop;

      if (!insideRange) {
        setCanRender(false);
        return;
      }

      const now = Date.now();

      if (now - lastTrigger < 18000) {
        return;
      }

      setLastTrigger(now);
      setCanRender(true);

      window.setTimeout(() => {
        setCanRender(false);
      }, 4200);
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
  }, [lastTrigger]);

  const scrollToPricing = () => {
    document.getElementById("pricing")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <AnimatePresence>
      {canRender && !footerInView && (
        <motion.div
          initial={{
            opacity: 0,
            y: 80,
            scale: 0.96,
          }}
          animate={{
            opacity: 1,
            y: 0,
            scale: 1,
          }}
          exit={{
            opacity: 0,
            y: 80,
            scale: 0.96,
          }}
          transition={{
            duration: 0.42,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="
            fixed
            bottom-5
            left-1/2
            z-50
            w-[90%]
            max-w-[470px]
            -translate-x-1/2
          "
        >
          <div className="relative">
            {/* Glow discreto */}
            <div
              className="
                absolute
                inset-0
                -z-10
                rounded-full
                bg-emerald-400/10
                blur-2xl
              "
            />

            <div
              className="
                relative
                flex
                items-center
                justify-between
                gap-3
                rounded-full
                border
                border-white/70
                bg-white/72
                px-3
                py-3
                shadow-[0_20px_50px_-28px_rgba(15,23,42,.28)]
                backdrop-blur-[28px]
                supports-[backdrop-filter]:bg-white/70
              "
            >
              {/* ESQUERDA */}

              <div className="flex min-w-0 items-center gap-3">
                <div
                  className="
                    flex
                    h-10
                    w-10
                    shrink-0
                    items-center
                    justify-center
                    rounded-full
                    bg-emerald-50
                    text-emerald-800
                  "
                >
                  <Sparkles className="h-4 w-4" />
                </div>

                <div className="min-w-0">
                  <p
                    className="
                      truncate
                      text-[13px]
                      font-semibold
                      tracking-[-0.02em]
                      text-zinc-900
                      sm:text-sm
                    "
                  >
                    Pronto para começar sua evolução?
                  </p>

                  <p
                    className="
                      hidden
                      text-[11px]
                      text-zinc-500
                      sm:block
                    "
                  >
                    Escolha seu plano e comece agora.
                  </p>
                </div>
              </div>

              {/* DIREITA */}

              <Button
                size="sm"
                onClick={scrollToPricing}
                className="
                  group
                  h-10
                  shrink-0
                  rounded-full
                  bg-emerald-900
                  px-4
                  font-semibold
                  text-white
                  shadow-none
                  transition-all
                  duration-300
                  hover:bg-emerald-950
                "
              >
                <span className="hidden sm:inline">Ver planos</span>

                <span className="sm:hidden">Planos</span>

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
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
