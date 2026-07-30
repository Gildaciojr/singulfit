import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConversationCandidateFactory } from './conversation-offline-corpus.contract';
import { NUTRITION_CONVERSATION_OFFLINE_CORPUS } from './nutrition-conversation-offline-corpus.fixtures';
import { NutritionConversationOfflineCorpusService } from './nutrition-conversation-offline-corpus.service';

describe('NutritionConversationOfflineCorpusService', () => {
  const service = new NutritionConversationOfflineCorpusService();

  it('runs the synthetic corpus deterministically and aggregates objective results', async () => {
    const before = JSON.stringify(NUTRITION_CONVERSATION_OFFLINE_CORPUS);
    const first = await service.run(NUTRITION_CONVERSATION_OFFLINE_CORPUS);
    const second = await service.run(NUTRITION_CONVERSATION_OFFLINE_CORPUS);

    expect(first).toEqual(second);
    expect(first.mode).toBe('DETERMINISTIC');
    expect(first.totalScenarios).toBe(
      NUTRITION_CONVERSATION_OFFLINE_CORPUS.length,
    );
    expect(first.eligible).toBeGreaterThan(0);
    expect(first.legacyPreferred).toBeGreaterThan(0);
    expect(first.invalidCandidates).toBeGreaterThan(0);
    expect(first.fallbackRequired).toBeGreaterThan(0);
    expect(first.experimentalAverageLatencyMs).toBeNull();
    expect(first.experimentalAverageTotalTokens).toBeNull();
    expect(JSON.stringify(NUTRITION_CONVERSATION_OFFLINE_CORPUS)).toBe(before);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.averageScores)).toBe(true);
    expect(Object.isFrozen(first.scenarios)).toBe(true);
  });

  it('classifies every required outcome deterministically', async () => {
    const report = await service.run(NUTRITION_CONVERSATION_OFFLINE_CORPUS);
    const classification = new Map(
      report.scenarios.map((result) => [
        result.scenarioId,
        result.classification,
      ]),
    );

    expect(classification.get('adequate-meal')).toBe('ELIGIBLE');
    expect(classification.get('fallback-required')).toBe('FALLBACK_REQUIRED');
    expect(classification.get('invalid-factual')).toBe('INVALID_CANDIDATE');
    expect(classification.get('legacy-preferred-structure')).toBe(
      'LEGACY_PREFERRED',
    );
    expect(
      (
        await service.run([
          {
            ...NUTRITION_CONVERSATION_OFFLINE_CORPUS[0],
            id: 'partial',
            candidate: {
              ...NUTRITION_CONVERSATION_OFFLINE_CORPUS[0].candidate!,
              status: 'PARTIALLY_COMPLETED' as const,
            },
          },
        ])
      ).scenarios[0].classification,
    ).toBe('ELIGIBLE_WITH_WARNING');
  });

  it('keeps golden cases eligible and rejects their factual regression', async () => {
    const golden = NUTRITION_CONVERSATION_OFFLINE_CORPUS.filter(
      (scenario) => scenario.golden,
    );
    const report = await service.run(golden);

    expect(golden).toHaveLength(32);
    expect(
      report.scenarios.every((result) => result.classification === 'ELIGIBLE'),
    ).toBe(true);
    const regression = {
      ...golden[0],
      candidate: { ...golden[0].candidate!, realizedFacts: [] },
    };
    expect((await service.run([regression])).scenarios[0].classification).toBe(
      'INVALID_CANDIDATE',
    );
  });

  it('contains the complete Coach Identity calibration corpus', () => {
    const identity = NUTRITION_CONVERSATION_OFFLINE_CORPUS.filter((scenario) =>
      scenario.tags.includes('COACH_IDENTITY'),
    );
    const goldenIdentity = identity.filter((scenario) => scenario.golden);
    const tags = new Set(identity.flatMap((scenario) => scenario.tags));

    expect(identity).toHaveLength(50);
    expect(goldenIdentity).toHaveLength(20);
    expect(
      [
        'VICTORY',
        'SETBACK',
        'PLATEAU',
        'IRRITATED_USER',
        'INSECURE_USER',
        'CURIOUS_USER',
        'OBJECTIVE_USER',
        'OLD_USER',
        'NEW_USER',
        'CONTINUITY',
        'RETURN',
        'BAD_DAY',
        'EXCELLENT_DAY',
        'FATIGUE',
        'LOW_ADHERENCE',
        'HIGH_ADHERENCE',
        'REPEATED_QUESTION',
        'DETAIL_REQUEST',
        'COMPARISON',
      ].every((tag) => tags.has(tag)),
    ).toBe(true);
    expect(
      identity.every(
        (scenario) =>
          scenario.payload.style.coach.identity === 'SINGULFIT_COACH_V1' &&
          scenario.payload.style.coach.role === 'SPORTS_NUTRITION_COACH',
      ),
    ).toBe(true);
  });

  it('covers every required dialogue scenario and profile golden case', () => {
    const dialogue = NUTRITION_CONVERSATION_OFFLINE_CORPUS.filter((scenario) =>
      scenario.tags.includes('DIALOGUE_SCENARIO'),
    );
    const goldenProfiles = new Set(
      NUTRITION_CONVERSATION_OFFLINE_CORPUS.filter(
        (scenario) =>
          scenario.golden &&
          scenario.tags.some((tag) => tag.startsWith('GOLDEN_')),
      ).map((scenario) => scenario.expectedDialogueProfile),
    );

    expect(dialogue).toHaveLength(40);
    expect(
      dialogue.every(
        (scenario) =>
          scenario.payload.structure.dialogueProfile ===
            scenario.expectedDialogueProfile &&
          scenario.payload.structure.centralIntent ===
            scenario.expectedCentralIntent,
      ),
    ).toBe(true);
    expect(
      new Set(dialogue.map((scenario) => scenario.expectedDialogueProfile)),
    ).toEqual(
      new Set([
        'ACKNOWLEDGE_ONLY',
        'ACKNOWLEDGE_AND_ADJUST',
        'REFLECT_AND_ASK',
        'TEACH_BRIEFLY',
        'RECOVERY',
        'CELEBRATE',
        'DETAILED_ANALYSIS',
        'CLARIFY_BEFORE_ANALYSIS',
        'REASSURE_AND_SIMPLIFY',
        'CONTINUITY_CHECK',
      ]),
    );
    expect(goldenProfiles).toEqual(
      new Set([
        'ACKNOWLEDGE_ONLY',
        'RECOVERY',
        'CELEBRATE',
        'CLARIFY_BEFORE_ANALYSIS',
        'DETAILED_ANALYSIS',
      ]),
    );
  });

  it('contains every approved episodic memory scenario without operational metadata', () => {
    const episodic = NUTRITION_CONVERSATION_OFFLINE_CORPUS.filter((scenario) =>
      scenario.tags.includes('EPISODIC_MEMORY'),
    );
    const tags = new Set(episodic.flatMap((scenario) => scenario.tags));

    expect(episodic).toHaveLength(14);
    expect(
      [
        'OLD_USER',
        'OLD_GOAL',
        'CHANGED_GOAL',
        'FOOD_PREFERENCE',
        'ALLERGY',
        'RESTRICTION',
        'TRAVEL',
        'RETURN_FROM_VACATION',
        'COMMITMENT_COMPLETED',
        'COMMITMENT_ABANDONED',
        'SETBACK',
        'RESUMPTION',
        'REPEATED_STRATEGY',
        'PLATEAU',
      ].every((tag) => tags.has(tag)),
    ).toBe(true);
    expect(
      episodic.every(
        (scenario) =>
          JSON.stringify(scenario.payload).match(
            /continuityKey|createdAtLogical|expiresAtLogical|lifecycle|importance/,
          ) === null,
      ),
    ).toBe(true);
    expect(
      NUTRITION_CONVERSATION_OFFLINE_CORPUS.some((scenario) =>
        scenario.tags.includes('NEW_USER'),
      ),
    ).toBe(true);
  });

  it('requires explicit enablement and factory for experimental mode', async () => {
    await expect(
      service.run(NUTRITION_CONVERSATION_OFFLINE_CORPUS, {
        mode: 'EXPERIMENTAL',
      }),
    ).rejects.toThrow('EXPERIMENTAL_CORPUS_REQUIRES_EXPLICIT_FACTORY');

    const factory: ConversationCandidateFactory = {
      realize: jest
        .fn()
        .mockResolvedValue(NUTRITION_CONVERSATION_OFFLINE_CORPUS[0].candidate),
    };
    const report = await service.run(
      [
        {
          ...NUTRITION_CONVERSATION_OFFLINE_CORPUS[0],
          usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
        },
      ],
      {
        mode: 'EXPERIMENTAL',
        experimentalEnabled: true,
        candidateFactory: factory,
      },
    );

    expect(factory.realize).toHaveBeenCalledTimes(1);
    expect(report.mode).toBe('EXPERIMENTAL');
    expect(report.experimentalAverageLatencyMs).toBe(10);
    expect(report.experimentalAverageTotalTokens).toBe(14);
  });

  it('contains no production, persistence or personal-data fixture dependency', () => {
    const source = [
      'nutrition-conversation-offline-corpus.service.ts',
      'nutrition-conversation-offline-corpus.fixtures.ts',
    ]
      .map((file) => readFileSync(join(__dirname, file), 'utf8'))
      .join('\n');

    expect(source).not.toMatch(
      /Prisma|Evolution|Outbox|EventBus|persist|publish|console\.log|TODO|FIXME|\bany\b|Date\.now|Math\.random/,
    );
    expect(source).not.toMatch(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b|\+?\d{8,}/);
  });
});
