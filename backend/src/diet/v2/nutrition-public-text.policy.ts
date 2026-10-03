import type { NutritionPlanningStrategy } from './nutrition-planning-strategy.contract';
import type { NutritionConstraintCode } from './nutrition-planning-context.contract';

function normalized(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Detect implementation commentary, not ordinary use of "conforme". */
export function isNutritionMetaText(value: string): boolean {
  return /\b(?:context|strategy|profile[_\s-]fields?|applied[_\s-]constraints?|excluded[_\s-]foods?)\b|\bconforme (?:(?:a|as|o|os|seu|seus|sua|suas) )?(?:exclus(?:ao|oes)|cadastros?|contexto)\b|\b(?:exclus(?:ao|oes)|restric(?:ao|oes)) (?:definid[ao]s?|cadastrad[ao]s?)\b|\bcontexto (?:nao\b|informa\b|fornece\b|disponivel\b)|preferencias adicionais nao informadas|alvo energetico estimado|macros estimados/u.test(
    normalized(value),
  );
}

const SAFETY_SUBJECTS: Readonly<
  Partial<Record<NutritionConstraintCode, RegExp>>
> = {
  LACTOSE:
    /\b(?:lactose|leite|queijos?|iogurtes?|requeijao|laticinios|derivados do leite)\b/u,
  MILK: /\b(?:leite|queijos?|iogurtes?|requeijao|laticinios|derivados do leite)\b/u,
  GLUTEN: /\b(?:gluten|trigo|paes|pao|macarrao|centeio|cevada)\b/u,
  PEANUT: /\bamendoim\b/u,
  TREE_NUT: /\b(?:castanhas?|nozes|amendoas?|avelas?)\b/u,
  EGG: /\b(?:ovos?|omeletes?)\b/u,
  SOY: /\b(?:soja|tofu)\b/u,
  FISH: /\b(?:peixes?|atum|sardinhas?|salmao)\b/u,
  SHELLFISH:
    /\b(?:mariscos?|crustaceos?|camarao|camaroes|lagostas?|frutos do mar)\b/u,
};

export type NutritionPublicNoteKind =
  | 'COMMON_REJECTION'
  | 'SAFETY_RELEVANT'
  | 'PUBLIC_GUIDANCE';

/** excludedFoods alone never establishes an allergy or medical restriction. */
export function classifyNutritionPublicNote(
  value: string,
  strategy: Pick<
    NutritionPlanningStrategy,
    'excludedFoods' | 'appliedConstraintCodes'
  >,
): NutritionPublicNoteKind {
  const text = normalized(value);
  const supportedSafety = strategy.appliedConstraintCodes.some(
    (code) =>
      SAFETY_SUBJECTS[code]?.test(text) ||
      (code === 'CUSTOM' &&
        /\b(?:alergia|intolerancia|contraindicacao|condicao de saude|orientacao medica)\b/u.test(
          text,
        )),
  );
  if (supportedSafety) return 'SAFETY_RELEVANT';
  const mentionsExcludedFood = strategy.excludedFoods.some((food) => {
    const name = normalized(food);
    return (
      name.length > 0 &&
      ` ${text.replace(/[^\p{L}\p{N} ]/gu, ' ')} `.includes(` ${name} `)
    );
  });
  return mentionsExcludedFood ? 'COMMON_REJECTION' : 'PUBLIC_GUIDANCE';
}
