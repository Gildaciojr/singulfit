import { Injectable } from '@nestjs/common';
import { CONVERSATION_RECOGNIZED_INTENT } from '../../context/conversation-goal-planner.contract';
import { ConversationUnderstandingToGoalPlannerAdapter } from '../adapters/conversation-understanding-to-goal-planner.adapter';
import type {
  ConversationEntity,
  ConversationReference,
} from '../contracts/conversation-entity.contract';
import {
  ConversationGoalPreparationError,
  type ConversationGoalPreparationInput,
  type ConversationGoalPreparationResult,
} from '../contracts/conversation-goal-preparation.contract';
import type { ConversationDomain } from '../contracts/conversation-intent.contract';
import { ConversationUnderstandingValidator } from '../validators/conversation-understanding.validator';

type PlanTarget = 'DIET' | 'WORKOUT' | 'BOTH';

@Injectable()
export class ConversationGoalPreparationService {
  constructor(
    private readonly validator: ConversationUnderstandingValidator,
    private readonly adapter: ConversationUnderstandingToGoalPlannerAdapter,
  ) {}

  prepare(
    input: ConversationGoalPreparationInput,
  ): ConversationGoalPreparationResult {
    this.validator.assertValid(input.understanding);
    this.validateInput(input);
    const targetPlan = this.resolveTarget(input);
    this.requireTargetWhenNecessary(input, targetPlan);
    return this.adapter.adapt({ preparation: input, targetPlan });
  }

  private validateInput(input: ConversationGoalPreparationInput): void {
    if (input.understanding.status === 'FAILED') {
      throw new ConversationGoalPreparationError(
        'UNDERSTANDING_FAILED',
        'Understanding com falha não pode ser enviado ao Planner',
      );
    }
    if (
      input.understanding.ambiguity.present &&
      input.understanding.intent !==
        CONVERSATION_RECOGNIZED_INTENT.CONFIRMATION_REQUIRED
    ) {
      throw new ConversationGoalPreparationError(
        'UNDERSTANDING_AMBIGUOUS',
        'Understanding ambíguo exige resolução antes do Planner',
      );
    }
    if (
      !input.referenceDate.trim() ||
      Number.isNaN(Date.parse(input.referenceDate)) ||
      input.referenceDate !== input.snapshot.referenceDate
    ) {
      throw new ConversationGoalPreparationError(
        'INVALID_REFERENCE_DATE',
        'Data de referência diverge do Snapshot',
      );
    }
    if (
      !Number.isInteger(input.recentHistory.currentLogicalTurn) ||
      input.recentHistory.currentLogicalTurn < 0 ||
      input.recentHistory.entries.some(
        (entry) =>
          !Number.isInteger(entry.logicalTurn) ||
          entry.logicalTurn < 0 ||
          entry.logicalTurn > input.recentHistory.currentLogicalTurn,
      )
    ) {
      throw new ConversationGoalPreparationError(
        'INVALID_GOAL_HISTORY',
        'Histórico de goals possui turno lógico inválido',
      );
    }
  }

  private resolveTarget(
    input: ConversationGoalPreparationInput,
  ): PlanTarget | null {
    const fixed = this.fixedTarget(input.understanding.intent);
    const contextual = this.contextualTargetAllowed(input.understanding.intent);
    if (!fixed && !contextual) return null;

    const explicitTarget = this.mergeTargets([
      this.referenceTarget(input.understanding.references),
      this.entityTarget(input.understanding.entities),
      input.continuity.targetPlan,
    ]);
    if (
      fixed &&
      fixed !== 'BOTH' &&
      explicitTarget !== null &&
      explicitTarget !== fixed
    ) {
      throw new ConversationGoalPreparationError(
        'TARGET_PLAN_CONFLICT',
        'Target explícito da intent conflita com o contexto resolvido',
      );
    }
    return (
      fixed ?? explicitTarget ?? this.domainTarget(input.understanding.domain)
    );
  }

