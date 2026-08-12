import { FitnessGoal } from '@prisma/client';
import type {
  NutritionPlanFoodItem,
  NutritionPlanV2,
} from '../nutrition-plan-v2.contract';
import type {
  PublicNutritionMacroTargets,
  PublicNutritionResponse,
} from './public-nutrition-response.contract';

const INTERNAL_TERM =
  /\b(?:onboarding|nutrition[_\s-]?v2(?:[_\s-]?eligible)?|diet[_\s-]?v2|legacy|operationkey|correlationid|executor|pilotstatus|artefato|artifact)\b/iu;
const UUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu;
const TECHNICAL_SENTINEL = /(?:\b(?:null|undefined|NaN)\b|\[object Object\])/iu;
const GENERIC_CLINICAL_DISCLAIMER =
  /^(?:este|o) plano(?: alimentar)? (?:é estrutural e )?não (?:configura|constitui) (?:um )?tratamento cl[ií]nico[.!]?$/iu;
const PUBLIC_CLINICAL_GUIDANCE =
  'Se você tiver alguma condição de saúde ou orientação médica específica, me avise e alinhe o plano com um nutricionista ou médico.';
const GENERIC_NON_CLINICAL_DISCLAIMER =
  /^plano estrutural sem car[aá]ter cl[ií]nico[.!]?$/iu;
const GENERIC_PRESCRIPTION_DISCLAIMER =
  /^não inclui prescri[cç][aã]o de suplementos, medicamentos ou tratamento[.!]?$/iu;
const PUBLIC_PRESCRIPTION_GUIDANCE =
  'Não inicie suplementos ou medicamentos por conta própria; siga a orientação de um profissional de saúde.';
const GENERIC_UNKNOWN_HEALTH_DISCLAIMER =
  /^não foram inferidas alergias ou condi[cç][oõ]es de sa[uú]de al[eé]m dos dados fornecidos[.!]?$/iu;
const PUBLIC_UNKNOWN_HEALTH_GUIDANCE =
  'Se existir alguma alergia ou condição de saúde que ainda não tenha sido informada, me avise antes de ajustar o plano.';

export interface BuildPublicNutritionResponseInput {
  readonly plan: NutritionPlanV2;
  readonly userDisplayName?: string;
}

export class PublicNutritionResponseBuilder {
  build(input: BuildPublicNutritionResponseInput): PublicNutritionResponse {
    const plan = input.plan;
    const items = this.itemIndex(plan);
    const substitutions = plan.substitutions.flatMap((substitution) => {
      const source = items.get(substitution.sourceItemKey);
      const alternative = items.get(substitution.alternativeItemKey);
      const sourceName = source && this.publicText(source.foodName);
      const alternativeName =
        alternative && this.publicText(alternative.foodName);
      return sourceName && alternativeName
        ? [
            Object.freeze({
              source: sourceName,
              alternative: alternativeName,
            }),
          ]
        : [];
    });
    const safetyGuidance = this.publicSafety(plan.safetyNotes);
    const generalGuidance = this.distinctPublicLines(plan.guidance);
    const adaptationGuidance = this.distinctPublicLines(
      plan.adaptationRules,
      new Set(generalGuidance.map((value) => this.lineKey(value))),
    );

    return Object.freeze({
      userFirstName: this.firstName(input.userDisplayName),
      title: 'Seu plano alimentar',
      summary: this.summary(plan),
      goal: this.goal(plan),
      energyTargetKcal: this.positiveValue(plan.strategy.energyTargetKcal),
      macroTargets: this.macros(plan),
      days: Object.freeze(
        plan.days.map((day) =>
          Object.freeze({
            label:
              plan.days.length > 1 ? this.publicText(day.label) : undefined,
            meals: Object.freeze(
              day.meals.map((meal) =>
                Object.freeze({
                  name: this.requiredText(meal.name, 'Refeição'),
                  time: meal.suggestedTime ?? undefined,
                  items: Object.freeze(
                    meal.items.map((item) =>
                      Object.freeze({
                        name: this.requiredText(item.foodName, 'Alimento'),
                        quantity: this.requiredText(
                          item.quantity,
                          'porção indicada',
                        ),
                      }),
                    ),
                  ),
                }),
              ),
            ),
          }),
        ),
      ),
      substitutions: Object.freeze(substitutions),
      hydrationGuidance: this.publicLines(plan.hydrationGuidance),
      generalGuidance,
      adaptationGuidance,
      safetyGuidance,
    });
  }

