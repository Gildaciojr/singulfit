import { Injectable } from '@nestjs/common';
import type { ConversationLegacyIntent } from '../contracts/conversation-runtime.contract';
import type { ConversationRuntimeSummary } from '../contracts/conversation-runtime.contract';

export type ConversationComparisonClassification =
  | 'MATCH'
  | 'COMPATIBLE'
  | 'RICHER'
  | 'CONFLICT'
  | 'NEW_ONLY'
  | 'LEGACY_ONLY'
  | 'SAFETY_OVERRIDE'
  | 'AMBIGUOUS';

export interface ConversationShadowComparison {
  readonly equivalent: boolean;
  readonly classification: ConversationComparisonClassification;
  readonly code:
    | 'DIET_ROUTE_MATCH'
    | 'WORKOUT_ROUTE_MATCH'
    | 'COMBINED_ROUTE_MATCH'
    | 'GENERAL_ROUTE_MATCH'
    | 'ROUTE_DIVERGENCE'
    | 'NO_RUNTIME_ROUTE';
}

@Injectable()
export class ConversationShadowComparatorService {
  compare(
    legacy: ConversationLegacyIntent,
    summary: ConversationRuntimeSummary,
  ): ConversationShadowComparison {
    const routeKind = summary.routeKind;
    if (summary.safetyRequired) {
      return Object.freeze({
        equivalent: false,
        classification: 'SAFETY_OVERRIDE',
        code: 'ROUTE_DIVERGENCE',
      });
    }
    if (summary.ambiguityPresent) {
      return Object.freeze({
        equivalent: false,
        classification: 'AMBIGUOUS',
        code: 'NO_RUNTIME_ROUTE',
      });
    }
    if (!routeKind)
      return Object.freeze({
        equivalent: false,
        classification: 'LEGACY_ONLY',
        code: 'NO_RUNTIME_ROUTE',
      });
    if (legacy === 'DIET' && routeKind === 'NUTRITION_PLAN_GENERATION') {
      return Object.freeze({
        equivalent: true,
        classification: 'MATCH',
        code: 'DIET_ROUTE_MATCH',
      });
    }
    if (legacy === 'WORKOUT' && routeKind === 'WORKOUT_PLAN_GENERATION') {
      return Object.freeze({
        equivalent: true,
        classification: 'MATCH',
        code: 'WORKOUT_ROUTE_MATCH',
      });
    }
    if (legacy === 'BOTH' && routeKind === 'COMBINED_PLAN_GENERATION') {
      return Object.freeze({
        equivalent: true,
        classification: 'MATCH',
        code: 'COMBINED_ROUTE_MATCH',
      });
    }
    if (legacy === 'UNKNOWN' && routeKind === 'ANSWER_MESSAGE') {
      return Object.freeze({
        equivalent: true,
        classification: 'MATCH',
        code: 'GENERAL_ROUTE_MATCH',
      });
    }
    return Object.freeze({
      equivalent: false,
      classification: legacy === 'UNKNOWN' ? 'NEW_ONLY' : 'CONFLICT',
      code: 'ROUTE_DIVERGENCE',
    });
  }
}
