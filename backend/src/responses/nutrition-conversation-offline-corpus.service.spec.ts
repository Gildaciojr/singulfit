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

    expect(golden).toHaveLength(7);
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