  private summary(plan: NutritionPlanV2): string {
    const goal = this.goal(plan);
    return goal
      ? `Organizei as refeições para apoiar seu objetivo de ${goal}.`
      : 'Organizei suas refeições de forma prática para o dia a dia.';
  }

  private goal(plan: NutritionPlanV2): string | undefined {
    if (plan.strategy.objective.status === 'NOT_SET') return undefined;
    switch (plan.strategy.objective.value) {
      case FitnessGoal.WEIGHT_LOSS:
        return 'emagrecimento';
      case FitnessGoal.MUSCLE_GAIN:
        return 'ganho de massa muscular';
      case FitnessGoal.MAINTENANCE:
        return 'manutenção';
    }
  }

  private macros(
    plan: NutritionPlanV2,
  ): PublicNutritionMacroTargets | undefined {
    if (plan.strategy.macroTargets.status === 'NOT_SET') return undefined;
    const targets = plan.strategy.macroTargets.value;
    const macros = {
      proteinGrams: this.positiveNumber(targets.proteinGrams),
      carbohydrateGrams: this.positiveNumber(targets.carbohydrateGrams),
      fatGrams: this.positiveNumber(targets.fatGrams),
    };
    return Object.values(macros).some((value) => value !== undefined)
      ? Object.freeze(macros)
      : undefined;
  }

  private itemIndex(plan: NutritionPlanV2): Map<string, NutritionPlanFoodItem> {
    const items = new Map<string, NutritionPlanFoodItem>();
    for (const day of plan.days) {
      for (const meal of day.meals) {
        for (const item of [...meal.items, ...(meal.alternatives ?? [])]) {
          items.set(item.itemKey, item);
        }
      }
    }
    return items;
  }

  private publicSafety(values: readonly string[]): readonly string[] {
    if (values.length === 0) return Object.freeze([]);
    const projected: string[] = [];
    for (const value of values) {
      const safe = this.publicText(value);
      if (!safe) continue;
      const projection = this.safetyProjection(safe);
      if (!projected.includes(projection)) projected.push(projection);
    }
    return Object.freeze(projected);
  }

  private safetyProjection(value: string): string {
    if (
      GENERIC_CLINICAL_DISCLAIMER.test(value) ||
      GENERIC_NON_CLINICAL_DISCLAIMER.test(value)
    ) {
      return PUBLIC_CLINICAL_GUIDANCE;
    }
    if (GENERIC_PRESCRIPTION_DISCLAIMER.test(value)) {
      return PUBLIC_PRESCRIPTION_GUIDANCE;
    }
    if (GENERIC_UNKNOWN_HEALTH_DISCLAIMER.test(value)) {
      return PUBLIC_UNKNOWN_HEALTH_GUIDANCE;
    }
    return value;
  }

  private distinctPublicLines(
    values: readonly string[],
    excludedKeys: ReadonlySet<string> = new Set<string>(),
  ): readonly string[] {
    const seen = new Set(excludedKeys);
    const distinct: string[] = [];
    for (const value of values) {
      const safe = this.publicText(value);
      if (!safe) continue;
      const key = this.lineKey(safe);
      if (seen.has(key)) continue;
      seen.add(key);
      distinct.push(safe);
    }
    return Object.freeze(distinct);
  }

  private lineKey(value: string): string {
    return value
      .normalize('NFC')
      .replace(/\s+/gu, ' ')
      .trim()
      .toLocaleLowerCase('pt-BR');
  }

  private publicLines(values: readonly string[]): readonly string[] {
    return Object.freeze(
      values.flatMap((value) => {
        const safe = this.publicText(value);
        return safe ? [safe] : [];
      }),
    );
  }

  private requiredText(value: string, fallback: string): string {
    return this.publicText(value) ?? fallback;
  }

  private publicText(value: string): string | undefined {
    const trimmed = value.trim();
    return trimmed &&
      !INTERNAL_TERM.test(trimmed) &&
      !UUID.test(trimmed) &&
      !TECHNICAL_SENTINEL.test(trimmed)
      ? trimmed
      : undefined;
  }

  private firstName(displayName: string | undefined): string | undefined {
    const first = displayName?.trim().split(/\s+/u)[0];
    return first && /^[\p{L}][\p{L}'’-]{0,39}$/u.test(first)
      ? first
      : undefined;
  }

  private positiveValue(
    value: NutritionPlanV2['strategy']['energyTargetKcal'],
  ): number | undefined {
    return value.status === 'NOT_SET'
      ? undefined
      : this.positiveNumber(value.value);
  }

  private positiveNumber(value: number): number | undefined {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }
}
