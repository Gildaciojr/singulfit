import type { AuthorizedFactValue } from './conversation-authorized-facts.contract';
import type {
  ConversationLanguageUnit,
  ConversationLanguageUnitValidationResult,
  ConversationLanguageUnitViolationCode,
} from './conversation-language-unit.contract';
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

      if (
        unit.decisionCodes.some(
          (decision) => !block.decisions.includes(decision),
        )
      ) {
        violations.push('DECISION_NOT_AUTHORIZED');
      }
      if (unit.factKeys.some((fact) => !facts.has(fact))) {
        violations.push('FACT_NOT_AUTHORIZED');
      }
      if (unit.factKeys.some((fact) => !block.facts.includes(fact))) {
        violations.push('FACT_NOT_LINKED_TO_BLOCK');
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
      if (
        unit.claims.usesMemory &&
        !this.hasLinkedFact(linkedFacts, 'userContext.memory')
      ) {
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

    return Object.freeze({
      valid: uniqueViolations.length === 0,
      units: frozenUnits,
      violations: uniqueViolations,
    });
  }

  private numbers(value: AuthorizedFactValue): number[] {
    if (typeof value === 'number') return [value];
    if (Array.isArray(value)) {
      return value.flatMap((item) => this.numbers(item));
    }
    if (this.isRecord(value)) {
      return Object.values(value).flatMap((item) =>
        this.numbers(item as AuthorizedFactValue),
      );
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
