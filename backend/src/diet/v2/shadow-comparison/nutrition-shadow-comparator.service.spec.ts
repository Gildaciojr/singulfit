import {
  NutritionShadowComparisonDivergence as Divergence,
  NutritionShadowOutputKind,
} from '@prisma/client';
import { CONVERSATION_GOAL } from '../../../context/conversation-goal-planner.contract';
import type { CompareNutritionShadowInput } from './nutrition-shadow-comparison.contract';
import { NUTRITION_SHADOW_COMPARISON_WEIGHTS } from './nutrition-shadow-comparison.contract';
import type { NutritionShadowComparisonRepository } from './nutrition-shadow-comparison.repository';
import { NutritionShadowComparatorService } from './nutrition-shadow-comparator.service';

describe(NutritionShadowComparatorService.name, () => {
  const repository: jest.Mocked<NutritionShadowComparisonRepository> = {
    persist: jest.fn(),
  };
  const service = new NutritionShadowComparatorService(repository);

  const baseInput = (): CompareNutritionShadowInput => ({
    legacy: {
      conversationId: 'conversation-id',
      messageId: 'message-id',
      response: 'plano semanal objetivo proteina contexto',
      responseType: 'DIET_PLAN',
      durationMs: 100,
      provider: 'OPENAI',
      model: 'gpt-model',
      totalTokens: 100,
      estimatedCostUsd: '0.01000000',
      attempts: 1,
      parserSucceeded: true,
      validationSucceeded: true,
    },
    shadow: {
      shadowRunId: 'shadow-run-id',
      conversationGoal: 'GENERATE_DIET_PLAN',
      artifactType: 'WEEKLY_PLAN',
      kind: NutritionShadowOutputKind.PLAN,
      document: {
        kind: 'PLAN',
        artifactType: 'WEEKLY_PLAN',
        plan: { summary: 'plano semanal objetivo proteina contexto' },
      },
      documentHash: 'shadow-document-hash',
      durationMs: 90,
      provider: 'OPENAI',
      model: 'gpt-model',
      totalTokens: 90,
      estimatedCostUsd: '0.00900000',
      attempts: 1,
      parserSucceeded: true,
      validationSucceeded: true,
    },
    expectation: {
      artifactType: 'WEEKLY_PLAN',
      kind: NutritionShadowOutputKind.PLAN,
      conversationGoal: CONVERSATION_GOAL.GENERATE_DIET_PLAN,
      objectiveTerms: ['objetivo'],
      focusTerms: ['proteina'],
      contextTerms: ['contexto'],
      forbiddenRestrictionTerms: ['alergeno-proibido'],
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    repository.persist.mockResolvedValue({
      comparison: {
        id: 'comparison-id',
        inputFingerprint: 'persisted-fingerprint',
      },
      reused: false,
    });
  });

  it('returns maximum deterministic equivalence with equal dimension weights', async () => {
    const result = await service.compare(baseInput());

    expect(NUTRITION_SHADOW_COMPARISON_WEIGHTS).toEqual({
      structural: 1 / 3,
      semantic: 1 / 3,
      operational: 1 / 3,
    });
    expect(result).toMatchObject({
      comparisonId: 'comparison-id',
      equivalent: true,
      structuralScore: 100,
      semanticScore: 100,
      operationalScore: 100,
      overallScore: 100,
      divergences: [],
      reused: false,
      metrics: {
        timeRatio: '0.90000000',
        tokenRatio: '0.90000000',
        costRatio: '0.90000000',
        contentOverlap: 1,
      },
    });
    expect(repository.persist.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        equivalent: true,
        legacyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        shadowHash: 'shadow-document-hash',
      }),
    );
  });

  it.each([
    [
      'guidance',
      {
        artifactType: 'POINT_GUIDANCE',
        kind: NutritionShadowOutputKind.CONVERSATIONAL_ARTIFACT,
        goal: CONVERSATION_GOAL.GENERAL_GUIDANCE,
        document: {
          artifact: { guidance: { text: 'orientacao proteina contexto' } },
        },
        response: 'orientacao proteina contexto',
      },
    ],
    [
      'meal suggestion',
      {
        artifactType: 'MEAL_SUGGESTION',
        kind: NutritionShadowOutputKind.CONVERSATIONAL_ARTIFACT,
        goal: CONVERSATION_GOAL.ANSWER_MESSAGE,
        document: {
          artifact: { meal: { title: 'sugestao refeicao proteina' } },
        },
        response: 'sugestao refeicao proteina',
      },
    ],
    [
      'review',
      {
        artifactType: 'PLAN_REVIEW',
        kind: NutritionShadowOutputKind.CONVERSATIONAL_ARTIFACT,
        goal: CONVERSATION_GOAL.REVIEW_PROGRESS,
        document: {
          artifact: { review: { summary: 'revisao progresso nutricional' } },
        },
        response: 'revisao progresso nutricional',
      },
    ],
    [
      'presentation',
      {
        artifactType: 'CURRENT_PLAN_PRESENTATION',
        kind: NutritionShadowOutputKind.CURRENT_PLAN_PRESENTATION,
        goal: CONVERSATION_GOAL.SHOW_CURRENT_PLAN,
        document: {
          activePlanReference: 'active-plan-id',
          summary: 'apresentacao plano atual',
        },
        response: 'apresentacao plano atual',
      },
    ],
  ] as const)(
    'recognizes equivalent %s output without rebuilding it',
    async (_name, variant) => {
      const base = baseInput();
      const result = await service.compare({
        ...base,
        legacy: { ...base.legacy, response: variant.response },
        shadow: {
          ...base.shadow,
          artifactType: variant.artifactType,
          kind: variant.kind,
          document: variant.document,
        },
        expectation: {
          artifactType: variant.artifactType,
          kind: variant.kind,
          conversationGoal: variant.goal,
          objectiveTerms: [],
          focusTerms: [],
          contextTerms: [],
          forbiddenRestrictionTerms: [],
        },
      });

      expect(result.equivalent).toBe(true);
      expect(result.overallScore).toBe(100);
    },
  );

  it('reaches the minimum score when all applicable checks fail', async () => {
    const base = baseInput();
    const result = await service.compare({
      ...base,
      legacy: {
        ...base.legacy,
        response: 'conteudo legado ausente',
        durationMs: 1,
        totalTokens: 1,
        estimatedCostUsd: '0.00000001',
        provider: 'LEGACY',
        model: 'legacy-model',
        attempts: 0,
        parserSucceeded: false,
        validationSucceeded: false,
      },
      shadow: {
        ...base.shadow,
        artifactType: 'WEEKLY_PLAN',
        kind: NutritionShadowOutputKind.PLAN,
        document: {
          plan: { summary: 'alergeno proibido totalmente diferente' },
        },
        durationMs: 2,
        totalTokens: 2,
        estimatedCostUsd: '0.00000002',
        provider: 'SHADOW',
        model: 'shadow-model',
        attempts: 1,
        parserSucceeded: true,
        validationSucceeded: true,
      },
      expectation: {
        artifactType: 'POINT_GUIDANCE',
        kind: NutritionShadowOutputKind.CONVERSATIONAL_ARTIFACT,
        conversationGoal: CONVERSATION_GOAL.REVIEW_PROGRESS,
        objectiveTerms: ['objetivo-inexistente'],
        focusTerms: ['foco-inexistente'],
        contextTerms: ['contexto-inexistente'],
        forbiddenRestrictionTerms: ['alergeno proibido'],
      },
    });

    expect(result).toMatchObject({
      equivalent: false,
      structuralScore: 0,
      semanticScore: 0,
      operationalScore: 0,
      overallScore: 0,
    });
  });

  it('emits every closed divergence enum through deterministic scenarios', async () => {
    const seen = new Set<Divergence>();
    const collect = async (input: CompareNutritionShadowInput) => {
      const result = await service.compare(input);
      result.divergences.forEach((divergence) => seen.add(divergence));
    };
    const base = baseInput();

    await collect({
      ...base,
      shadow: {
        ...base.shadow,
        artifactType: 'POINT_GUIDANCE',
        kind: NutritionShadowOutputKind.CONVERSATIONAL_ARTIFACT,
        document: {},
      },
    });

    for (const variant of [
      {
        artifactType: 'POINT_GUIDANCE' as const,
        goal: CONVERSATION_GOAL.GENERAL_GUIDANCE,
      },
      {
        artifactType: 'MEAL_SUGGESTION' as const,
        goal: CONVERSATION_GOAL.ANSWER_MESSAGE,
      },
      {
        artifactType: 'PLAN_REVIEW' as const,
        goal: CONVERSATION_GOAL.REVIEW_PROGRESS,
      },
      {
        artifactType: 'CURRENT_PLAN_PRESENTATION' as const,
        goal: CONVERSATION_GOAL.SHOW_CURRENT_PLAN,
      },
    ]) {
      await collect({
        ...base,
        shadow: {
          ...base.shadow,
          artifactType: variant.artifactType,
          kind: NutritionShadowOutputKind.CONVERSATIONAL_ARTIFACT,
          document: { plan: { text: 'alergeno proibido divergente' } },
        },
        expectation: {
          artifactType: variant.artifactType,
          kind:
            variant.artifactType === 'CURRENT_PLAN_PRESENTATION'
              ? NutritionShadowOutputKind.CURRENT_PLAN_PRESENTATION
              : NutritionShadowOutputKind.CONVERSATIONAL_ARTIFACT,
          conversationGoal: variant.goal,
          objectiveTerms: ['objetivo-inexistente'],
          focusTerms: ['foco-inexistente'],
          contextTerms: ['contexto-inexistente'],
          forbiddenRestrictionTerms: ['alergeno proibido'],
        },
      });
    }

    await collect({
      ...base,
      legacy: {
        ...base.legacy,
        response: 'legado sem intersecao',
        durationMs: 1,
        totalTokens: 1,
        estimatedCostUsd: '0.00000001',
        provider: 'LEGACY',
        model: 'legacy-model',
        attempts: 0,
        parserSucceeded: false,
        validationSucceeded: false,
      },
      shadow: {
        ...base.shadow,
        document: {
          plan: { summary: 'alergeno proibido totalmente diferente' },
        },
        durationMs: 2,
        totalTokens: 2,
        estimatedCostUsd: '0.00000002',
        provider: 'SHADOW',
        model: 'shadow-model',
        attempts: 1,
        parserSucceeded: true,
        validationSucceeded: true,
      },
      expectation: {
        ...base.expectation,
        conversationGoal: CONVERSATION_GOAL.REVIEW_PROGRESS,
        objectiveTerms: ['objetivo-inexistente'],
        focusTerms: ['foco-inexistente'],
        contextTerms: ['contexto-inexistente'],
        forbiddenRestrictionTerms: ['alergeno proibido'],
      },
    });

    expect(seen).toEqual(new Set(Object.values(Divergence)));
  });

  it('reports repository reuse and isolates comparison failures', async () => {
    repository.persist.mockResolvedValueOnce({
      comparison: {
        id: 'existing-comparison',
        inputFingerprint: 'persisted-fingerprint',
      },
      reused: true,
    });
    await expect(service.compare(baseInput())).resolves.toMatchObject({
      comparisonId: 'existing-comparison',
      reused: true,
    });

    repository.persist.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(service.compareSafely(baseInput())).resolves.toBeNull();
  });
});
