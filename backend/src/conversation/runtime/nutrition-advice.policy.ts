import type { ConversationAIValue } from '../../ai/conversation-ai.contract';
import type { CoachConversationHumanContext } from '../../context/coach-conversation-human-context.contract';
import { normalizeFoodTerm } from '../../context/food-preference-policy';
import { CoachProactiveSchedulePolicy } from '../../automation/coach-proactive-schedule.policy';
import { NutritionPlanningContextBuilder } from '../../diet/v2/nutrition-planning-context.builder';
import { CONSTRAINT_TERMS } from '../../diet/v2/nutrition-plan-v2.validator';
import { NUTRITION_CONSTRAINT_CODE } from '../../diet/v2/nutrition-planning-context.contract';
import type { PublicNutritionResponse } from '../../diet/v2/presentation/public-nutrition-response.contract';
import {
  nutritionRequest,
  type NutritionRequest,
} from '../understanding/nutrition-request.policy';
import type { ConversationAnswerCandidate } from './conversation-qa.contract';

export interface NutritionAdviceContext {
  readonly request: NutritionRequest;
  readonly immediateConstraints: readonly string[];
  readonly safetyConstraints: readonly string[];
  readonly excludedFoods: readonly string[];
  readonly originalMeals: readonly PublicNutritionResponse['days'][number]['meals'][number][];
  readonly recentSuggestions: readonly string[];
  readonly unresolvedSafety: boolean;
  readonly unresolvedOriginalMeal: boolean;
  readonly temporalContext: ConversationAIValue;
}

const constraintBuilder = new NutritionPlanningContextBuilder();

function matchesFoodTerm(text: string, food: string): boolean {
  const term = normalizeFoodTerm(food);
  if (!term) return false;
  const pattern = term
    .split(' ')
    .map((word) => {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return `${escaped}${word.endsWith('s') ? '' : 's?'}`;
    })
    .join('\\s+');
  return new RegExp(`\\b${pattern}\\b`, 'u').test(normalizeFoodTerm(text));
}

