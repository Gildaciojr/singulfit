import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConversationLayerOperationalConfigService } from './conversation-layer-operational-config.service';
import type { ConversationShadowDiagnosticsService } from './conversation-shadow-diagnostics.service';
import type { NutritionConversationAuthorizedFactsBuilder } from './nutrition-conversation-authorized-facts.builder';
import type {
  BuildNutritionConversationContextInput,
  NutritionConversationContextBuilder,
} from './nutrition-conversation-context.builder';
import type { NutritionConversationComposer } from './nutrition-conversation-composer';
import type { NutritionConversationDecisionEngine } from './nutrition-conversation-decision-engine';
import type { NutritionConversationDecisionScoringPolicy } from './nutrition-conversation-decision-scoring-policy';
import type { NutritionConversationLanguageRealizer } from './nutrition-conversation-language-realizer';
import type { NutritionConversationLegacyCandidateAdapter } from './nutrition-conversation-legacy-candidate.adapter';
import type { NutritionConversationComparator } from './nutrition-conversation-comparator';
import { NutritionConversationShadowPipelineService } from './nutrition-conversation-shadow-pipeline.service';
import type { SanitizedConversationPayloadBuilder } from './sanitized-conversation-payload.builder';

function subject(mode: 'OFF' | 'SHADOW' = 'SHADOW') {
  const context = Object.freeze({ context: true });
  const candidates = Object.freeze([{ candidate: true }]);
  const decisionPlan = Object.freeze({ plan: true });
  const compositionPlan = Object.freeze({ composition: true });
  const authorizedFacts = Object.freeze({ facts: true });
  const sanitizedPayload = Object.freeze({ payload: true });
  const languageResult = Object.freeze({
    status: 'COMPLETED',
    candidateText: 'candidate',
  });
  const operationalConfig = {
    get: jest.fn().mockReturnValue({ effectiveMode: mode }),
  };
  const contextBuilder = { build: jest.fn().mockReturnValue(context) };
  const decisionEngine = { generate: jest.fn().mockReturnValue(candidates) };
  const scoringPolicy = { select: jest.fn().mockReturnValue(decisionPlan) };
  const composer = { compose: jest.fn().mockReturnValue(compositionPlan) };
  const authorizedFactsBuilder = {
    build: jest.fn().mockReturnValue(authorizedFacts),
  };
  const sanitizedPayloadBuilder = {
    build: jest.fn().mockReturnValue(sanitizedPayload),
  };
  const languageRealizer = {
    realize: jest.fn().mockResolvedValue(languageResult),
  };
  const adapter = {
    adapt: jest.fn().mockReturnValue({ candidate: { eligible: true } }),
  };
  const comparator = {
    compare: jest.fn().mockReturnValue({
      candidateEligible: true,
      metrics: {
        incrementalLatencyMs: 1,
        legacyCharacters: 6,
        candidateCharacters: 9,
        candidateQuestions: 0,
        candidateEmojis: 0,
      },
    }),
  };
  const diagnostics = { record: jest.fn() };
  const service = new NutritionConversationShadowPipelineService(
    operationalConfig as unknown as ConversationLayerOperationalConfigService,
    contextBuilder as unknown as NutritionConversationContextBuilder,
    decisionEngine as unknown as NutritionConversationDecisionEngine,
    scoringPolicy as unknown as NutritionConversationDecisionScoringPolicy,
    composer as unknown as NutritionConversationComposer,
    authorizedFactsBuilder as unknown as NutritionConversationAuthorizedFactsBuilder,
    sanitizedPayloadBuilder as unknown as SanitizedConversationPayloadBuilder,
    languageRealizer as unknown as NutritionConversationLanguageRealizer,
    adapter as unknown as NutritionConversationLegacyCandidateAdapter,
    comparator as unknown as NutritionConversationComparator,
    diagnostics as unknown as ConversationShadowDiagnosticsService,
  );

  return {
    service,
    operationalConfig,
    contextBuilder,
    decisionEngine,
    scoringPolicy,
    composer,
    authorizedFactsBuilder,
    sanitizedPayloadBuilder,
    languageRealizer,
    adapter,
    comparator,
    diagnostics,
    context,
    candidates,
    decisionPlan,
    compositionPlan,
    authorizedFacts,
    sanitizedPayload,
  };
}

