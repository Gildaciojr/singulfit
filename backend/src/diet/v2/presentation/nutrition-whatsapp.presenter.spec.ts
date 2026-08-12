import { NutritionWhatsAppPresenter } from './nutrition-whatsapp.presenter';
import type { PublicNutritionResponse } from './public-nutrition-response.contract';

describe('NutritionWhatsAppPresenter', () => {
  const presenter = new NutritionWhatsAppPresenter();

  function response(
    overrides: Partial<PublicNutritionResponse> = {},
  ): PublicNutritionResponse {
    return Object.freeze({
      userFirstName: 'Ana',
      title: 'Seu plano alimentar',
      summary:
        'Organizei as refeições para apoiar seu objetivo de emagrecimento.',
      goal: 'emagrecimento',
      energyTargetKcal: 2440,
      macroTargets: Object.freeze({
        proteinGrams: 118,
        carbohydrateGrams: 339,
        fatGrams: 68,
      }),
      days: Object.freeze([
        Object.freeze({
          meals: Object.freeze([
            Object.freeze({
              name: 'Café da manhã',
              time: '08:00',
              items: Object.freeze([
                Object.freeze({
                  name: 'Pães franceses',
                  quantity: '2 unidades',
                }),
                Object.freeze({ name: 'Ovos mexidos', quantity: '3 unidades' }),
              ]),
            }),
            Object.freeze({
              name: 'Almoço',
              time: '12:00',
              items: Object.freeze([
                Object.freeze({ name: 'Arroz integral', quantity: '180 g' }),
              ]),
            }),
            Object.freeze({
              name: 'Lanche da tarde',
              time: '16:00',
              items: Object.freeze([
                Object.freeze({ name: 'Banana-prata', quantity: '1 unidade' }),
              ]),
            }),
            Object.freeze({
              name: 'Jantar',
              time: '20:00',
              items: Object.freeze([
                Object.freeze({ name: 'Frango grelhado', quantity: '150 g' }),
              ]),
            }),
          ]),
        }),
      ]),
      substitutions: Object.freeze([
        Object.freeze({
          source: 'Frango grelhado',
          alternative: 'Patinho moído',
        }),
      ]),
      hydrationGuidance: Object.freeze(['Beba água ao longo do dia.']),
      generalGuidance: Object.freeze(['Faça as refeições com calma.']),
      adaptationGuidance: Object.freeze(['Ajuste os horários à sua rotina.']),
      safetyGuidance: Object.freeze([
        'Respeite suas restrições e orientações profissionais.',
      ]),
      ...overrides,
    });
  }

  it('renders a personalized WhatsApp response with all public blocks', () => {
    const content = presenter.present(response());

    expect(content).toContain('Ana, preparei seu plano');
    expect(content).toContain('≈ 2.440 kcal');
    expect(content).toContain('• Proteínas: 118 g');
    expect(content).toContain('*08:00 — Café da manhã*');
    expect(content).toContain('• 2 unidades — Pães franceses');
    expect(content).toContain('*12:00 — Almoço*');
    expect(content).toContain('*16:00 — Lanche da tarde*');
    expect(content).toContain('*20:00 — Jantar*');
    expect(content).toContain('Frango grelhado ↔ Patinho moído');
    expect(content).toContain('💧 *Hidratação*');
    expect(content).toContain('🛡️ *Cuidados importantes*');
  });

  it('stays natural without a name and omits absent optional values', () => {
    const content = presenter.present(
      response({
        userFirstName: undefined,
        energyTargetKcal: undefined,
        macroTargets: Object.freeze({ proteinGrams: 118 }),
        substitutions: Object.freeze([]),
        hydrationGuidance: Object.freeze([]),
      }),
    );

    expect(content).toContain('Preparei seu plano');
    expect(content).not.toContain('Ana,');
    expect(content).toContain('• Proteínas: 118 g');
    expect(content).not.toContain('Carboidratos');
    expect(content).not.toContain('Trocas possíveis');
    expect(content).not.toContain('Hidratação');
    expect(content).not.toMatch(/null|undefined|NaN|\[object Object\]/u);
  });

  it('renders minimum valid content deterministically without provider effects', () => {
    const minimal = response({
      userFirstName: undefined,
      goal: undefined,
      energyTargetKcal: undefined,
      macroTargets: undefined,
      substitutions: Object.freeze([]),
      hydrationGuidance: Object.freeze([]),
      generalGuidance: Object.freeze([]),
      adaptationGuidance: Object.freeze([]),
      safetyGuidance: Object.freeze([]),
    });

    const first = presenter.present(minimal);
    const second = presenter.present(minimal);

    expect(first).toBe(second);
    expect(first).toContain('*08:00 — Café da manhã*');
    expect(first).toContain('Pães franceses');
  });
});
