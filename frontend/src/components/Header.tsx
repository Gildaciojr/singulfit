"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { HeaderData } from "@/engine/landing.types";

type Props = {
  data: HeaderData;
};

export default function Header({ data }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState("");

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);

      for (let i = data.links.length - 1; i >= 0; i--) {
        const id = data.links[i].target;
        const element = document.getElementById(id);

        if (!element) continue;

        const rect = element.getBoundingClientRect();

        if (rect.top <= 120) {
          setActiveSection(id);
          break;
        }
      }
    };

    handleScroll();

    window.addEventListener("scroll", handleScroll);

    return () => window.removeEventListener("scroll", handleScroll);
  }, [data.links]);

  const scrollTo = (target: string) => {
    const element = document.getElementById(target);

    if (element) {
      element.scrollIntoView({
        behavior: "smooth",
      });
    }

    setMobileOpen(false);
  };

  return (
    <>
      <header
        className={`
          fixed inset-x-0 top-0 z-50
          transition-all duration-500
          ${
            scrolled
              ? "bg-white/88 backdrop-blur-3xl border-b border-zinc-200/60 shadow-[0_20px_60px_-35px_rgba(15,23,42,0.22)]"
              : "bg-white/40 backdrop-blur-md"
          }
        `}
      >
        <div className="container mx-auto max-w-[1600px] px-8">
          <div className="flex h-20 items-center justify-between">
            {/* LOGO */}

            <button
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="flex items-center gap-3"
            >
              <img src={data.logo} alt="SingulFit" className="h-11 w-auto" />

              <div className="hidden sm:block text-left">
                <div className="text-[1.45rem] font-black tracking-[-0.03em] text-zinc-950">
                  SingulFit
                </div>

                <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                  Nutrição Inteligente
                </div>
              </div>
            </button>

            {/* DESKTOP NAV */}

            <nav className="hidden lg:flex items-center gap-8">
              {data.links.map((link) => {
                const active = activeSection === link.target;

                return (
                  <button
                    key={link.target}
                    onClick={() => scrollTo(link.target)}
                    className={`
                      relative text-[15px] font-semibold transition-all duration-300
                      ${
                        active
                          ? "text-emerald-800"
                          : "text-zinc-600 hover:text-zinc-800"
                      }
                    `}
                  >
                    {link.label}

                    {active && (
                      <motion.div
                        layoutId="nav-active"
                        className="absolute -bottom-2 left-0 right-0 h-[2px] rounded-full bg-emerald-800"
                      />
                    )}
                  </button>
                );
              })}
            </nav>

            {/* CTA */}

            <div className="hidden lg:flex items-center gap-3">
              <div className="text-xs text-zinc-500">Acesso imediato</div>

              <Button
                onClick={() => scrollTo(data.cta.target)}
                className="
    group
    h-14
    rounded-2xl
    bg-gradient-to-r
    from-emerald-900
    to-emerald-800
    px-8
    font-semibold
    text-white
    shadow-[0_22px_50px_-20px_rgba(6,78,59,0.55)]
    hover:from-emerald-950
    hover:to-emerald-900
    transition-all
  "
              >
                {data.cta.label}

                <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
              </Button>
            </div>

            {/* MOBILE */}

            <button className="lg:hidden" onClick={() => setMobileOpen(true)}>
              <Menu className="h-6 w-6 text-zinc-900" />
            </button>
          </div>
        </div>
      </header>

      {/* MOBILE MENU */}

      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />

            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{
                type: "spring",
                damping: 30,
                stiffness: 300,
              }}
              className="
                fixed
                right-0
                top-0
                z-[60]
                h-full
                w-[88%]
                max-w-sm
                bg-white
                p-6
                shadow-2xl
              "
            >
              <div className="mb-10 flex items-center justify-between">
                <img
                  src={data.logo}
                  alt="SingulFit"
                  className="h-12 w-auto object-contain"
                />

                <button onClick={() => setMobileOpen(false)}>
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="space-y-1">
                {data.links.map((link) => (
                  <button
                    key={link.target}
                    onClick={() => scrollTo(link.target)}
                    className="
                      flex
                      w-full
                      items-center
                      justify-between
                      rounded-2xl
                      px-4
                      py-4
                      text-left
                      font-semibold
                      text-zinc-800
                      hover:bg-zinc-50
                    "
                  >
                    {link.label}

                    <ArrowRight className="h-4 w-4" />
                  </button>
                ))}
              </div>

              <div className="mt-8">
                <Button
                  onClick={() => scrollTo(data.cta.target)}
                  className="
                    h-14
                    w-full
                    rounded-2xl
                    bg-emerald-900
                    text-white
                  "
                >
                  {data.cta.label}
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
