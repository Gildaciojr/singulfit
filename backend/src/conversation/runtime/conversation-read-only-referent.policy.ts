import { normalizeFoodTerm } from '../../context/food-preference-policy';
import {
  nutritionRequest,
  selfContainedNutritionRequest,
  type NutritionRequest,
} from '../understanding/nutrition-request.policy';
import { ConversationMessageNormalizerService } from '../understanding/conversation-message-normalizer.service';
import { ConversationEntityRecognizerService } from '../understanding/conversation-entity-recognizer.service';
import { ConversationDomainResolverService } from '../understanding/conversation-domain-resolver.service';
import { ConversationOperationResolverService } from '../understanding/conversation-operation-resolver.service';
import { ConversationIntentResolverService } from '../understanding/conversation-intent-resolver.service';
import { ConversationSafetyDetectorService } from '../understanding/conversation-safety-detector.service';
import { evaluateConversationSafety } from '../routing/conversation-safety-routing.policy';
import type { ConversationEntity } from '../contracts/conversation-entity.contract';
import type {
  ConversationDomain,
  ConversationIntent,
  ConversationOperation,
} from '../contracts/conversation-intent.contract';

const normalizer = new ConversationMessageNormalizerService();
const entityRecognizer = new ConversationEntityRecognizerService();
const domains = new ConversationDomainResolverService();
const operations = new ConversationOperationResolverService();
const intents = new ConversationIntentResolverService();
const safety = new ConversationSafetyDetectorService();
const independentInput = {
  continuity: {
    currentLogicalTurn: 0,
    activeProfileField: null,
    pendingConfirmation: false,
    targetPlan: null,
  },
} as const;

interface ReadOnlyCurrentTurn {
  readonly domain: ConversationDomain;
  readonly intent: ConversationIntent;
  readonly operation: ConversationOperation;
  readonly entities: readonly ConversationEntity[];
  readonly selfContained: boolean;
  readonly safetyRequired: boolean;
}

function originalCurrentTurn(value: string): ReadOnlyCurrentTurn {
  const message = normalizer.normalize(value);
  const recognized = entityRecognizer.recognize(message);
  const domain = domains.resolve(independentInput, message, recognized, {
    references: [],
    usedRecentHistory: false,
    usedContinuity: false,
    usedProfile: false,
  });
  const operation = operations.resolve(independentInput, message, recognized);
  return {
    domain: domain.domain,
    operation: operation.operation,
    intent: intents.resolve(independentInput, operation, domain).intent,
    entities: recognized.entities,
    selfContained: selfContainedNutritionRequest(value) !== null,
    safetyRequired: evaluateConversationSafety(safety.detect(message).safety)
      .routeRequired,
  };
}

export type ReferentCompatibility =
  | 'COMPATIBLE'
  | 'CURRENT_DOMAIN'
  | 'CURRENT_ENTITY'
  | 'CURRENT_OPERATION'
  | 'CURRENT_REQUEST'
  | 'SAFETY';

export function referentCompatibility(
  current: ReadOnlyCurrentTurn,
  referent: CurrentReadOnlyReferent,
): ReferentCompatibility {
  if (current.safetyRequired) return 'SAFETY';
  if (current.selfContained) return 'CURRENT_REQUEST';
  if (
    current.operation !== 'ANSWER' &&
    current.operation !== 'PROVIDE_GUIDANCE'
  )
    return 'CURRENT_OPERATION';
  if (
    current.domain !== 'GENERAL' &&
    current.domain !== 'UNKNOWN' &&
    current.domain !== referent.domain
  )
    return 'CURRENT_DOMAIN';
  const incompatibleEntity = current.entities.some((entity) => {
    switch (entity.kind) {
      case 'WORKOUT_ARTIFACT':
      case 'WORKOUT_MODALITY':
      case 'EXERCISE':
      case 'EQUIPMENT':
        return referent.domain !== 'WORKOUT';
      case 'NUTRITION_ARTIFACT':
      case 'MEAL':
      case 'FOOD':
        return referent.domain !== 'NUTRITION';
      case 'PLAN_COMPONENT':
        return entity.domain !== referent.domain;
      case 'PROFILE_FIELD':
      case 'BODY_METRIC':
        return true;
      default:
        return false;
    }
  });
  return incompatibleEntity ? 'CURRENT_ENTITY' : 'COMPATIBLE';
}

