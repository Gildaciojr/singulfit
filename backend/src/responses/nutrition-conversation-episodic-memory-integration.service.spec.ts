import type { ConversationLayerOperationalConfigService } from './conversation-layer-operational-config.service';
import type {
  BuildNutritionConversationContextInput,
  NutritionConversationContextBuilder,
} from './nutrition-conversation-context.builder';
import type { NutritionConversationContext } from './nutrition-conversation-context.interface';
import type { NutritionConversationEpisodicMemoryCaptureEngine } from './nutrition-conversation-episodic-memory-capture.engine';
import { NutritionConversationEpisodicMemoryIntegrationService } from './nutrition-conversation-episodic-memory-integration.service';
import type { NutritionConversationEpisodicMemoryPersistenceService } from './nutrition-conversation-episodic-memory-persistence.service';

function input(): BuildNutritionConversationContextInput {
  return {
    analysis: { id: 'analysis-1' },
    context: {
      userId: 'user-1',
      preferences: { preferredMealTimes: ['12:30'] },
    },
    coach: { experience: { reengagement: null } },
  } as unknown as BuildNutritionConversationContextInput;
}

function context(): NutritionConversationContext {
  return {
    metadata: { mealAnalysisId: 'analysis-1' },
    facts: {
      mealCategory: 'LUNCH',
      foods: [],
      totalCalories: null,
      totalProtein: null,
      totalCarbs: null,
      totalFat: null,
      qualityScore: null,
    },
    policies: { requiresEstimateQualification: true },
    userContext: {
      goal: 'WEIGHT_LOSS',
      activityLevel: null,
      relevantRestrictions: [],
      relevantAllergies: [],
      preferredLanguage: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      recentMeals: [],
    },
    direction: {
      supportingEvidence: { positiveFactors: [], limitingFactors: [] },
    },
    recognition: { signals: [] },
    communication: {
      communicationStyle: 'BALANCED',
      coachingStyle: 'EDUCATOR',
      tone: 'MODERATE',
      motivationFocus: 'HEALTH',
      prefersShortMessages: false,
      preferredMessageLength: 400,
      idealEmojiCount: 0,
      fatigue: {
        score: 10,
        repeatedThemeScore: 0,
        repeatedPhraseScore: 0,
      },
      stageOfChange: 'ACTION',
      preferredTopics: [],
      ignoredTopics: [],
      shouldAskQuestion: false,
    },
  };
}

function subject(mode: 'OFF' | 'SHADOW' = 'SHADOW') {
  const operationalConfig = {
    get: jest.fn(() => ({
      configuredMode: mode,
      effectiveMode: mode,
      killSwitchEnabled: false,
    })),
  };
  const contextBuilder = { build: jest.fn(() => context()) };
  const captureEngine = { plan: jest.fn(() => Object.freeze([])) };
  const persistence = {
    selectForContext: jest.fn().mockResolvedValue(Object.freeze([])),
    loadCaptureState: jest.fn().mockResolvedValue(Object.freeze([])),
    applyCaptureCommands: jest.fn().mockResolvedValue(undefined),
  };
  return {
    service: new NutritionConversationEpisodicMemoryIntegrationService(
      operationalConfig as unknown as ConversationLayerOperationalConfigService,
      contextBuilder as unknown as NutritionConversationContextBuilder,
      captureEngine as unknown as NutritionConversationEpisodicMemoryCaptureEngine,
      persistence as unknown as NutritionConversationEpisodicMemoryPersistenceService,
    ),
    operationalConfig,
    contextBuilder,
    captureEngine,
    persistence,
  };
}

describe('NutritionConversationEpisodicMemoryIntegrationService', () => {
  it('performs no read or capture outside SHADOW', async () => {
    const test = subject('OFF');
    await expect(test.service.loadForContext(input())).resolves.toEqual([]);
    await test.service.capture(input(), new Date(1_000));

    expect(test.contextBuilder.build).not.toHaveBeenCalled();
    expect(test.persistence.selectForContext).not.toHaveBeenCalled();
    expect(test.persistence.loadCaptureState).not.toHaveBeenCalled();
  });

  it('loads at most the approved recalls and projects only immutable data', async () => {
    const test = subject();
    const recall = Object.freeze({
      continuityKey: 'goal',
      category: 'GOAL' as const,
      fact: Object.freeze({ goal: 'WEIGHT_LOSS' }),
      relationToContext: 'objetivo atual',
      recallReason: 'CURRENT_GOAL' as const,
      source: 'USER_CONTEXT' as const,
      sensitivity: 'STANDARD' as const,
    });
    test.persistence.selectForContext.mockResolvedValue(
      Object.freeze([recall]),
    );

    const result = await test.service.loadForContext(input(), new Date(1_000));

    expect(result).toEqual([recall]);
    expect(test.persistence.selectForContext).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ limit: 3, currentGoal: 'WEIGHT_LOSS' }),
      new Date(1_000),
    );
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('isolates read failures and returns an empty context projection', async () => {
    const test = subject();
    test.persistence.selectForContext.mockRejectedValue(new Error('db'));

    await expect(
      test.service.loadForContext(input(), new Date(1_000)),
    ).resolves.toEqual([]);
  });

  it('isolates asynchronous capture failures after the official commit', async () => {
    const test = subject();
    test.persistence.loadCaptureState.mockRejectedValue(new Error('db'));

    expect(() => test.service.captureAfterCommit(input())).not.toThrow();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(test.persistence.loadCaptureState).toHaveBeenCalledWith('user-1');
    expect(test.persistence.applyCaptureCommands).not.toHaveBeenCalled();
  });

  it('captures only after building structured context and persists planned commands', async () => {
    const test = subject();
    const commands = Object.freeze([
      Object.freeze({
        operation: 'NO_OP' as const,
        sourceKey: 'episodic:v1:key',
        continuityKey: 'profile:goal',
        reason: 'ALREADY_CAPTURED',
      }),
    ]);
    test.captureEngine.plan.mockReturnValue(commands);

    await test.service.capture(input(), new Date(1_000));

    expect(test.captureEngine.plan).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        sourceEvidenceKey: 'analysis-1',
        logicalNow: 1_000,
        existing: [],
      }),
    );
    expect(test.persistence.applyCaptureCommands).toHaveBeenCalledWith(
      'user-1',
      commands,
      new Date(1_000),
    );
  });
});