function record(
  value: ConversationAIValue | undefined,
): value is { readonly [key: string]: ConversationAIValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function datum(value: ConversationAIValue | undefined): readonly string[] {
  if (
    !record(value) ||
    (value.status !== 'KNOWN' && value.status !== 'REQUIRES_CONFIRMATION')
  )
    return [];
  const values = Array.isArray(value.value) ? value.value : [value.value];
  return values.flatMap((item) =>
    typeof item === 'string'
      ? [item]
      : record(item) && typeof item.description === 'string'
        ? [
            `${typeof item.type === 'string' ? item.type : ''} ${item.description}`.trim(),
          ]
        : [],
  );
}

export function nutritionAdviceContext(
  human: CoachConversationHumanContext,
  personalized: ConversationAIValue,
  plan: PublicNutritionResponse | null,
  previousAnswer: string | null,
  referenceDate: Date,
): NutritionAdviceContext | null {
  const request = nutritionRequest(human.currentMessage);
  if (!request || request.intent === 'PLAN_LOOKUP') return null;
  const safety =
    record(personalized) && record(personalized.safety)
      ? personalized.safety
      : {};
  const clock = new CoachProactiveSchedulePolicy();
  const nutrition =
    record(personalized) && record(personalized.nutrition)
      ? personalized.nutrition
      : {};
  const restrictions = personalized
    ? [
        ...datum(safety.foodRestrictions),
        ...datum(safety.allergies),
        ...datum(nutrition.foodIntolerances),
        ...datum(nutrition.dietaryPattern),
      ]
    : [
        ...(human.restrictions?.value ?? []),
        ...(human.nutrition.dietaryPattern?.value
          ? [human.nutrition.dietaryPattern.value]
          : []),
      ];
  const declared = datum(nutrition.declaredFoodRejections);
  const preferences =
    record(personalized) && record(personalized.preferences)
      ? personalized.preferences
      : {};
  const foods =
    record(preferences.foodPreferences) &&
    Array.isArray(preferences.foodPreferences.value)
      ? preferences.foodPreferences.value
      : [];
  const excludedFoods = [
    ...(human.nutrition.rejectedFoods?.value ?? []),
    ...declared,
    ...foods.flatMap((item) =>
      record(item) &&
      (item.kind === 'AVOIDED' || item.kind === 'REJECTED') &&
      typeof item.foodName === 'string'
        ? [item.foodName]
        : [],
    ),
  ];
  const meals = plan?.days.flatMap((day) => day.meals) ?? [];
  const originalMeals = request.meal
    ? meals.filter((meal) => {
        const name = normalizeFoodTerm(meal.name);
        return (
          name.includes(request.meal ?? '') ||
          (request.meal === 'lanche' && name.includes('lanche'))
        );
      })
    : meals;
  const history =
    record(personalized) && Array.isArray(personalized.recentConversation)
      ? personalized.recentConversation.flatMap((turn) =>
          record(turn) &&
          turn.direction === 'OUTBOUND' &&
          typeof turn.text === 'string'
            ? [turn.text]
            : [],
        )
      : (human.recentConversation ?? [])
          .filter((turn) => turn.direction === 'COACH')
          .map((turn) => turn.text);
  return Object.freeze({
    request,
    immediateConstraints: request.constraints,
    safetyConstraints: Object.freeze([
      ...new Set([
        ...request.constraints.filter((constraint) =>
          Object.hasOwn(NUTRITION_CONSTRAINT_CODE, constraint),
        ),
        ...restrictions,
      ]),
    ]),
    excludedFoods: Object.freeze([...new Set(excludedFoods)]),
    originalMeals: Object.freeze(
      originalMeals.length > 0 ? originalMeals : meals,
    ),
    unresolvedOriginalMeal:
      request.intent === 'MEAL_SUBSTITUTION' &&
      request.meal !== null &&
      request.meal !== 'refeicao' &&
      originalMeals.length === 0,
    recentSuggestions: Object.freeze(
      [...history, ...(previousAnswer ? [previousAnswer] : [])].slice(-3),
    ),
    unresolvedSafety:
      [
        safety.foodRestrictions,
        safety.allergies,
        nutrition.foodIntolerances,
      ].some(
        (value) =>
          record(value) &&
          (value.status === 'CONFLICTED' ||
            (value.status === 'REQUIRES_CONFIRMATION' &&
              datum(value).length > 0)),
      ) ||
      (record(personalized) &&
        [personalized.profileFields, personalized.conflicts].some(
          (values) =>
            Array.isArray(values) &&
            values.some(
              (value) =>
                record(value) &&
                typeof value.field === 'string' &&
                [
                  'ALLERGIES',
                  'FOOD_INTOLERANCES',
                  'FOOD_RESTRICTIONS',
                ].includes(value.field) &&
                (value.status === 'CONFLICTED' || value.status === undefined),
            ),
        )),
    temporalContext:
      record(personalized) && personalized.temporalContext
        ? personalized.temporalContext
        : {
            referenceDate: referenceDate.toISOString(),
            timezone: clock.timezone(),
            local: clock.parts(referenceDate, clock.timezone()),
          },
  });
}

export function nutritionAdvicePayload(
  context: NutritionAdviceContext | null,
): ConversationAIValue {
  if (!context) return null;
  return Object.freeze({
    intent: context.request.intent,
    meal: context.request.meal,
    immediateConstraints: context.immediateConstraints,
    safetyConstraints: context.safetyConstraints,
    excludedFoods: context.excludedFoods,
    unresolvedSafety: context.unresolvedSafety,
    unresolvedOriginalMeal: context.unresolvedOriginalMeal,
    temporalContext: context.temporalContext,
    originalMeals: context.originalMeals.map((meal) => ({
      name: meal.name,
      time: meal.time ?? null,
      items: meal.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
      })),
    })),
    recentSuggestions: context.recentSuggestions,
    policy: {
      readOnly: true,
      currentPlanRole: 'CONTEXT_NOT_ANSWER',
      preserveApproximateNutritionalFunction:
        context.request.intent === 'MEAL_SUBSTITUTION',
      instructions:
        'Entregue uma ideia concreta nova, plausível e compatível com o objetivo, perfil, horário local, rotina, preferências e todas as alergias/restrições fornecidas. O plano orienta a estratégia; não copie a composição da refeição de originalMeals. Ingredientes isolados podem ser reutilizados em uma combinação diferente. Combine todas as immediateConstraints: QUICK significa pouco preparo, HIGH_PROTEIN significa incluir fonte compatível de proteína, LOW_COST significa acessível, PORTABLE significa fácil de transportar; LACTOSE/GLUTEN são exclusões obrigatórias. Não invente alergias nem preferências. Em MEAL_SUBSTITUTION, entenda a refeição original e preserve aproximadamente sua função nutricional, sem prometer equivalência exata de calorias/macros; apresente como alternativa para essa refeição, sem afirmar alteração do plano. Varie em relação às recentSuggestions quando houver alternativas compatíveis. Responda em um ou dois parágrafos curtos, com uma opção principal e no máximo uma alternativa útil, sem menu numerado ou preâmbulo genérico. Se faltar contexto essencial de segurança ou da refeição a substituir, faça apenas uma pergunta útil. Conhecimento geral não clínico é permitido; não é necessário que a sugestão esteja cadastrada no plano.',
    },
  });
}

