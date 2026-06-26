"use client";

import { useEffect, useRef, useState } from "react";
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
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileMenuId = "singulfit-mobile-menu";

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

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => window.removeEventListener("scroll", handleScroll);
  }, [data.links]);

  useEffect(() => {
    if (!mobileOpen) {
      return;
    }

    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMobileMenu();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mobileOpen]);

  const closeMobileMenu = () => {
    setMobileOpen(false);
    menuButtonRef.current?.focus();
  };

  const scrollTo = (target: string) => {
    const element = document.getElementById(target);

    if (element) {
      element.scrollIntoView({
        behavior: "smooth",
      });
    }

    if (mobileOpen) {
      closeMobileMenu();
    }
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
              aria-label="Voltar ao início da página"
              className="flex min-h-11 items-center gap-3"
              type="button"
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

            <nav
              aria-label="Navegação principal"
              className="hidden lg:flex items-center gap-8"
            >
              {data.links.map((link) => {
                const active = activeSection === link.target;

                return (
                  <button
                    key={link.target}
                    onClick={() => scrollTo(link.target)}
                    aria-current={active ? "page" : undefined}
                    className={`
                      relative flex min-h-11 items-center text-[15px] font-semibold transition-all duration-300
                      ${
                        active
                          ? "text-emerald-800"
                          : "text-zinc-600 hover:text-zinc-800"
                      }
                    `}
                    type="button"
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

            <button
              ref={menuButtonRef}
              aria-controls={mobileMenuId}
              aria-expanded={mobileOpen}
              aria-label="Abrir menu"
              className="flex min-h-11 min-w-11 items-center justify-center lg:hidden"
              onClick={() => setMobileOpen(true)}
              type="button"
            >
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
              onClick={closeMobileMenu}
            />

            <motion.div
              id={mobileMenuId}
              aria-label="Menu principal"
              aria-modal="true"
              role="dialog"
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
                h-sf-screen
                min-h-sf-small-screen
                w-[88%]
                max-w-sm
                bg-white
                p-6
                shadow-2xl
              "
              style={{
                paddingTop: "calc(1.5rem + var(--sf-safe-top))",
                paddingBottom: "calc(1.5rem + var(--sf-safe-bottom))",
              }}
            >
              <div className="mb-10 flex items-center justify-between">
                <img
                  src={data.logo}
                  alt="SingulFit"
                  className="h-12 w-auto object-contain"
                />

                <button
                  ref={closeButtonRef}
                  aria-label="Fechar menu"
                  className="flex min-h-11 min-w-11 items-center justify-center"
                  onClick={closeMobileMenu}
                  type="button"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <nav aria-label="Navegação mobile" className="space-y-1">
                {data.links.map((link) => (
                  <button
                    key={link.target}
                    onClick={() => scrollTo(link.target)}
                    aria-current={
                      activeSection === link.target ? "page" : undefined
                    }
                    className="
                      flex
                      min-h-11
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
                    type="button"
                  >
                    {link.label}

                    <ArrowRight className="h-4 w-4" />
                  </button>
                ))}
              </nav>

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
