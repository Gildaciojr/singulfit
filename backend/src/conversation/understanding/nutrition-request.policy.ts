import { normalizeFoodTerm } from '../../context/food-preference-policy';

export type NutritionRequestIntent =
  | 'PLAN_LOOKUP'
  | 'NUTRITION_ADVICE'
  | 'MEAL_SUBSTITUTION'
  | 'CONSTRAINED_RECOMMENDATION';

export interface NutritionRequest {
  readonly intent: NutritionRequestIntent;
  readonly meal: string | null;
  readonly constraints: readonly string[];
  readonly substitutionPurpose?: 'PLAN_INQUIRY' | 'OFF_PLAN_ADVICE';
}

/** Meal advice is read-only unless the user explicitly asks to persist a change. */
export function nutritionRequest(value: string): NutritionRequest | null {
  const text = normalizeFoodTerm(value);
  const meal =
    text
      .match(
        /\b(?:lanche da tarde|lanche da manha|cafe da manha|almoco|jantar|janta|lanche|ceia|refeicao)\b/u,
      )?.[0]
      ?.replace(/^janta$/u, 'jantar') ?? null;
  const eatingQuestion =
    meal === null &&
    ((/\b(?:o que|que|qual)\b/u.test(text) &&
      /\b(?:comer|comida|rango|fome)\b/u.test(text)) ||
      /\b(?:o que|que)\s+(?:eu\s+)?como\b/u.test(text));
  const foodContext =
    meal !== null ||
    eatingQuestion ||
    /\b(?:comer|comida|alimento|alimentacao|dieta|cardapio|frango|arroz|banana|proteic[oa]s?|lactose|gluten|vegan\w*|vegetarian\w*)\b/u.test(
      text,
    ) ||
    /\b(?:algo|opcao)\b.*\b(?:leves?|rapid[oa]s?|pratic[oa]s?|barat[oa]s?|proteic[oa]s?)\b/u.test(
      text,
    );
  if (!foodContext) return null;
  const substitutionInquiry =
    /\b(?:posso|pode|podemos|previst\w*|cadastrad\w*)\b/u.test(text) &&
    /\b(?:tro(?:c|qu)\w*|substitu\w*)\b/u.test(text);
  // Keep explicit persistent mutations, full plans and their existing handoff.
  if (
    /\b(?:daqui para frente|permanentemente|definitivamente|atualiz\w*|persist\w*)\b/u.test(
      text,
    ) ||
    (!substitutionInquiry &&
      /\b(?:no meu plano|na minha dieta)\b/u.test(text) &&
      /\b(?:tro(?:c|qu)\w*|substitu\w*|mud\w*|alter\w*|adapte|inclua|crie|gere|monte)\b/u.test(
        text,
      )) ||
    (/\b(?:crie|gere|monte|refaca|quero|preciso)\b.*\b(?:plano alimentar|dieta|cardapio)\b/u.test(
      text,
    ) &&
      !/\b(?:dica|ideia|sugest\w*|opcao|alternativa)\b/u.test(text)) ||
    /^(?:troque|substitua|adapte|ajuste|altere|mude)\b/u.test(text) ||
    /^(?:quero|preciso|monte|crie|gere)\s+(?:(?:um|uma|o|a|meu|minha|novo|nova)\s+)*(?:plano de treino|treino|ficha)\b/u.test(
      text,
    )
  )
    return null;

  const constraints = [
    [/\b(?:rapid\w*|pratic\w*|sem tempo)\b/u, 'QUICK'],
    [/\b(?:barat\w*|economic\w*|baixo custo)\b/u, 'LOW_COST'],
    [/\b(?:proteic\w*|rico em proteina|mais proteina)\b/u, 'HIGH_PROTEIN'],
    [/\b(?:leve|leves)\b/u, 'LIGHT'],
    [/\bsem lactose\b/u, 'LACTOSE'],
    [/\bsem gluten\b/u, 'GLUTEN'],
    [/\b(?:sem leite|alergia (?:a|ao) leite)\b/u, 'MILK'],
    [/\b(?:sem ovos?|alergia (?:a|ao) ovos?)\b/u, 'EGG'],
    [/\b(?:sem amendoim|alergia (?:a|ao) amendoim)\b/u, 'PEANUT'],
    [/\bvegan\w*\b/u, 'VEGAN'],
    [/\bvegetarian\w*\b/u, 'VEGETARIAN'],
    [/\b(?:levar|transportar|trabalho)\b/u, 'PORTABLE'],
  ] as const;
  const requested = Object.freeze(
    constraints
      .filter(([pattern]) => pattern.test(text))
      .map(([, code]) => code),
  );
  const substitution =
    /\b(?:no lugar|em vez|nao tenho|tro(?:c|qu)\w*|substitu\w*)\b/u.test(text);
  const mealRequest =
    meal !== null &&
    (/\b(?:manda|mande|envie|envia)\b/u.test(text) ||
      /^(?:um|uma|e (?:pro|pra|para))\b/u.test(text));
  const advice =
    eatingQuestion ||
    mealRequest ||
    (substitution && /\b(?:o que|qual alimento|qual opcao)\b/u.test(text)) ||
    /\b(?:dica|ideia|sugest\w*|sug(?:er|ir)\w*|recomend\w*|indi(?:c|qu)\w*|opcao|alternativa|bom .*comer|comer .*bom|algo diferente)\b/u.test(
      text,
    ) ||
    (/\b(?:mont\w*|cri\w*)\b/u.test(text) && meal !== null) ||
    (/\b(?:quero|preciso|gostaria)\b/u.test(text) &&
      (meal !== null || requested.length > 0)) ||
    (/\b(?:comer|alimentar)\b/u.test(text) &&
      /\b(?:manha|tarde|noite)\b/u.test(text) &&
      /\b(?:posso|devo|seria|suger\w*)\b/u.test(text));
  const intent: NutritionRequestIntent | null = substitution
    ? 'MEAL_SUBSTITUTION'
    : advice && requested.length > 0
      ? 'CONSTRAINED_RECOMMENDATION'
      : advice
        ? 'NUTRITION_ADVICE'
        : /\b(?:qual|quais|quanto|quantidade|porcao|o que esta|mostre|consulta|perguntei|posso comer)\b/u.test(
              text,
            )
          ? 'PLAN_LOOKUP'
          : null;
  return intent
    ? Object.freeze({
        intent,
        meal,
        constraints: requested,
        ...(intent === 'MEAL_SUBSTITUTION'
          ? {
              substitutionPurpose:
                !substitutionInquiry &&
                (advice || /\bnao tenho\b/u.test(text)) &&
                !/\b(?:plano|dieta|previst\w*|cadastrad\w*)\b/u.test(text)
                  ? ('OFF_PLAN_ADVICE' as const)
                  : ('PLAN_INQUIRY' as const),
            }
          : {}),
      })
    : null;
}

