import type { ConversationExecutionRoute } from '../contracts/conversation-execution-route.contract';
import { ConversationNutritionDeterministicAnswerService } from '../runtime/conversation-nutrition-deterministic-answer.service';
import type { PublicNutritionResponse } from '../../diet/v2/presentation/public-nutrition-response.contract';

describe('ConversationNutritionDeterministicAnswerService', () => {
  const plan: PublicNutritionResponse = Object.freeze({
    title: 'Plano atual',
    summary: 'Plano real',
    energyTargetKcal: 1900,
    macroTargets: Object.freeze({
      proteinGrams: 130,
      carbohydrateGrams: 190,
      fatGrams: 60,
    }),
    days: Object.freeze([
      Object.freeze({
        meals: Object.freeze([
          Object.freeze({
            name: 'Café da manhã',
            time: '08:00',
            items: Object.freeze([
              Object.freeze({ name: 'Ovos', quantity: '2 unidades' }),
            ]),
          }),
          Object.freeze({
            name: 'Almoço',
            time: '12:30',
            items: Object.freeze([
              Object.freeze({ name: 'Arroz branco', quantity: '4 colheres' }),
              Object.freeze({ name: 'Frango grelhado', quantity: '120 g' }),
            ]),
          }),
        ]),
      }),
    ]),
    substitutions: Object.freeze([
      Object.freeze({ source: 'Frango grelhado', alternative: 'Peixe' }),
    ]),
    hydrationGuidance: Object.freeze([]),
    generalGuidance: Object.freeze([]),
    adaptationGuidance: Object.freeze([]),
    safetyGuidance: Object.freeze([]),
  });
  const service = new ConversationNutritionDeterministicAnswerService();
  const route = {
    kind: 'NUTRITION_GUIDANCE',
    operation: 'PROVIDE_GUIDANCE',
  } as ConversationExecutionRoute;

  it.each([
    [
      'qual meu almoço?',
      '*Almoço* (12:30): 4 colheres de Arroz branco, 120 g de Frango grelhado.',
    ],
    [
      'quanto de arroz?',
      'No seu plano, a porção de *Arroz branco* é *4 colheres*.',
    ],
    [
      'qual minha meta de proteína?',
      'Sua meta diária no plano é 130 g de proteína.',
    ],
    [
      'não tenho frango, posso trocar?',
      'No seu plano, *Frango grelhado* pode ser trocado por *Peixe*. Siga a porção indicada na refeição.',
    ],
  ] as const)('answers %s only from the canonical plan', (request, content) => {
    expect(
      service.answer({
        request,
        route,
        current: { status: 'AVAILABLE', plan },
      }),
    ).toMatchObject({ content });
  });

  it('does not invent an absent item or plan', () => {
    expect(
      service.answer({
        request: 'quanto de atum?',
        route,
        current: { status: 'AVAILABLE', plan },
      }),
    ).toMatchObject({
      content: expect.stringContaining('Não encontrei esse alimento'),
    });
    expect(
      service.answer({
        request: 'qual é minha dieta atual?',
        route,
        current: { status: 'ABSENT', plan: null },
      }),
    ).toMatchObject({
      content: 'Você ainda não possui um plano alimentar ativo.',
    });
  });

  it('does not turn a persistent adaptation request into a read-only answer', () => {
    expect(
      service.answer({
        request: 'quero reduzir calorias e aumentar proteína',
        route,
        current: { status: 'AVAILABLE', plan },
      }),
    ).toBeNull();
  });
});
