import { FitnessGoal } from '@prisma/client';
import type { NutritionPlanV2 } from '../nutrition-plan-v2.contract';
import { NutritionWhatsAppPresenter } from './nutrition-whatsapp.presenter';
import { PublicNutritionResponseBuilder } from './public-nutrition-response.builder';

describe('PublicNutritionResponseBuilder', () => {
  function plan(): NutritionPlanV2 {
    const item = (itemKey: string, foodName: string, quantity: string) =>
      Object.freeze({
        itemKey,
        foodName,
        quantity,
        role: 'PROTEIN' as const,
        caloriesKcal: 200,
        macros: Object.freeze({
          proteinGrams: 20,
          carbohydrateGrams: 10,
          fatGrams: 5,
        }),
        allergenTags: Object.freeze([]),
        dietaryTags: Object.freeze([]),
      });
    return Object.freeze({
      schemaVersion: 2,
      artifactType: 'DAILY_STRUCTURE',
      lifecycleReason: 'CREATION',
      replacesPlanReference: null,
      title: 'NUTRITION_V2 operationKey 8fe3f460-1c2d-4a5b-9c6d-0123456789ab',
      objectiveSummary: 'correlationId não deve aparecer',
      strategy: Object.freeze({
        schemaVersion: 2,
        artifactType: 'DAILY_STRUCTURE',
        objective: Object.freeze({
          status: 'CONFIRMED',
          value: FitnessGoal.WEIGHT_LOSS,
        }),
        dayCount: 1,
        mealCountPerDay: Object.freeze({ status: 'CONFIRMED', value: 1 }),
        mealSchedule: Object.freeze({ status: 'CONFIRMED', value: ['08:00'] }),
        energyTargetKcal: Object.freeze({ status: 'ESTIMATED', value: 2440 }),
        energySource: 'MIFFLIN_ST_JEOR_ESTIMATE',
        macroTargets: Object.freeze({
          status: 'ESTIMATED',
          value: Object.freeze({
            proteinGrams: 118,
            carbohydrateGrams: 339,
            fatGrams: 68,
          }),
        }),
        trainingAware: false,
        appliedConstraintCodes: Object.freeze([]),
        excludedFoods: Object.freeze([]),
        preferredFoods: Object.freeze(['Arroz']),
        variationPolicy: 'DAILY',
        detailLevel: 'STANDARD',
        factors: Object.freeze(['OBJECTIVE']),
      }),
      guidance: Object.freeze(['Faça as refeições com calma.']),
      days: Object.freeze([
        Object.freeze({
          dayNumber: 1,
          label: 'Dia 1',
          trainingDay: false,
          meals: Object.freeze([
            Object.freeze({
              mealKey: 'breakfast',
              name: 'Café da manhã',
              period: 'BREAKFAST',
              suggestedTime: '08:00',
              items: Object.freeze([
                item('eggs', 'Ovos mexidos', '3 unidades'),
              ]),
              alternatives: Object.freeze([
                item('chicken', 'Frango desfiado', '100 g'),
              ]),
            }),
          ]),
        }),
      ]),
      substitutions: Object.freeze([
        Object.freeze({
          substitutionKey: 'eggs-to-chicken',
          sourceItemKey: 'eggs',
          alternativeItemKey: 'chicken',
          rationaleCode: 'EQUIVALENT_ROLE',
        }),
      ]),
      adaptationRules: Object.freeze(['Ajuste o horário se necessário.']),
      hydrationGuidance: Object.freeze(['Mantenha água por perto.']),
      safetyNotes: Object.freeze([
        'Este plano não configura tratamento clínico.',
      ]),
      generation: Object.freeze({
        engineVersion: 2,
        promptVersionId: 'prompt-id',
        aiJobId: 'job-id',
        operationKey: 'operation-key',
        model: 'model-id',
        generatedAt: '2026-08-12T12:00:00.000Z',
        reused: false,
      }),
      validation: Object.freeze({ status: 'VALID', issues: Object.freeze([]) }),
    });
  }

  it('projects only authorized fields and resolves substitutions by food name', () => {
    const publicResponse = new PublicNutritionResponseBuilder().build({
      plan: plan(),
      userDisplayName: 'Ágata Souza',
    });
    const content = new NutritionWhatsAppPresenter().present(publicResponse);

    expect(publicResponse.userFirstName).toBe('Ágata');
    expect(publicResponse.substitutions).toEqual([
      { source: 'Ovos mexidos', alternative: 'Frango desfiado' },
    ]);
    expect(content).toContain('Ovos mexidos ↔ Frango desfiado');
    expect(content).toContain('condição de saúde');
    expect(content).not.toMatch(
      /ONBOARDING|NUTRITION_V2|NUTRITION_V2_ELIGIBLE|DIET_V2|LEGACY|operationKey|correlationId|executor|pilotStatus|artifact|artefato/iu,
    );
    expect(content).not.toMatch(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu,
    );
  });

  it('omits an invalid display name without inventing an identity', () => {
    expect(
      new PublicNutritionResponseBuilder().build({
        plan: plan(),
        userDisplayName: '12345',
      }).userFirstName,
    ).toBeUndefined();
  });

  it('replaces generic clinical boilerplate without losing allergy guidance', () => {
    const source = plan();
    const response = new PublicNutritionResponseBuilder().build({
      plan: {
        ...source,
        safetyNotes: Object.freeze([
          'Este plano não configura tratamento clínico.',
          'Evite alimentos aos quais você é alérgico.',
        ]),
      },
    });

    expect(response.safetyGuidance).toEqual([
      expect.stringContaining('condição de saúde'),
      'Evite alimentos aos quais você é alérgico.',
    ]);
  });

  it('replaces a lone generic clinical disclaimer with public guidance', () => {
    const response = new PublicNutritionResponseBuilder().build({
      plan: plan(),
    });

    expect(response.safetyGuidance).toEqual([
      expect.stringContaining('condição de saúde'),
    ]);
    expect(response.safetyGuidance).not.toContain(
      'Este plano não configura tratamento clínico.',
    );
  });

  it('preserves ordinary public safety guidance', () => {
    const source = plan();
    const response = new PublicNutritionResponseBuilder().build({
      plan: {
        ...source,
        safetyNotes: Object.freeze(['Respeite os sinais de saciedade.']),
      },
    });

    expect(response.safetyGuidance).toEqual([
      'Respeite os sinais de saciedade.',
    ]);
  });

  it('preserves a mixed clinical note instead of dropping specific guidance', () => {
    const source = plan();
    const mixedNote =
      'Este plano não configura tratamento clínico; se houver dor persistente, procure atendimento médico.';
    const response = new PublicNutritionResponseBuilder().build({
      plan: {
        ...source,
        safetyNotes: Object.freeze([mixedNote]),
      },
    });

    expect(response.safetyGuidance).toEqual([mixedNote]);
    expect(response.safetyGuidance.join(' ')).toContain('dor persistente');
  });

  it('keeps internal metadata and UUIDs out of projected safety notes', () => {
    const source = plan();
    const response = new PublicNutritionResponseBuilder().build({
      plan: {
        ...source,
        safetyNotes: Object.freeze([
          'operationKey 8fe3f460-1c2d-4a5b-9c6d-0123456789ab',
          'Procure orientação profissional se necessário.',
        ]),
      },
    });

    expect(response.safetyGuidance).toEqual([
      'Procure orientação profissional se necessário.',
    ]);
    expect(response.safetyGuidance.join(' ')).not.toMatch(
      /operationKey|8fe3f460-1c2d-4a5b-9c6d-0123456789ab/iu,
    );
  });

  it('humanizes the exact production canary safety boilerplate', () => {
    const source = plan();
    const response = new PublicNutritionResponseBuilder().build({
      plan: {
        ...source,
        safetyNotes: Object.freeze([
          'Plano estrutural sem caráter clínico.',
          'Não inclui prescrição de suplementos, medicamentos ou tratamento.',
          'Não foram inferidas alergias ou condições de saúde além dos dados fornecidos.',
        ]),
      },
    });
    const content = new NutritionWhatsAppPresenter().present(response);

    expect(content).toContain('condição de saúde');
    expect(content).toContain('suplementos ou medicamentos por conta própria');
    expect(content).toContain('alguma alergia');
    expect(content).not.toMatch(
      /estrutural|caráter clínico|não foram inferidas|prescrição de suplementos/iu,
    );
  });

  it('separates general guidance from adaptations and removes only normalized exact duplicates', () => {
    const source = plan();
    const response = new PublicNutritionResponseBuilder().build({
      plan: {
        ...source,
        guidance: Object.freeze([
          'Faça as refeições com calma.',
          '  FAÇA   AS REFEIÇÕES COM CALMA.  ',
          'Distribua as refeições ao longo do dia.',
        ]),
        adaptationRules: Object.freeze([
          'Faça as refeições com calma.',
          'Distribua as refeições conforme sua rotina.',
          'Ajuste os horários conforme sua rotina.',
          'Ajuste os horários conforme sua rotina.',
        ]),
      },
    });
    const content = new NutritionWhatsAppPresenter().present(response);

    expect(response.generalGuidance).toEqual([
      'Faça as refeições com calma.',
      'Distribua as refeições ao longo do dia.',
    ]);
    expect(response.adaptationGuidance).toEqual([
      'Distribua as refeições conforme sua rotina.',
      'Ajuste os horários conforme sua rotina.',
    ]);
    expect(content).toContain('💡 *Orientações para o dia a dia*');
    expect(content).toContain('📌 *Ajustes importantes*');
    expect(content.match(/Faça as refeições com calma\./gu)).toHaveLength(1);
    expect(content).toContain('Distribua as refeições ao longo do dia.');
    expect(content).toContain('Distribua as refeições conforme sua rotina.');
  });

  it('preserves specific safety alongside canary boilerplate projection', () => {
    const source = plan();
    const specific = 'Se houver dor persistente, procure atendimento médico.';
    const response = new PublicNutritionResponseBuilder().build({
      plan: {
        ...source,
        safetyNotes: Object.freeze([
          'Plano estrutural sem caráter clínico.',
          specific,
        ]),
      },
    });

    expect(response.safetyGuidance).toContain(specific);
    expect(response.safetyGuidance).toContainEqual(
      expect.stringContaining('condição de saúde'),
    );
  });

  it('drops the exact production sentinel line without losing valid nutrition or safety content', () => {
    const source = plan();
    const sentinelLine =
      'As calorias e macros individuais não foram estimadas item a item, portanto permanecem como null.';
    const specificSafety =
      'Se houver dor persistente, procure atendimento médico.';
    const response = new PublicNutritionResponseBuilder().build({
      plan: {
        ...source,
        safetyNotes: Object.freeze([sentinelLine, specificSafety]),
      },
    });
    const content = new NutritionWhatsAppPresenter().present(response);

    expect(response.safetyGuidance).toEqual([specificSafety]);
    expect(content).not.toContain(sentinelLine);
    expect(content).not.toMatch(/\bnull\b/u);
    expect(content).toContain(specificSafety);
    expect(content).toContain('≈ 2.440 kcal');
    expect(content).toContain('• Proteínas: 118 g');
    expect(content).toContain('• 3 unidades — Ovos mexidos');
  });

  it('enforces the complete technical sentinel invariant at the public boundary', () => {
    const source = plan();
    const response = new PublicNutritionResponseBuilder().build({
      plan: {
        ...source,
        guidance: Object.freeze([
          'Valor undefined.',
          'Cálculo NaN.',
          'Conteúdo [object Object].',
          'ONBOARDING não deve aparecer.',
          'Orientação pública preservada.',
        ]),
        adaptationRules: Object.freeze([
          'executor interno.',
          'pilotStatus interno.',
          'NUTRITION_V2 não deve aparecer.',
          'DIET_V2 não deve aparecer.',
        ]),
        hydrationGuidance: Object.freeze([
          'correlationId interno.',
          'Mantenha água por perto.',
        ]),
        safetyNotes: Object.freeze([
          'operationKey interna.',
          'artifact interno.',
          'artefato interno.',
          'Referência 8fe3f460-1c2d-4a5b-9c6d-0123456789ab.',
          'Se houver dor persistente, procure atendimento médico.',
        ]),
      },
    });
    const content = new NutritionWhatsAppPresenter().present(response);

    expect(content).not.toMatch(
      /\b(?:null|undefined)\b|\bNaN\b|\[object Object\]|\b(?:operationKey|correlationId|executor|pilotStatus|NUTRITION_V2|DIET_V2|artifact|artefato|ONBOARDING)\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu,
    );
    expect(content).toContain('Orientação pública preservada.');
    expect(content).toContain('Mantenha água por perto.');
    expect(content).toContain(
      'Se houver dor persistente, procure atendimento médico.',
    );
    expect(content).toContain('Ovos mexidos');
  });
});
