import type { ConversationAIValue } from '../../ai/conversation-ai.contract';
import type { CoachConversationHumanContext } from '../../context/coach-conversation-human-context.contract';
import {
  isSemanticFoodTerm,
  normalizeFoodTerm,
} from '../../context/food-preference-policy';
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
  readonly substitutionEvidence: Readonly<{
    status: 'REGISTERED' | 'NOT_REGISTERED' | 'UNRESOLVED';
    meal: string | null;
    source: string | null;
    requestedAlternative: string | null;
    registered: readonly PublicNutritionResponse['substitutions'][number][];
    unresolvedAlternative?: boolean;
  }> | null;
  readonly compatibleFoods?: readonly Readonly<{
    name: string;
    source: 'CURRENT_PLAN' | 'PROFILE_PREFERENCE';
  }>[];
  readonly immediateConstraints: readonly string[];
  readonly safetyConstraints: readonly string[];
  readonly excludedFoods: readonly string[];
  readonly originalMeals: readonly PublicNutritionResponse['days'][number]['meals'][number][];
  readonly recentSuggestions: readonly string[];
  readonly previousAdvice?: string | null;
  readonly unresolvedSafety: boolean;
  readonly unresolvedOriginalMeal: boolean;
  readonly temporalContext: ConversationAIValue;
}

const constraintBuilder = new NutritionPlanningContextBuilder();

