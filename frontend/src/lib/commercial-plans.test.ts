import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMMERCIAL_PLANS,
  checkoutPath,
  commercialPlanFromRouteParam,
} from "./commercial-plans";

test("commercial limits match the approved cycle contract without changing prices", () => {
  for (const [type, expected] of [
    ["BASIC", [30, 30, 2, 2, 29.9]],
    ["PREMIUM", [200, 150, 6, 6, 69.9]],
  ] as const) {
    const plan = COMMERCIAL_PLANS[type];
    assert.deepEqual(
      [
        plan.entitlements.audioTranscriptionsPerCycle,
        plan.entitlements.imageAnalysesPerCycle,
        plan.entitlements.nutritionPlansPerCycle,
        plan.entitlements.workoutPlansPerCycle,
        plan.price,
      ],
      expected,
    );
    assert.equal(plan.imageLimit, plan.entitlements.imageAnalysesPerCycle);
    assert.equal(commercialPlanFromRouteParam(plan.routeParam), plan);
    assert.equal(checkoutPath(type), `/checkout/${plan.routeParam}`);
    assert.ok(
      !plan.features.some((feature) => /ilimitad|sem quota/i.test(feature)),
    );
    assert.ok(
      plan.features.some((feature) => feature.includes("ativação gradual")),
    );
  }
});
