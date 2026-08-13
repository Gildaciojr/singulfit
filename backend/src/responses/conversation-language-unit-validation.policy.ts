import type { AuthorizedFactValue } from './conversation-authorized-facts.contract';
import type {
  ConversationLanguageUnit,
  ConversationLanguageUnitValidationResult,
  ConversationLanguageUnitViolationDetail,
  ConversationLanguageUnitViolationCode,
} from './conversation-language-unit.contract';
import { createHash } from 'node:crypto';
import type {
  SanitizedConversationFact,
  SanitizedConversationPayload,
} from './sanitized-conversation-payload.contract';

export class ConversationLanguageUnitValidationPolicy {
  validate(
    payload: SanitizedConversationPayload,
    units: readonly ConversationLanguageUnit[],
  ): ConversationLanguageUnitValidationResult {
    const blocks = new Map(
      payload.structure.blocks.map((block) => [block.key, block]),
    );
    const facts = new Map(
      [...payload.facts.allowed, ...payload.facts.sensitive].map((fact) => [
        fact.key,
        fact,
      ]),
    );
    const seenBlocks = new Set<string>();
    const violations: ConversationLanguageUnitViolationCode[] = [];
    const violationDetails: ConversationLanguageUnitViolationDetail[] = [];

    for (const unit of units) {
      const block = blocks.get(unit.blockKey);
      if (!block) {
        violations.push('BLOCK_NOT_AUTHORIZED');
        continue;
      }
      if (seenBlocks.has(unit.blockKey)) {
        violations.push('DUPLICATE_BLOCK_UNIT');
      }
      seenBlocks.add(unit.blockKey);

      const invalidDecision = unit.decisionCodes.find(
        (decision) => !block.decisions.includes(decision),
      );
      if (invalidDecision) {
        violations.push('DECISION_NOT_AUTHORIZED');
        violationDetails.push({
          code: 'DECISION_NOT_AUTHORIZED',
          blockKey: block.key,
          ...(payload.selectedDecisions.includes(invalidDecision)
            ? { decisionCode: invalidDecision }
            : { decisionReference: this.reference(invalidDecision) }),
        });
      }
      const unauthorizedFact = unit.factKeys.find((fact) => !facts.has(fact));
      if (unauthorizedFact) {
        violations.push('FACT_NOT_AUTHORIZED');
        violationDetails.push({
          code: 'FACT_NOT_AUTHORIZED',
          blockKey: block.key,
          factReference: this.reference(unauthorizedFact),
        });
      }
      const unlinkedFact = unit.factKeys.find(
        (fact) => facts.has(fact) && !block.facts.includes(fact),
      );
      if (unlinkedFact) {
        violations.push('FACT_NOT_LINKED_TO_BLOCK');
        violationDetails.push({
          code: 'FACT_NOT_LINKED_TO_BLOCK',
          blockKey: block.key,
          factKey: unlinkedFact,
        });
      }
      if (unit.unitType === 'FACTUAL' && unit.factKeys.length === 0) {
        violations.push('FACTUAL_UNIT_WITHOUT_FACTS');
      }

      const linkedFacts = unit.factKeys.flatMap((key) => {
        const fact = facts.get(key);
        return fact ? [fact] : [];
      });
      const numbers = new Set(
        linkedFacts.flatMap((fact) => this.numbers(fact.value)),
      );
      if (unit.claims.numbers.some((number) => !numbers.has(number))) {
        violations.push('NUMBER_NOT_AUTHORIZED');
      }
      const foods = new Set(
        linkedFacts
          .filter((fact) => fact.key === 'facts.foods')
          .flatMap((fact) => this.foods(fact.value))
          .map((food) => this.normalize(food)),
      );
      if (unit.claims.foods.some((food) => !foods.has(this.normalize(food)))) {
        violations.push('FOOD_NOT_AUTHORIZED');
      }
      if (unit.claims.usesMemory && !this.hasLinkedMemoryFact(linkedFacts)) {
        violations.push('MEMORY_NOT_AUTHORIZED');
      }
      if (
        unit.claims.usesRecommendation &&
        !this.hasLinkedFact(linkedFacts, 'direction.authorizedRecommendation')
      ) {
        violations.push('RECOMMENDATION_NOT_AUTHORIZED');
      }
    }

    const frozenUnits = Object.freeze(
      units.map((unit) =>
        Object.freeze({
          ...unit,
          decisionCodes: Object.freeze([...unit.decisionCodes]),
          factKeys: Object.freeze([...unit.factKeys]),
          claims: Object.freeze({
            numbers: Object.freeze([...unit.claims.numbers]),
            foods: Object.freeze([...unit.claims.foods]),
            usesMemory: unit.claims.usesMemory,
            usesRecommendation: unit.claims.usesRecommendation,
          }),
        }),
      ),
    );
    const uniqueViolations = Object.freeze([...new Set(violations)]);
    const boundedViolationDetails = Object.freeze(
      violationDetails.slice(0, 20).map((detail) => Object.freeze(detail)),
    );

    return Object.freeze({
      valid: uniqueViolations.length === 0,
      units: frozenUnits,
      violations: uniqueViolations,
      violationDetails: boundedViolationDetails,
    });
  }

  private reference(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 16);
  }

  private numbers(value: AuthorizedFactValue): number[] {
    if (typeof value === 'number') return [value];
    if (Array.isArray(value)) {
      return value.flatMap((item) => this.numbers(item));
    }
    if (this.isRecord(value)) {
      return Object.values(value).flatMap((item) => this.numbers(item));
    }
    return [];
  }

  private foods(value: AuthorizedFactValue): string[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (!this.isRecord(item) || typeof item.name !== 'string') return [];
      return [item.name];
    });
  }

  private hasLinkedFact(
    facts: readonly SanitizedConversationFact[],
    key: string,
  ): boolean {
    return facts.some((fact) => fact.key === key);
  }

  private hasLinkedMemoryFact(
    facts: readonly SanitizedConversationFact[],
  ): boolean {
    return facts.some((fact) => fact.source === 'MEMORY');
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim();
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
