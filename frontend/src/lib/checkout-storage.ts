import { CommercialPlanType } from "@/lib/commercial-plans";

const ACCESS_TOKEN_KEY = "singulfit.checkout.accessToken";
const REFRESH_TOKEN_KEY = "singulfit.checkout.refreshToken";
const PLAN_TYPE_KEY = "singulfit.checkout.planType";

export type CheckoutTokens = {
  accessToken: string;
  refreshToken: string;
};

export function saveCheckoutSession(
  tokens: CheckoutTokens,
  planType: CommercialPlanType,
): void {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
  window.localStorage.setItem(PLAN_TYPE_KEY, planType);
}

export function readCheckoutAccessToken(): string | null {
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function readCheckoutRefreshToken(): string | null {
  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function readCheckoutPlanType(): CommercialPlanType | null {
  const value = window.localStorage.getItem(PLAN_TYPE_KEY);

  return value === "BASIC" || value === "PREMIUM" ? value : null;
}

export function clearCheckoutSession(): void {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  window.localStorage.removeItem(PLAN_TYPE_KEY);
}