  private mergeTargets(
    candidates: readonly (PlanTarget | null)[],
  ): PlanTarget | null {
    const distinct = [
      ...new Set(
        candidates.filter((target): target is PlanTarget => target !== null),
      ),
    ];
    if (distinct.includes('BOTH')) {
      if (distinct.some((target) => target !== 'BOTH')) {
        throw new ConversationGoalPreparationError(
          'TARGET_PLAN_CONFLICT',
          'Referências de plano possuem targets incompatíveis',
        );
      }
      return 'BOTH';
    }
    if (distinct.includes('DIET') && distinct.includes('WORKOUT')) {
      throw new ConversationGoalPreparationError(
        'TARGET_PLAN_CONFLICT',
        'Referências de dieta e treino não definem um target único',
      );
    }
    return distinct[0] ?? null;
  }

  private entityTarget(
    entities: readonly ConversationEntity[],
  ): PlanTarget | null {
    const nutrition = entities.some(
      (entity) =>
        entity.kind === 'NUTRITION_ARTIFACT' ||
        entity.kind === 'MEAL' ||
        entity.kind === 'FOOD' ||
        (entity.kind === 'PLAN_COMPONENT' && entity.domain === 'NUTRITION'),
    );
    const workout = entities.some(
      (entity) =>
        entity.kind === 'WORKOUT_ARTIFACT' ||
        entity.kind === 'WORKOUT_MODALITY' ||
        entity.kind === 'EXERCISE' ||
        (entity.kind === 'PLAN_COMPONENT' && entity.domain === 'WORKOUT'),
    );
    if (nutrition && workout) return 'BOTH';
    if (nutrition) return 'DIET';
    if (workout) return 'WORKOUT';
    return null;
  }

  private fixedTarget(
    intent: ConversationGoalPreparationInput['understanding']['intent'],
  ): PlanTarget | null {
    switch (intent) {
      case CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_REQUEST:
      case CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_UPDATE_REQUEST:
        return 'DIET';
      case CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_REQUEST:
      case CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_UPDATE_REQUEST:
        return 'WORKOUT';
      case CONVERSATION_RECOGNIZED_INTENT.COMBINED_PLAN_REQUEST:
        return 'BOTH';
      default:
        return null;
    }
  }

  private referenceTarget(
    references: readonly ConversationReference[],
  ): PlanTarget | null {
    const resolvedDomains = new Set<'NUTRITION' | 'WORKOUT' | 'BOTH'>();
    for (const reference of references) {
      if (reference.kind === 'PLAN' && reference.resolution === 'RESOLVED') {
        resolvedDomains.add(reference.domain);
      }
    }
    const domains = [...resolvedDomains];
    if (domains.length === 0) return null;
    if (
      (domains.includes('BOTH') && domains.length > 1) ||
      (domains.includes('NUTRITION') && domains.includes('WORKOUT'))
    ) {
      throw new ConversationGoalPreparationError(
        'TARGET_PLAN_CONFLICT',
        'Referências resolvidas possuem targets incompatíveis',
      );
    }
    if (domains.includes('BOTH')) return 'BOTH';
    return domains[0] === 'NUTRITION' ? 'DIET' : 'WORKOUT';
  }

  private domainTarget(domain: ConversationDomain): PlanTarget | null {
    if (domain === 'NUTRITION') return 'DIET';
    if (domain === 'WORKOUT') return 'WORKOUT';
    if (domain === 'COMBINED') return 'BOTH';
    return null;
  }

  private contextualTargetAllowed(
    intent: ConversationGoalPreparationInput['understanding']['intent'],
  ): boolean {
    return (
      intent === CONVERSATION_RECOGNIZED_INTENT.CURRENT_PLAN_REQUEST ||
      intent === CONVERSATION_RECOGNIZED_INTENT.PLAN_STATUS_REQUEST ||
      intent === CONVERSATION_RECOGNIZED_INTENT.CONFIRMATION_REQUIRED
    );
  }

  private requireTargetWhenNecessary(
    input: ConversationGoalPreparationInput,
    targetPlan: PlanTarget | null,
  ): void {
    if (
      input.understanding.intent ===
        CONVERSATION_RECOGNIZED_INTENT.CURRENT_PLAN_REQUEST &&
      targetPlan === null
    ) {
      throw new ConversationGoalPreparationError(
        'TARGET_PLAN_REQUIRED',
        'Apresentação do plano atual exige target resolvido',
      );
    }
  }
}