export function isNutritionAdvice(value: string): boolean {
  const request = nutritionRequest(value);
  return request !== null && request.intent !== 'PLAN_LOOKUP';
}

/** A read-only request owns its target; deictic/elliptic replies still need context. */
export function selfContainedNutritionRequest(
  value: string,
): NutritionRequest | null {
  const request = nutritionRequest(value);
  if (!request || request.intent === 'PLAN_LOOKUP') return null;
  const text = normalizeFoodTerm(value);
  if (
    /\b(?:ess[ea]s?|est[ea]s?|aquel[ea]s?|isso|isto|aquilo|anterior|ultimo|ultima|primeir[oa]|segund[oa]|terceir[oa])\b/u.test(
      text,
    )
  )
    return null;
  const explicitFoodTarget =
    request.meal !== null ||
    /\b(?:comer|como|comida|rango|fome|alimentacao|alimento|dieta|cardapio|frango|arroz|banana)\b/u.test(
      text,
    );
  if (/\b(?:outr[oa]s?|mesm[oa]s?)\b/u.test(text) && !explicitFoodTarget)
    return null;
  return explicitFoodTarget ||
    (request.constraints.length > 0 &&
      /\b(?:manha|tarde|noite|sug(?:er|ir)\w*|recomend\w*|dica|ideia|opcao|alternativa)\b/u.test(
        text,
      ))
    ? request
    : null;
}