const conversation = Object.freeze({
  analysis: { id: 'analysis' },
}) as unknown as BuildNutritionConversationContextInput;
const input = Object.freeze({ conversation, legacyText: 'legacy' });

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('NutritionConversationShadowPipelineService', () => {
  it('executes the complete pipeline in the approved order only in SHADOW', async () => {
    const target = subject();
    expect(target.service.execute(input)).toBeUndefined();
    await flush();

    expect(target.contextBuilder.build).toHaveBeenCalledWith(conversation);
    expect(target.decisionEngine.generate).toHaveBeenCalledWith(target.context);
    expect(target.scoringPolicy.select).toHaveBeenCalledWith(
      target.context,
      target.candidates,
    );
    expect(target.composer.compose).toHaveBeenCalledWith(
      target.context,
      target.decisionPlan,
    );
    expect(target.authorizedFactsBuilder.build).toHaveBeenCalledWith(
      target.context,
    );
    expect(target.sanitizedPayloadBuilder.build).toHaveBeenCalledWith({
      context: target.context,
      authorizedFacts: target.authorizedFacts,
      decisionPlan: target.decisionPlan,
      compositionPlan: target.compositionPlan,
    });
    expect(target.languageRealizer.realize).toHaveBeenCalledWith(
      target.sanitizedPayload,
    );
    expect(target.adapter.adapt).toHaveBeenCalledWith(
      'legacy',
      expect.objectContaining({ status: 'COMPLETED' }),
    );
    expect(target.comparator.compare).toHaveBeenCalledWith(
      expect.objectContaining({ payload: target.sanitizedPayload }),
    );
    const calls = [
      target.contextBuilder.build,
      target.decisionEngine.generate,
      target.scoringPolicy.select,
      target.composer.compose,
      target.authorizedFactsBuilder.build,
      target.sanitizedPayloadBuilder.build,
      target.languageRealizer.realize,
    ].map((mock) => mock.mock.invocationCallOrder[0]);
    expect(calls).toEqual([...calls].sort((left, right) => left - right));
  });

  it.each(['OFF', 'INTERNAL', 'CANARY', 'ROLLOUT', 'PRIMARY'] as const)(
    'does nothing in %s mode',
    async (mode) => {
      const target = subject('OFF');
      target.operationalConfig.get.mockReturnValue({ effectiveMode: mode });
      target.service.execute(input);

      expect(target.contextBuilder.build).not.toHaveBeenCalled();
      expect(target.languageRealizer.realize).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['Context', 'contextBuilder', 'build'],
    ['Engine', 'decisionEngine', 'generate'],
    ['Policy', 'scoringPolicy', 'select'],
    ['Composer', 'composer', 'compose'],
    ['AuthorizedFacts', 'authorizedFactsBuilder', 'build'],
    ['Payload', 'sanitizedPayloadBuilder', 'build'],
  ] as const)(
    'isolates a synchronous %s failure',
    async (_label, dependency, method) => {
      const target = subject();
      target[dependency][method].mockImplementation(() => {
        throw new Error('shadow failure');
      });

      expect(target.service.execute(input)).toBeUndefined();
      await flush();
    },
  );

  it('isolates an asynchronous Realizer failure', async () => {
    const target = subject();
    target.languageRealizer.realize.mockRejectedValue(
      new Error('realizer failure'),
    );

    expect(target.service.execute(input)).toBeUndefined();
    await flush();
  });

  it('discards the LanguageRealizationResult deterministically', async () => {
    const first = subject();
    const second = subject();

    first.service.execute(input);
    second.service.execute(input);
    await flush();
    expect(first.languageRealizer.realize.mock.calls).toEqual(
      second.languageRealizer.realize.mock.calls,
    );
  });

  it('skips deterministically when the process concurrency limit is reached', async () => {
    const target = subject();
    target.languageRealizer.realize.mockReturnValue(
      new Promise(() => undefined),
    );

    target.service.execute(input);
    target.service.execute(input);
    target.service.execute(input);
    await flush();

    expect(target.languageRealizer.realize).toHaveBeenCalledTimes(2);
    expect(target.diagnostics.record).toHaveBeenCalledWith({
      event: 'SKIPPED_CONCURRENCY',
    });
  });

  it('absorbs comparator and diagnostics failures', async () => {
    const target = subject();
    target.comparator.compare.mockImplementation(() => {
      throw new Error('comparison failure');
    });
    target.diagnostics.record.mockImplementation(() => {
      throw new Error('diagnostic failure');
    });

    expect(target.service.execute(input)).toBeUndefined();
    await flush();
  });

  it('does not start new work after application shutdown', () => {
    const target = subject();
    target.service.onApplicationShutdown();
    target.service.execute(input);

    expect(target.contextBuilder.build).not.toHaveBeenCalled();
  });

  it('applies a total timeout without releasing the active slot early', async () => {
    jest.useFakeTimers();
    const target = subject();
    target.languageRealizer.realize.mockReturnValue(
      new Promise(() => undefined),
    );

    target.service.execute(input);
    await flush();
    await jest.advanceTimersByTimeAsync(25_000);

    expect(target.diagnostics.record).toHaveBeenCalledWith({
      event: 'TIMEOUT',
      component: 'SHADOW_PIPELINE',
      latencyMs: 25_000,
    });
    target.service.execute(input);
    target.service.execute(input);
    expect(target.diagnostics.record).toHaveBeenCalledWith({
      event: 'SKIPPED_CONCURRENCY',
    });
    jest.useRealTimers();
  });

  it('contains no persistence, outbound, event or production response dependency', () => {
    const source = readFileSync(
      join(__dirname, 'nutrition-conversation-shadow-pipeline.service.ts'),
      'utf8',
    );

    expect(source).not.toMatch(
      /Prisma|outbound|EventBus|Outbox|Evolution|MediaService|Worker|NutritionResponseFormatter|AIJob|PromptVersion|persist|publish/,
    );
    expect(source).not.toMatch(/TODO|FIXME|console\.log/);
  });
});
