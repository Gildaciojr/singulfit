import { create } from "zustand";

type BillingMode = "monthly" | "annual";

type PricingState = {
  mode: BillingMode;
  setMode: (mode: BillingMode) => void;
};

export const usePricing = create<PricingState>((set) => ({
  mode: "annual",
  setMode: (mode) => set({ mode }),
}));