import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export default function StickyCTA() {
  const [canRender, setCanRender] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hero = document.getElementById("hero");
    const pricing = document.getElementById("pricing");
    const footer = document.querySelector("footer");
    if (!hero || !pricing) return;

    const protectedElements = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-cta-protected], #how-it-works h2, #how-it-works p, #features h2, #features p, #testimonials article, #testimonials h2, #testimonials p, #testimonials a, #guarantee h2, #guarantee p, #guarantee a, #guarantee li",
      ),
    );
    let frame = 0;
    let lastTriggeredAt = -Infinity;
    let activeUntil = 0;
    let hideTimer: number | undefined;

    const updateVisibility = () => {
      frame = 0;
      const dock = dockRef.current;
      if (!dock) return;
      const current = window.innerHeight * 0.5;
      const insideRange =
        current > hero.getBoundingClientRect().bottom &&
        current < pricing.getBoundingClientRect().top;
      const footerBounds = footer?.getBoundingClientRect();
      const footerVisible =
        footerBounds &&
        footerBounds.top < window.innerHeight &&
        footerBounds.bottom > 0;
      const keyboardOpen =
        (window.visualViewport?.height ?? window.innerHeight) <
        window.innerHeight - 120;
      const menuOpen = document.querySelector('header [aria-expanded="true"]');
      const dockBounds = dock.getBoundingClientRect();
      const obstructsContent = protectedElements.some((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.width > 0 &&
          bounds.height > 0 &&
          bounds.left < dockBounds.right + 8 &&
          bounds.right > dockBounds.left - 8 &&
          bounds.top < dockBounds.bottom + 8 &&
          bounds.bottom > dockBounds.top - 8
        );
      });

      if (
        !insideRange ||
        footerVisible ||
        keyboardOpen ||
        menuOpen ||
        obstructsContent
      ) {
        setCanRender(false);
        return;
      }
      const now = Date.now();
      if (now >= activeUntil && now - lastTriggeredAt >= 18000) {
        lastTriggeredAt = now;
        activeUntil = now + 4200;
        if (hideTimer !== undefined) window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => {
          if (!dock.contains(document.activeElement)) setCanRender(false);
        }, 4200);
      }
      setCanRender(now < activeUntil || dock.contains(document.activeElement));
    };
    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(updateVisibility);
    };

    scheduleUpdate();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("focusin", scheduleUpdate);
    window.addEventListener("focusout", scheduleUpdate);
    window.visualViewport?.addEventListener("resize", scheduleUpdate);
    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("focusin", scheduleUpdate);
      window.removeEventListener("focusout", scheduleUpdate);
      window.visualViewport?.removeEventListener("resize", scheduleUpdate);
      if (frame) window.cancelAnimationFrame(frame);
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
    };
  }, []);

  const scrollToPricing = () => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    document
      .getElementById("pricing")
      ?.scrollIntoView({
        behavior: reducedMotion ? "instant" : "smooth",
        block: "start",
      });
  };

  return (
    <div
      id="singulfit-sticky-cta"
      ref={dockRef}
      aria-hidden={!canRender}
      data-visible={canRender}
      className={`fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-40 ${canRender ? "" : "invisible pointer-events-none"}`}
    >
      <Button
        size="sm"
        tabIndex={canRender ? 0 : -1}
        onClick={scrollToPricing}
        className="min-h-11 rounded-xl bg-emerald-900 px-4 text-sm font-semibold text-white shadow-[0_8px_24px_-12px_rgba(6,78,59,0.35)] hover:bg-emerald-950 focus-visible:ring-emerald-700 motion-reduce:transition-none"
      >
        <span className="hidden sm:inline">Ver planos</span>
        <span className="sm:hidden">Planos</span>
        <ArrowRight aria-hidden="true" className="h-4 w-4" />
      </Button>
    </div>
  );
}
