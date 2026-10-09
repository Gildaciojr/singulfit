import { matchesFoodTerm } from './nutrition-advice.policy';
import { normalizeFoodTerm } from '../../context/food-preference-policy';
import type { OpenAIJsonSchema } from '../../ai/interfaces/openai.interface';

/** Semantic decomposition supplied in the existing generation, never a food catalog. */
export interface NutritionSuggestionComposition {
  readonly quote: string;
  readonly mainIngredients: readonly string[];
  readonly mainProtein: string | null;
  readonly accompaniments: readonly string[];
  readonly preparation: string | null;
}
export interface NutritionAdviceComposition {
  readonly previous: readonly NutritionSuggestionComposition[];
  readonly current: readonly NutritionSuggestionComposition[];
}
const suggestionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    quote: { type: 'string' },
    mainIngredients: { type: 'array', items: { type: 'string' } },
    mainProtein: { type: ['string', 'null'] },
    accompaniments: { type: 'array', items: { type: 'string' } },
    preparation: { type: ['string', 'null'] },
  },
  required: [
    'quote',
    'mainIngredients',
    'mainProtein',
    'accompaniments',
    'preparation',
  ],
};
export function nutritionCompositionSchema(
  base: OpenAIJsonSchema,
): OpenAIJsonSchema {
  const schema = base.schema as {
    properties: Record<string, unknown>;
    required: readonly string[];
  };
  return {
    ...base,
    name: 'coach_nutrition_composition',
    schema: {
      ...base.schema,
      properties: {
        ...schema.properties,
        nutritionComposition: {
          type: 'object',
          additionalProperties: false,
          properties: {
            previous: { type: 'array', items: suggestionSchema },
            current: { type: 'array', items: suggestionSchema },
          },
          required: ['previous', 'current'],
        },
      },
      required: [...schema.required, 'nutritionComposition'],
    },
  };
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function texts(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 12 &&
    value.every(
      (part) =>
        typeof part === 'string' &&
        part.trim().length > 0 &&
        part.length <= 100,
    )
  );
}
export function parseNutritionComposition(
  value: unknown,
): NutritionAdviceComposition | null {
  if (!record(value) || Object.keys(value).length !== 2) return null;
  const suggestions = (
    rows: unknown,
  ): rows is NutritionSuggestionComposition[] =>
    Array.isArray(rows) &&
    rows.length <= 8 &&
    rows.every(
      (row) =>
        record(row) &&
        Object.keys(row).length === 5 &&
        typeof row.quote === 'string' &&
        row.quote.length > 0 &&
        row.quote.length <= 4000 &&
        texts(row.mainIngredients) &&
        row.mainIngredients.length > 0 &&
        texts(row.accompaniments) &&
        (row.mainProtein === null ||
          (typeof row.mainProtein === 'string' &&
            row.mainIngredients.includes(row.mainProtein))) &&
        (row.preparation === null ||
          (typeof row.preparation === 'string' &&
            row.preparation.length <= 100)) &&
        [
          ...row.mainIngredients,
          ...row.accompaniments,
          ...(row.preparation ? [row.preparation] : []),
        ].every(
          (part) =>
            typeof row.quote === 'string' && matchesFoodTerm(row.quote, part),
        ),
    );
  return suggestions(value.previous) && suggestions(value.current)
    ? { previous: value.previous, current: value.current }
    : null;
}
/** Food identity is compared separately from prose and side dishes. Preparation
 * cannot disguise the same protein/staple pair as an entirely new option. */
export function repeatedNutritionComposition(
  composition: NutritionAdviceComposition,
): boolean {
  const identity = (value: string) => normalizeFoodTerm(value);
  return composition.current.some((candidate) =>
    composition.previous.some((prior) => {
      const left = new Set(prior.mainIngredients.map(identity));
      const right = new Set(candidate.mainIngredients.map(identity));
      const common = [...left].filter((food) =>
        [...right].some(
          (other) =>
            matchesFoodTerm(food, other) || matchesFoodTerm(other, food),
        ),
      ).length;
      const sameCore =
        common > 0 && common / Math.max(left.size, right.size) >= 0.8;
      const sameProtein =
        prior.mainProtein !== null &&
        candidate.mainProtein !== null &&
        (matchesFoodTerm(prior.mainProtein, candidate.mainProtein) ||
          matchesFoodTerm(candidate.mainProtein, prior.mainProtein));
      const samePreparation =
        prior.preparation !== null &&
        candidate.preparation !== null &&
        identity(prior.preparation) === identity(candidate.preparation);
      return (
        sameCore ||
        (sameProtein && common >= 2) ||
        (sameProtein &&
          samePreparation &&
          common / Math.min(left.size, right.size) >= 0.5)
      );
    }),
  );
}
export function nutritionCompositionViolation(
  composition: NutritionAdviceComposition,
  answer: string | null,
  previous: readonly string[],
  requirePrevious = false,
  trustedPrevious: readonly NutritionSuggestionComposition[] = [],
): string | null {
  const normalized = normalizeFoodTerm(answer ?? '');
  if (
    !composition.current.length ||
    composition.current.some(
      (option) => !normalized.includes(normalizeFoodTerm(option.quote)),
    )
  )
    return 'NUTRITION_ADVICE_COMPOSITION_UNSUPPORTED';
  if (
    composition.previous.some(
      (option) =>
        !previous.some((text) =>
          normalizeFoodTerm(text).includes(normalizeFoodTerm(option.quote)),
        ),
    )
  )
    return 'NUTRITION_ADVICE_COMPOSITION_UNSUPPORTED';
  if (requirePrevious && !composition.previous.length)
    return 'NUTRITION_ADVICE_COMPOSITION_UNSUPPORTED';
  // A candidate cannot hide a familiar central ingredient outside its decomposition.
  const described = [
    ...composition.current.flatMap((option) => [
      ...option.mainIngredients,
      ...option.accompaniments,
    ]),
  ];
  if (
    [...composition.previous, ...trustedPrevious].some((option) =>
      option.mainIngredients.some(
        (food) =>
          matchesFoodTerm(answer ?? '', food) &&
          !described.some(
            (ingredient) =>
              matchesFoodTerm(ingredient, food) ||
              matchesFoodTerm(food, ingredient),
          ),
      ),
    )
  )
    return 'NUTRITION_ADVICE_COMPOSITION_UNSUPPORTED';
  // The model's reconstruction is not the authority for the previous menu.
  // Full delivered texts also cover six-field legacy jobs and omissions in metadata.
  if (
    previous.some((text) =>
      composition.current.some((option) => {
        const matches = option.mainIngredients.filter((food) =>
          matchesFoodTerm(text, food),
        ).length;
        const proteinPresent =
          option.mainProtein !== null &&
          matchesFoodTerm(text, option.mainProtein);
        return (
          matches === option.mainIngredients.length ||
          (proteinPresent && matches >= 2)
        );
      }),
    )
  )
    return 'NUTRITION_ADVICE_REPEATS_PREVIOUS_SUGGESTION';
  return repeatedNutritionComposition({
    current: composition.current,
    previous: trustedPrevious,
  })
    ? 'NUTRITION_ADVICE_REPEATS_PREVIOUS_SUGGESTION'
    : null;
}
