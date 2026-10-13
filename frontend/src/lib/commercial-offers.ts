import { COMMERCIAL_PLANS, CommercialPlan, CommercialPlanType } from "./commercial-plans";

export type CurrentCommercialPlan = CommercialPlan & { id: string; contractVersion: string };
const resources = {
  AUDIO_TRANSCRIPTION: "transcrições de áudio por ciclo (ativação gradual)",
  IMAGE_ANALYSIS: "análises de refeições por foto por ciclo",
  NUTRITION_PLAN_GENERATION: "planos alimentares por ciclo",
  WORKOUT_PLAN_GENERATION: "planos de treino por ciclo",
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function unavailableCommercialPlan(type: CommercialPlanType): CommercialPlan {
  return { ...COMMERCIAL_PLANS[type], description: "Consulte a oferta comercial disponível.", features: [] };
}

export function resolveCommercialOffers(payload: unknown): Partial<Record<CommercialPlanType, CurrentCommercialPlan>> {
  if (!record(payload) || !Array.isArray(payload.plans)) throw new Error("Catálogo inválido");
  const result: Partial<Record<CommercialPlanType, CurrentCommercialPlan>> = {};
  for (const candidate of payload.plans) {
    if (!record(candidate) || (candidate.type !== "BASIC" && candidate.type !== "PREMIUM") ||
      typeof candidate.id !== "string" || typeof candidate.contractVersion !== "string" ||
      candidate.isCurrentOffer !== true || candidate.isActive !== true || candidate.currency !== "BRL" ||
      candidate.billingInterval !== "MONTH" || candidate.billingIntervalCount !== 1 ||
      !record(candidate.commercialLimits) || typeof candidate.name !== "string") throw new Error("Oferta inválida");
    const type = candidate.type;
    if (result[type]) throw new Error("Oferta ambígua");
    const price = Number(candidate.price);
    if (!Number.isFinite(price) || price <= 0) throw new Error("Preço inválido");
    const limits = candidate.commercialLimits;
    const features: string[] = [];
    for (const [code, label] of Object.entries(resources)) {
      const limit = limits[code];
      if (limit === null) features.push(`${label}: sem limite contratual`);
      else if (typeof limit === "number" && Number.isInteger(limit) && limit >= 0) features.push(`${limit} ${label}`);
      else if (limit !== undefined) throw new Error("Direito inválido");
    }
    if (candidate.contractVersion === "basic-v2" &&
      (type !== "BASIC" || price !== 29.9 || limits.AUDIO_TRANSCRIPTION !== 30 || limits.IMAGE_ANALYSIS !== 30 ||
        limits.NUTRITION_PLAN_GENERATION !== 2 || limits.WORKOUT_PLAN_GENERATION !== 2)) throw new Error("Oferta incompleta");
    result[type] = {
      ...unavailableCommercialPlan(type), id: candidate.id, contractVersion: candidate.contractVersion,
      name: candidate.name, displayName: candidate.name, price, features,
      imageLimit: typeof limits.IMAGE_ANALYSIS === "number" ? limits.IMAGE_ANALYSIS : null,
      entitlements: { nutritionPlansPerCycle: typeof limits.NUTRITION_PLAN_GENERATION === "number" ? limits.NUTRITION_PLAN_GENERATION : limits.NUTRITION_PLAN_GENERATION === null ? null : 0, workoutPlansPerCycle: typeof limits.WORKOUT_PLAN_GENERATION === "number" ? limits.WORKOUT_PLAN_GENERATION : limits.WORKOUT_PLAN_GENERATION === null ? null : 0, imageAnalysesPerCycle: typeof limits.IMAGE_ANALYSIS === "number" ? limits.IMAGE_ANALYSIS : limits.IMAGE_ANALYSIS === null ? null : 0, audioTranscriptionsPerCycle: typeof limits.AUDIO_TRANSCRIPTION === "number" ? limits.AUDIO_TRANSCRIPTION : limits.AUDIO_TRANSCRIPTION === null ? null : 0 },
      description: typeof candidate.description === "string" ? candidate.description : "Direitos conforme a oferta contratada.",
    };
  }
  return result;
}
