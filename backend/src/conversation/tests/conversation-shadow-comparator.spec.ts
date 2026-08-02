import type { ConversationRuntimeSummary } from '../contracts/conversation-runtime.contract';
import { ConversationShadowComparatorService } from '../runtime/conversation-shadow-comparator.service';

describe('ConversationShadowComparatorService', () => {
  const service = new ConversationShadowComparatorService();
  const summary: ConversationRuntimeSummary = {
    status: 'SHADOW_COMPLETED',
    mode: 'SHADOW',
    operationKey: 'key',
    understandingStatus: 'UNDERSTOOD',
    recognizedIntent: 'DIET_PLAN_REQUEST',
    goal: 'GENERATE_DIET_PLAN',
    routeKind: 'NUTRITION_PLAN_GENERATION',
    confidence: 'HIGH',
    ambiguityPresent: false,
    safetyRequired: false,
    authorized: false,
    fallbackReason: null,
    durationMs: 2,
    versions: {
      runtime: 'conversation-runtime:v1',
      understanding: 'conversation-understanding:v1',
      routing: 'conversation-routing-decision:v1',
    },
  };

  it('classifies an aligned legacy and runtime route as MATCH', () => {
    expect(service.compare('DIET', summary)).toMatchObject({
      equivalent: true,
      classification: 'MATCH',
      code: 'DIET_ROUTE_MATCH',
    });
  });

  it('gives safety and ambiguity explicit classifications', () => {
    expect(
      service.compare('UNKNOWN', { ...summary, safetyRequired: true }),
    ).toMatchObject({ classification: 'SAFETY_OVERRIDE' });
    expect(
      service.compare('UNKNOWN', {
        ...summary,
        ambiguityPresent: true,
        routeKind: null,
      }),
    ).toMatchObject({ classification: 'AMBIGUOUS' });
  });

  it('distinguishes new-only, legacy-only and conflicting decisions', () => {
    expect(
      service.compare('UNKNOWN', {
        ...summary,
        routeKind: 'NUTRITION_GUIDANCE',
      }),
    ).toMatchObject({ classification: 'NEW_ONLY' });
    expect(
      service.compare('DIET', { ...summary, routeKind: null }),
    ).toMatchObject({ classification: 'LEGACY_ONLY' });
    expect(service.compare('WORKOUT', summary)).toMatchObject({
      classification: 'CONFLICT',
    });
  });

  it.each([
    ['WORKOUT', 'WORKOUT_PLAN_GENERATION', 'WORKOUT_ROUTE_MATCH'],
    ['BOTH', 'COMBINED_PLAN_GENERATION', 'COMBINED_ROUTE_MATCH'],
    ['UNKNOWN', 'ANSWER_MESSAGE', 'GENERAL_ROUTE_MATCH'],
  ] as const)('matches %s with %s', (legacy, routeKind, code) => {
    expect(service.compare(legacy, { ...summary, routeKind })).toMatchObject({
      equivalent: true,
      classification: 'MATCH',
      code,
    });
  });
});
