type GtagFunction = (
  command: "event",
  eventName: string,
  params?: Record<string, unknown>
) => void;

type FbqFunction = (
  command: "trackCustom",
  eventName: string,
  params?: Record<string, unknown>
) => void;

declare global {
  interface Window {
    gtag?: GtagFunction;
    fbq?: FbqFunction;
  }
}

type TrackingParams = Record<string, unknown>;

export function trackEvent(
  name: string,
  params?: TrackingParams
): void {
  if (typeof window === "undefined") return;

  // GA4
  if (window.gtag) {
    window.gtag("event", name, params);
  }

  // Meta Pixel
  if (window.fbq) {
    window.fbq("trackCustom", name, params);
  }

  // Debug local (remover em produção se quiser)
  if (process.env.NODE_ENV !== "production") {
    console.log("[TRACK]", name, params);
  }
}