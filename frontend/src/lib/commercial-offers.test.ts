import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveCommercialOffers,
  unavailableCommercialPlan,
} from "./commercial-offers";

const basic = {
  id: "46aec9ae-ddfa-4e63-80a6-342b85415675",
  type: "BASIC",
  contractVersion: "basic-v2",
  name: "Basic",
  price: "29.90",
  currency: "BRL",
  billingInterval: "MONTH",
  billingIntervalCount: 1,
  isActive: true,
  isCurrentOffer: true,
  commercialLimits: {
    AUDIO_TRANSCRIPTION: 30,
    IMAGE_ANALYSIS: 30,
    NUTRITION_PLAN_GENERATION: 2,
    WORKOUT_PLAN_GENERATION: 2,
  },
};

test("complete current BASIC V2 exposes its exact identity and granted benefits", () => {
  const offer = resolveCommercialOffers({ plans: [basic] }).BASIC;
  assert.equal(offer?.id, basic.id);
  assert.equal(offer?.price, 29.9);
  assert.equal(offer?.features.length, 4);
});
test("legacy offers do not advertise unprovisioned BASIC V2 grants", () => {
  const offer = resolveCommercialOffers({
    plans: [
      {
        ...basic,
        contractVersion: "legacy-v1",
        commercialLimits: { IMAGE_ANALYSIS: 5 },
      },
    ],
  }).BASIC;
  assert.deepEqual(offer?.features, [
    "5 análises de refeições por foto por ciclo",
  ]);
});
test("loading or absent offers have no quota promises", () => {
  assert.deepEqual(unavailableCommercialPlan("BASIC").features, []);
  assert.deepEqual(resolveCommercialOffers({ plans: [] }), {});
});
test("ambiguous, inactive or incomplete current offers cannot enable checkout", () => {
  assert.throws(() => resolveCommercialOffers({ plans: [basic, basic] }));
  assert.throws(() =>
    resolveCommercialOffers({ plans: [{ ...basic, isCurrentOffer: false }] }),
  );
  assert.throws(() =>
    resolveCommercialOffers({
      plans: [{ ...basic, commercialLimits: { IMAGE_ANALYSIS: 30 } }],
    }),
  );
});

test("legacy daily and monthly image metadata is not relabelled as a cycle grant", () => {
  const offer = resolveCommercialOffers({
    plans: [
      {
        ...basic,
        contractVersion: "legacy-v1",
        commercialLimits: {
          IMAGE_ANALYSIS_DAILY: 5,
          IMAGE_ANALYSIS_MONTHLY: 30,
        },
      },
    ],
  }).BASIC;
  assert.deepEqual(offer?.features, []);
  assert.equal(offer?.imageLimit, null);
});
test("legacy Premium unlimited canonical rights remain unlimited before commercial adjustment", () => {
  const offer = resolveCommercialOffers({
    plans: [
      {
        ...basic,
        type: "PREMIUM",
        contractVersion: "legacy-v1",
        price: "69.90",
        commercialLimits: {
          IMAGE_ANALYSIS: null,
          NUTRITION_PLAN_GENERATION: null,
          WORKOUT_PLAN_GENERATION: null,
        },
      },
    ],
  }).PREMIUM;
  assert.ok(
    offer?.features.every((feature) =>
      feature.endsWith("sem limite contratual"),
    ),
  );
  assert.equal(offer?.entitlements.imageAnalysesPerCycle, null);
  assert.equal(
    offer?.features.some((feature) => feature.startsWith("150 ")),
    false,
  );
});