export type ReadOnlyFollowUpKind =
  | 'ALTERNATIVE_REQUEST'
  | 'CONSTRAINT_REFINEMENT'
  | 'FOLLOW_UP_ACCEPTANCE';
export interface ReadOnlyFollowUp {
  readonly kind: ReadOnlyFollowUpKind;
  readonly constraints: readonly string[];
  readonly currentTurn: ReadOnlyCurrentTurn;
}
export interface CurrentReadOnlyReferent {
  readonly source: 'DELIVERED_QA';
  readonly sourceMessageId: string;
  readonly domain: 'NUTRITION' | 'WORKOUT' | 'PROGRESS' | 'GENERAL';
  readonly nutrition: NutritionRequest | null;
  readonly previousAnswer: string;
  readonly followUpQuestion: string | null;
  readonly deliveredAt: string;
}

export function readOnlyFollowUp(value: string): ReadOnlyFollowUp | null {
  const text = normalizeFoodTerm(value);
  if (
    /\b(?:tro(?:c|qu)\w*|substitu\w*|atualiz\w*|mud\w*|alter(?:e|a(?:r|cao)?|ou|ei|ando)|ajust\w*|adapt\w*|inclu\w*|remov\w*|adicion\w*|cancel\w*|persist\w*|permanent\w*|plano|dieta|isso|ess[ea])\b/u.test(
      text,
    )
  )
    return null;
  const currentTurn = originalCurrentTurn(value);
  if (/\b(?:outr[oa]|mais (?:uma?|opcao|alternativa))\b/u.test(text))
    return {
      kind: 'ALTERNATIVE_REQUEST',
      currentTurn,
      constraints:
        nutritionRequest(`Me sugira uma refeição ${text}`)?.constraints ?? [],
    };
  if (
    /^(?:sim(?: (?:eu )?quero)?|(?:eu )?quero(?: sim)?)(?: por favor)?$/u.test(
      text,
    )
  )
    return { kind: 'FOLLOW_UP_ACCEPTANCE', constraints: [], currentTurn };
  const request = nutritionRequest(`Me sugira uma refeição ${text}`);
  if (
    request?.constraints.length &&
    /^(?:sem\b|mais\b|rapid[oa]s?\b|proteic[oa]s?\b|barat[oa]s?\b|leves?\b|pratic[oa]s?\b|para levar\b)/u.test(
      text,
    )
  )
    return {
      kind: 'CONSTRAINT_REFINEMENT',
      constraints: request.constraints,
      currentTurn,
    };
  return null;
}

export function effectiveNutritionRequest(
  followUp: ReadOnlyFollowUp,
  referent: CurrentReadOnlyReferent,
): NutritionRequest | null {
  if (
    referentCompatibility(followUp.currentTurn, referent) !== 'COMPATIBLE' ||
    referent.domain !== 'NUTRITION' ||
    !referent.nutrition ||
    referent.nutrition.intent === 'PLAN_LOOKUP'
  )
    return null;
  if (followUp.kind === 'FOLLOW_UP_ACCEPTANCE' && !referent.followUpQuestion)
    return null;
  const constraints = Object.freeze([
    ...new Set([...referent.nutrition.constraints, ...followUp.constraints]),
  ]);
  return Object.freeze({
    intent: constraints.length
      ? 'CONSTRAINED_RECOMMENDATION'
      : 'NUTRITION_ADVICE',
    meal: referent.nutrition.meal,
    constraints,
  });
}

export function nutritionRequestText(request: NutritionRequest): string {
  const labels: Readonly<Record<string, string>> = {
    QUICK: 'rápido',
    HIGH_PROTEIN: 'proteico',
    LOW_COST: 'barato',
    LIGHT: 'leve',
    PORTABLE: 'para levar',
    LACTOSE: 'sem lactose',
    MILK: 'sem leite',
    GLUTEN: 'sem gluten',
    EGG: 'sem ovo',
    PEANUT: 'sem amendoim',
    VEGAN: 'vegano',
    VEGETARIAN: 'vegetariano',
  };
  return `Me sugira uma opção para ${request.meal ?? 'refeição'} ${request.constraints.map((code) => labels[code] ?? '').join(' ')}`;
}