export function matchesFoodTerm(text: string, food: string): boolean {
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

/** Lexical composition, not food taxonomy: presentation and preparation are not ingredients. */
export function materiallyRepeatsNutritionAdvice(
  previous: string,
  candidate: string,
): boolean {
  const functional = new Set(
    'a o as os um uma uns umas de do da dos das e com para por ao na no nas nos que meu minha seu sua voce pode uma opcao alternativa ideia sugestao jantar almoco lanche refeicao cafe manha tarde noite prepare preparar experimente experimentar escolha escolher sirva servir boa bom deliciosa delicioso simples pratica pratico nova novo diferente'.split(
      ' ',
    ),
  );
  const signature = (value: string): readonly string[] => [
    ...new Set(
      normalizeFoodTerm(value)
        .split(' ')
        .filter(
          (term) =>
            term.length > 2 &&
            !functional.has(term) &&
            !/^(?:cozid|grelhad|assad|refogad)\w*$/u.test(term),
        ),
    ),
  ];
  const left = signature(previous);
  const right = signature(candidate);
  if (left.length < 2 || right.length < 2) return false;
  const remaining = [...right];
  let common = 0;
  for (const term of left) {
    const index = remaining.findIndex(
      (other) => matchesFoodTerm(term, other) || matchesFoodTerm(other, term),
    );
    if (index >= 0) {
      common++;
      remaining.splice(index, 1);
    }
  }
  return common >= 2 && (2 * common) / (left.length + right.length) >= 0.8;
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
  const inboundHistory = [
    ...(human.recentConversation ?? [])
      .filter((turn) => turn.direction === 'USER')
      .map((turn) => turn.text),
    ...(record(personalized) && Array.isArray(personalized.recentConversation)
      ? personalized.recentConversation.flatMap((turn) =>
          record(turn) &&
          turn.direction === 'INBOUND' &&
          typeof turn.text === 'string'
            ? [turn.text]
            : [],
        )
      : []),
  ];
  const precedingRequest = [...inboundHistory]
    .reverse()
    .find((text) => nutritionRequest(text)?.intent === 'MEAL_SUBSTITUTION');
  const request =
    human.effectiveNutritionRequest ??
    nutritionRequest(human.currentMessage) ??
    (precedingRequest &&
    /\b(?:tro(?:c|qu)\w*|substitu\w*)\b/u.test(
      normalizeFoodTerm(human.currentMessage),
    )
      ? nutritionRequest(`${human.currentMessage} ${precedingRequest}`)
      : null);

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
  ].filter(isSemanticFoodTerm);
  const targetMeal =
    request.meal ??
    (request.intent === 'MEAL_SUBSTITUTION'
      ? ([...inboundHistory]
          .reverse()
          .map(nutritionRequest)
          .find((prior) => prior?.meal)?.meal ?? null)
      : null);
  const meals = plan?.days.flatMap((day) => day.meals) ?? [];
  const originalMeals = targetMeal
    ? meals.filter((meal) => {
        const name = normalizeFoodTerm(meal.name);
        return (
          name.includes(targetMeal ?? '') ||
          (targetMeal === 'lanche' && name.includes('lanche'))
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
  // Roles come from explicit quoted spans, not global plan membership. The QA
  // model retains full language/history for ambiguity; uncertain facts stay so.
  const grammaticalTerms = new Set([
    'o',
    'a',
    'os',
    'as',
    'de',
    'do',
    'da',
    'dos',
    'das',
    'um',
    'uma',
    'meu',
    'minha',
    'meus',
    'minhas',
  ]);
  const foodTokens = (value: string) =>
    normalizeFoodTerm(value)
      .split(' ')
      .filter((term) => term && !grammaticalTerms.has(term))
      .map((term) =>
        term.length > 3 && term.endsWith('s') ? term.slice(0, -1) : term,
      );
  const cleanSpan = (value: string) => {
    let text = normalizeFoodTerm(value);
    // Question polarity and a resolved meal are context, not extra ingredients.
    if (text.endsWith(' ou nao')) text = text.slice(0, -' ou nao'.length);
    const mealNames = new Set([
      ...(targetMeal ? [targetMeal] : []),
      ...originalMeals.map((meal) => normalizeFoodTerm(meal.name)),
    ]);
    for (const meal of mealNames) {
      for (const preposition of ['no', 'na', 'em', 'para o', 'para a']) {
        const suffix = ` ${preposition} ${meal}`;
        if (text.endsWith(suffix)) text = text.slice(0, -suffix.length);
      }
    }
    return text.trim();
  };
  const exchange = (
    value: string,
  ): { source: string; alternative: string } | null => {
    const text = normalizeFoodTerm(value.split(/[?.!;]/u)[0]);
    const direct = text.match(
      /\b(?:tro(?:c|qu)\w*|substitu\w*)\s+(.+?)\s+por\s+(.+)/u,
    );
    if (direct)
      return {
        source: cleanSpan(direct[1]),
        alternative: cleanSpan(direct[2]),
      };
    const inverse = text.match(
      /(.+?)\s+(?:no lugar|em vez)\s+(?:de|do|da|dos|das)\s+(.+)/u,
    );
    if (!inverse) return null;
    const before = inverse[1].split(' ');
    const action = before.findLastIndex((term) =>
      ['comer', 'usar', 'colocar'].includes(term),
    );
    return {
      source: cleanSpan(inverse[2]),
      alternative: cleanSpan(before.slice(action + 1).join(' ')),
    };
  };
  const currentExchange = exchange(human.currentMessage);
  const priorExchange = [...inboundHistory]
    .reverse()
    .map(exchange)
    .find(Boolean);
  const roles = currentExchange ?? priorExchange;
  const sourceSpan = roles?.source || null;
  const alternativeSpan =
    roles?.alternative && foodTokens(roles.alternative).length
      ? roles.alternative
      : null;
  const foodDescriptor =
    /^(?:cozid[oa]s?|grelhad[oa]s?|assad[oa]s?|peito|file|mexid[oa]s?|integral)$/u;
  const foodMentioned = (text: string, food: string) => {
    const terms = normalizeFoodTerm(food)
      .split(' ')
      .filter((term) => term.length >= 3 && !foodDescriptor.test(term));
    return (
      terms.length > 0 &&
      terms.every((term) =>
        matchesFoodTerm(text, term.endsWith('s') ? term.slice(0, -1) : term),
      )
    );
  };
  const sourceItems = sourceSpan
    ? originalMeals
        .flatMap((meal) => meal.items)
        .filter((item) => foodMentioned(sourceSpan, item.name))
    : [];
  const sourceNames = [...new Set(sourceItems.map((item) => item.name))];
  const source = sourceNames.length === 1 ? sourceNames[0] : null;
  const sourceMeals = originalMeals.filter((meal) =>
    meal.items.some((item) => item.name === source),
  );
  const sourceMealNames = [...new Set(sourceMeals.map((meal) => meal.name))];
  const resolvedMeal =
    targetMeal ?? (sourceMealNames.length === 1 ? sourceMealNames[0] : null);
  const identity = (value: string) => foodTokens(value).join(' ');
  const containsWholeMention = (mention: string, name: string) => {
    const terms = foodTokens(mention);
    const named = new Set(foodTokens(name));
    return terms.length > 0 && terms.every((term) => named.has(term));
  };
  const alternativeIdentities = [
    ...new Set(
      [
        ...meals.flatMap((meal) => meal.items.map((item) => item.name)),
        ...(plan?.substitutions.map((swap) => swap.alternative) ?? []),
      ]
        .filter((name) => {
          if (!alternativeSpan || !containsWholeMention(alternativeSpan, name))
            return false;
          const requested = new Set(foodTokens(alternativeSpan));
          return foodTokens(name).every(
            (term) => requested.has(term) || foodDescriptor.test(term),
          );
        })
        .map(identity),
    ),
  ];
  const exactAlternative = alternativeSpan ? identity(alternativeSpan) : null;
  const unresolvedAlternative =
    !!alternativeSpan &&
    alternativeIdentities.length > 1 &&
    !alternativeIdentities.includes(exactAlternative ?? '');
  const completeSource =
    !!source &&
    !!sourceSpan &&
    containsWholeMention(
      foodTokens(sourceSpan)
        .filter((term) => term !== 'peito' && term !== 'file')
        .join(' '),
      source,
    );
  const registered =
    source &&
    alternativeSpan &&
    plan &&
    resolvedMeal &&
    completeSource &&
    !unresolvedAlternative
      ? plan.substitutions.filter(
          (swap) =>
            identity(source) === identity(swap.source) &&
            (identity(swap.alternative) === exactAlternative ||
              (alternativeIdentities.length === 1 &&
                alternativeIdentities[0] === identity(swap.alternative))),
        )
      : [];
  const substitutionEvidence: NutritionAdviceContext['substitutionEvidence'] =
    request.intent === 'MEAL_SUBSTITUTION'
      ? {
          status:
            !source ||
            !alternativeSpan ||
            !plan ||
            !resolvedMeal ||
            unresolvedAlternative
              ? 'UNRESOLVED'
              : registered.length
                ? 'REGISTERED'
                : 'NOT_REGISTERED',
          meal: resolvedMeal,
          source,
          requestedAlternative: alternativeSpan
            ? normalizeFoodTerm(alternativeSpan)
            : null,
          registered,
          ...(unresolvedAlternative ? { unresolvedAlternative: true } : {}),
        }
      : null;
  const context: NutritionAdviceContext = Object.freeze({
    request,
    substitutionEvidence,
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
      request.substitutionPurpose !== 'OFF_PLAN_ADVICE' &&
      request.meal !== null &&
      request.meal !== 'refeicao' &&
      originalMeals.length === 0,
    recentSuggestions: Object.freeze(
      [...history, ...(previousAnswer ? [previousAnswer] : [])].slice(-3),
    ),
    previousAdvice:
      human.currentReadOnlyReferent?.domain === 'NUTRITION'
        ? previousAnswer
        : null,
    unresolvedSafety:
      [
        safety.foodRestrictions,
        safety.allergies,
        nutrition.foodIntolerances,
        nutrition.dietaryPattern,
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
  const candidates: NonNullable<NutritionAdviceContext['compatibleFoods']> = [
    ...meals.flatMap((meal) =>
      meal.items.map((item) => ({
        name: item.name,
        source: 'CURRENT_PLAN' as const,
      })),
    ),
    ...(human.nutrition.preferredFoods?.value ?? []).map((name) => ({
      name,
      source: 'PROFILE_PREFERENCE' as const,
    })),
  ];
  const seen = new Set<string>();
  const compatibleFoods = context.unresolvedSafety
    ? []
    : candidates.filter((food) => {
        const key = normalizeFoodTerm(food.name);
        if (
          !isSemanticFoodTerm(food.name) ||
          seen.has(key) ||
          nutritionAdviceFoodViolation(context, food.name)
        )
          return false;
        seen.add(key);
        return true;
      });
  return Object.freeze({
    ...context,
    compatibleFoods: Object.freeze(compatibleFoods),
  });
}

/** Public plan decisions are domain facts, never an authorization inferred from AI prose. */
export function nutritionSubstitutionAnswer(
  context: NutritionAdviceContext | null,
): ConversationAnswerCandidate | null {
  if (
    context?.request.intent !== 'MEAL_SUBSTITUTION' ||
    context.request.substitutionPurpose === 'OFF_PLAN_ADVICE'
  )
    return null;
  const evidence = context.substitutionEvidence;
  const meal = evidence?.meal
    ? (context.originalMeals.find((original) =>
        matchesFoodTerm(original.name, evidence.meal ?? ''),
      )?.name ?? evidence.meal)
    : null;
  const registered = evidence?.registered[0];
  if (evidence?.status === 'REGISTERED' && registered) {
    return {
      disposition: 'ANSWER',
      domain: 'NUTRITION',
      answer: `${meal ? `Para ${meal}, o` : 'O'} plano registra a troca de ${registered.source} por ${registered.alternative}. Isso confirma o cadastro, não uma equivalência adicional de porções ou nutrientes.`,
      followUpQuestion: null,
      grounding: 'CURRENT_PLAN',
      confidence: 'HIGH',
    };
  }
  if (evidence?.status === 'NOT_REGISTERED') {
    return {
      disposition: 'ANSWER',
      domain: 'NUTRITION',
      answer: `Não há essa troca cadastrada${evidence.source ? ` para ${evidence.source}` : ''}${meal ? ` em ${meal}` : ''} no seu plano. Não posso confirmar essa substituição como parte da sua dieta. Uma sugestão geral fora do plano seria aproximada, sem porção equivalente confirmada.`,
      followUpQuestion: null,
      grounding: 'CURRENT_PLAN',
      confidence: 'HIGH',
    };
  }
  return {
    disposition: 'CLARIFY',
    domain: 'NUTRITION',
    answer: null,
    followUpQuestion:
      !evidence?.source && !evidence?.requestedAlternative
        ? `Quais alimentos você quer substituir${meal ? ` em ${meal}` : ''}: qual é o original e qual é a alternativa?`
        : !evidence?.source
          ? 'Qual é o alimento original dessa troca?'
          : !evidence?.requestedAlternative
            ? 'Qual alimento você quer usar como alternativa?'
            : evidence?.unresolvedAlternative
              ? `Qual é a preparação ou o nome completo de ${evidence.requestedAlternative} nessa troca?`
              : !meal
                ? 'Em qual refeição você quer conferir essa troca?'
                : 'Não tenho registros suficientes para confirmar essa troca no plano. Você pode esclarecer a substituição que quer consultar?',
    grounding: 'RECENT_CONTEXT',
    confidence: 'LOW',
  };
}

export function nutritionAdvicePayload(
  context: NutritionAdviceContext | null,
): ConversationAIValue {
  if (!context) return null;
  return Object.freeze({
    intent: context.request.intent,
    substitutionPurpose: context.request.substitutionPurpose ?? null,
    meal: context.substitutionEvidence?.meal ?? context.request.meal,
    immediateConstraints: context.immediateConstraints,
    safetyConstraints: context.safetyConstraints,
    excludedFoods: context.excludedFoods,
    compatibleFoods: context.compatibleFoods ?? [],
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
    substitutionEvidence: context.substitutionEvidence
      ? {
          ...context.substitutionEvidence,
          registered: context.substitutionEvidence.registered.map((swap) => ({
            source: swap.source,
            alternative: swap.alternative,
          })),
        }
      : null,
    policy: {
      readOnly: true,
      foodEvidence:
        'compatibleFoods contém somente nomes encontrados no plano ou nas preferências e aprovados contra as restrições/rejeições deste turno. Use-os como base para uma combinação concreta nova quando forem suficientes. Isso não comprova estoque em casa, porção da alternativa, equivalência nutricional ou troca cadastrada. Não copie uma refeição inteira só porque seus ingredientes são compatíveis. A lista não é um catálogo fechado: conhecimento geral não clínico continua permitido se respeitar todos os controles. Se unresolvedSafety for true, esclareça a restrição antes de recomendar.',
      publicFoodBoundary:
        'A validação alimentar abrange todo o texto público, incluindo explicações, negações e followUpQuestion. Nunca mencione alimentos de excludedFoods ou incompatíveis com safetyConstraints, nem para dizer que foram evitados. Apresente diretamente a opção segura; não repita alimentos vetados do plano ou do histórico.',

      decisionIsAuthoritativeRealizationIsFlexible: true,
      personalizedEstimates:
        'Use metas, objetivo, estratégia, porções e estimativas dos itens disponíveis em originalMeals e as metas/estratégia de trustedContext.activeNutritionPlan. O plano contextualiza, não limita os ingredientes. Estimativas de conhecimento geral devem ser identificadas como aproximadas, nunca como meta, consumo observado ou equivalência comprovada. Sem fundamento para uma quantidade individual, dê uma orientação proporcional ou pergunte somente o dado essencial. Consumo registrado inclui apenas refeições analisadas e seu período, não o total real. Nas trocas oficiais, realize os fatos em linguagem natural e variada, sem alterar a decisão ou acrescentar doses. NOT_REGISTERED nunca é aprovação; UNRESOLVED pede só o dado ausente.',
      currentPlanRole:
        context.substitutionEvidence &&
        context.request.substitutionPurpose !== 'OFF_PLAN_ADVICE'
          ? 'SUBSTITUTION_EVIDENCE'
          : 'CONTEXT_NOT_ANSWER',
      preserveApproximateNutritionalFunction:
        context.request.intent === 'MEAL_SUBSTITUTION',
      instructions:
        (context.substitutionEvidence &&
        context.request.substitutionPurpose !== 'OFF_PLAN_ADVICE'
          ? 'Responda primeiro se o par perguntado está cadastrado no plano verdadeiro, mantendo a refeição e o alimento original. Não trate esta consulta como pedido de uma nova receita nem de alteração permanente. '
          : 'Entregue uma ideia concreta nova, plausível e compatível com o objetivo, perfil, horário local, rotina e preferências. O plano orienta a estratégia; não copie a composição da refeição de originalMeals. Ingredientes isolados podem ser reutilizados em uma combinação diferente. ') +
        'Combine todas as immediateConstraints: QUICK significa pouco preparo, HIGH_PROTEIN significa incluir fonte compatível de proteína, LOW_COST significa acessível, PORTABLE significa fácil de transportar; LACTOSE/GLUTEN são exclusões obrigatórias. Não invente alergias nem preferências. Em MEAL_SUBSTITUTION, entenda a refeição original e preserve aproximadamente sua função nutricional, sem prometer equivalência exata de calorias/macros; apresente como alternativa para essa refeição, sem afirmar alteração do plano. Nas consultas de troca, preserve os fatos do plano e do histórico; somente nas recomendações novas varie em relação às recentSuggestions quando houver alternativas compatíveis. Responda em um ou dois parágrafos curtos, com uma opção principal e no máximo uma alternativa útil, sem menu numerado ou preâmbulo genérico. Se faltar contexto essencial de segurança ou da refeição a substituir, faça apenas uma pergunta útil. Conhecimento geral não clínico é permitido. Somente em PLAN_INQUIRY, responda separadamente se a troca está cadastrada: use substitutionEvidence e os registros reais, nunca a presença da alternativa em outra refeição. Source é o alimento original e requestedAlternative é a alternativa perguntada, não os inverta. Preserve o almoço/horário e a resposta anterior, inclusive ausência de troca cadastrada, sem perguntar novamente por um alvo já informado. Em PLAN_INQUIRY com UNRESOLVED, esclareça apenas a informação essencial que falta. OFF_PLAN_ADVICE pede uma sugestão aproximada fora do plano, não uma checagem de cadastro; a falta de alternativa cadastrada não impede sugerir alimentos seguros, sem porção equivalente inventada. Se NOT_REGISTERED, não atribua a troca à dieta: qualquer sugestão deve ser explicitamente uma orientação aproximada fora do plano. Não invente porções da alternativa nem equivalência de calorias/macros. Uma porção do alimento original ou de outra refeição não comprova a porção da alternativa. Ser REGISTERED comprova somente o par descrito no registro; não comprova doses ausentes. Use a compreensão semântica do histórico e da mensagem, sem inferir fatos faltantes.',
    },
  });
}

export function nutritionAdviceFoodViolation(
  context: Pick<NutritionAdviceContext, 'safetyConstraints' | 'excludedFoods'>,
  value: string,
): string | null {
  const text = normalizeFoodTerm(value);
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
  return null;
}

/** Conservative public boundary: invalid advice never reaches delivery or a plan writer. */
export function nutritionAdviceViolation(
  context: NutritionAdviceContext | null,
  candidate: ConversationAnswerCandidate,
  decisionVerified = false,
): string | null {
  if (!context) return null;
  if (candidate.disposition === 'ANSWER' && context.unresolvedSafety)
    return 'NUTRITION_ADVICE_UNRESOLVED_SAFETY';
  if (candidate.disposition === 'ANSWER' && candidate.domain !== 'NUTRITION')
    return 'NUTRITION_ADVICE_WRONG_DOMAIN';
  const text = normalizeFoodTerm(
    [candidate.answer, candidate.followUpQuestion].filter(Boolean).join(' '),
  );
  const foodViolation = nutritionAdviceFoodViolation(context, text);
  if (foodViolation) return foodViolation;
  // Read-only and unsupported equivalence are public boundaries, including CLARIFY.
  if (
    /\b(?:atualizei|alterei|mudei|salvei|substitui)\b.*\b(?:plano|dieta)\b/u.test(
      text,
    )
  )
    return 'NUTRITION_ADVICE_FALSE_MUTATION';
  if (
    /(?<!nao )\b(?:e|sao|tem|possuem|fornecem|oferecem)\s+(?:exatamente\s+)?(?:a\s+|o\s+)?(?:mesma\s+(?:proteina|quantidade\s+de\s+(?:proteina|calorias))|mesmas\s+calorias|equivalentes?\s+exat[ao]s?)\b/u.test(
      text,
    )
  )
    return 'NUTRITION_SUBSTITUTION_UNSUPPORTED_EQUIVALENCE';
  const planInquiry =
    context.request.intent === 'MEAL_SUBSTITUTION' &&
    context.request.substitutionPurpose !== 'OFF_PLAN_ADVICE';
  if (
    context.request.intent === 'MEAL_SUBSTITUTION' &&
    !context.substitutionEvidence
  )
    return 'NUTRITION_SUBSTITUTION_MISSING_EVIDENCE';
  const asserted = text.replace(
    /\bnao (?:esta|e) (?:previst\w*|cadastrad\w*)\b/gu,
    '',
  );
  if (
    context.substitutionEvidence?.status !== 'REGISTERED' &&
    /\b(?:esta|e) (?:previst\w*|cadastrad\w*)\b|\b(?:seu plano|minha dieta|sua dieta) (?:permite|autoriza|registra|preve)\b/u.test(
      asserted,
    )
  )
    return 'NUTRITION_SUBSTITUTION_UNSUPPORTED_PLAN_CLAIM';
  if (planInquiry && context.substitutionEvidence) {
    const evidence = context.substitutionEvidence;
    // Verification can approve phrasing, never override a contradictory domain fact.
    // Evaluate affirmative authorization of the substitution in its own clause;
    // a preceding denial of registration does not authorize a later assertion.
    const unauthorizedConfirmation = text
      .split(/[.!?;]|\b(?:mas|porem|contudo)\b/u)
      .some(
        (clause) =>
          [
            ...clause.matchAll(
              /(?<!nao )\b(?:pode(?:m)?|podemos|da(?:\s+sim)?\s+(?:para|pra)|permite|autoriza)\b.*?\b(?:trocar|substituir|usar|comer)\b/gu,
            ),
          ].some((assertion) => !/\bnao\b/u.test(assertion[0])) &&
          !/\b(?:fora (?:do|de seu|da sua) plano|(?:orientacao|sugestao|ideia) (?:geral|aproximada))\b/u.test(
            clause,
          ),
      );
    if (evidence.status !== 'REGISTERED' && unauthorizedConfirmation)
      return 'NUTRITION_SUBSTITUTION_UNSUPPORTED_PLAN_CLAIM';
  }
  // Free advice uses the plan as context, not as a registry of permitted recipes.
  if (planInquiry && context.substitutionEvidence) {
    const evidence = context.substitutionEvidence;
    const deniesRegistration =
      /\b(?:nao (?:esta|e) (?:previst\w*|cadastrad\w*)|nao (?:ha|existe|consta))\b/u.test(
        text,
      );
    if (
      !decisionVerified &&
      evidence.status !== 'REGISTERED' &&
      candidate.disposition === 'ANSWER' &&
      candidate.grounding === 'CURRENT_PLAN' &&
      !(evidence.status === 'NOT_REGISTERED' && deniesRegistration)
    )
      return 'NUTRITION_SUBSTITUTION_UNSUPPORTED_PLAN_CLAIM';
    if (
      !decisionVerified &&
      candidate.disposition === 'ANSWER' &&
      evidence.status !== 'REGISTERED' &&
      !/\b(?:fora (?:do|de seu|da sua) plano|nao (?:esta|e) (?:previst\w*|cadastrad\w*)|nao (?:ha|existe|consta)|orientacao (?:geral|aproximada)|sugestao (?:geral|aproximada))\b/u.test(
        text,
      )
    )
      return 'NUTRITION_SUBSTITUTION_MISSING_GROUNDING';
    if (
      !decisionVerified &&
      evidence.status !== 'REGISTERED' &&
      /\b(?:pode|experimente|sugiro|recomendo)\b/u.test(text) &&
      !/\b(?:fora (?:do|de seu|da sua) plano|orientacao (?:geral|aproximada)|sugestao (?:geral|aproximada))\b/u.test(
        text,
      )
    )
      return 'NUTRITION_SUBSTITUTION_MISSING_GROUNDING';
    const portions = [
      ...(text.match(
        /\b(?:\d+(?:[.,]\d+)?|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s*(?:g|kg|gramas?|unidades?|ovos?|colheres?|fatias?|kcal|calorias?)\b/gu,
      ) ?? []),
      ...(text.match(/(?<![\d:])\b\d+(?:[.,]\d+)?\b(?![:\d])/gu) ?? []),
    ];
    if (
      portions.some(
        (portion) =>
          !evidence.registered.some((swap) =>
            matchesFoodTerm(swap.alternative, portion),
          ),
      )
    )
      return 'NUTRITION_SUBSTITUTION_UNSUPPORTED_PORTION';
    const factual = nutritionSubstitutionAnswer(context);
    if (
      factual &&
      (candidate.disposition !== factual.disposition ||
        candidate.domain !== factual.domain ||
        candidate.grounding !== factual.grounding ||
        !decisionVerified)
    )
      return 'NUTRITION_SUBSTITUTION_DOMAIN_DECISION_REQUIRED';
  }
  if (candidate.disposition !== 'ANSWER') return null;
  if (
    !context.substitutionEvidence &&
    context.previousAdvice &&
    candidate.answer &&
    materiallyRepeatsNutritionAdvice(context.previousAdvice, candidate.answer)
  )
    return 'NUTRITION_ADVICE_REPEATS_PREVIOUS_SUGGESTION';
  for (const meal of context.substitutionEvidence
    ? []
    : context.originalMeals) {
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
  return null;
}