/** Conservative public boundary: invalid advice never reaches delivery or a plan writer. */
export function nutritionAdviceViolation(
  context: NutritionAdviceContext | null,
  candidate: ConversationAnswerCandidate,
): string | null {
  if (!context) return null;
  if (candidate.disposition === 'ANSWER' && context.unresolvedSafety)
    return 'NUTRITION_ADVICE_UNRESOLVED_SAFETY';
  if (candidate.disposition === 'ANSWER' && candidate.domain !== 'NUTRITION')
    return 'NUTRITION_ADVICE_WRONG_DOMAIN';
  const text = normalizeFoodTerm(
    [candidate.answer, candidate.followUpQuestion].filter(Boolean).join(' '),
  );
  for (const constraint of context.safetyConstraints) {
    const directCode = constraint.trim().toUpperCase();
    const code = Object.hasOwn(NUTRITION_CONSTRAINT_CODE, directCode)
      ? directCode
      : constraintBuilder.constraintCode(constraint);
    // Lactose-free dairy remains forbidden for a milk allergy.
    const checked =
      code === 'LACTOSE'
        ? text.replace(
            /\b(?:leite|queijo|iogurte|requeijao)(?:\s+\w+){0,2}\s+(?:sem|zero) lactose\b/gu,
            '',
          )
        : text;
    if (
      (CONSTRAINT_TERMS[code] ?? []).some((term) =>
        matchesFoodTerm(checked, term),
      )
    )
      return 'NUTRITION_ADVICE_UNSAFE_FOOD';
    if (code === 'VEGETARIAN' || code === 'VEGAN') {
      const animalTerms = [
        ...CONSTRAINT_TERMS.FISH,
        ...CONSTRAINT_TERMS.SHELLFISH,
        ...(code === 'VEGAN'
          ? [...CONSTRAINT_TERMS.MILK, ...CONSTRAINT_TERMS.EGG]
          : []),
      ];
      if (
        ['carne', 'frango', 'bife', 'presunto', 'bacon', ...animalTerms].some(
          (term) => matchesFoodTerm(text, term),
        )
      )
        return 'NUTRITION_ADVICE_UNSAFE_FOOD';
    }
    if (code === 'CUSTOM') {
      const food = normalizeFoodTerm(constraint).replace(
        /^(?:alergia|intolerancia|restricao)(?: alimentar)?(?: a| ao| de)? /u,
        '',
      );
      if (matchesFoodTerm(text, food)) return 'NUTRITION_ADVICE_UNSAFE_FOOD';
    }
  }
  if (context.excludedFoods.some((food) => matchesFoodTerm(text, food)))
    return 'NUTRITION_ADVICE_REJECTED_FOOD';
  if (candidate.disposition !== 'ANSWER') return null;
  for (const meal of context.originalMeals) {
    if (meal.items.length < 2) continue;
    const copied = meal.items.every((item) => {
      const terms = normalizeFoodTerm(item.name)
        .split(' ')
        .filter(
          (term) =>
            term.length >= 4 &&
            !/^(?:cozid\w*|grelhad\w*|assad\w*|natural|integral|peito)$/u.test(
              term,
            ),
        );
      return (
        terms.length > 0 && terms.some((term) => matchesFoodTerm(text, term))
      );
    });
    if (copied) return 'NUTRITION_ADVICE_REPEATS_CURRENT_MEAL';
  }
  if (
    /\b(?:atualizei|alterei|mudei|salvei|substitui)\b.*\b(?:plano|dieta)\b/u.test(
      text,
    )
  )
    return 'NUTRITION_ADVICE_FALSE_MUTATION';
  return null;
}
