import type {
  ConversationBridgeResult,
  ConversationRuntimeConfig,
  ConversationRuntimeEvaluation,
} from '../contracts/conversation-runtime.contract';
import { ConversationOfficialSelectionService } from '../runtime/conversation-official-selection.service';

describe('ConversationOfficialSelectionService', () => {
  const service = new ConversationOfficialSelectionService();
  const config: ConversationRuntimeConfig = {
    mode: 'INTERNAL',
    killSwitch: false,
    internalUserIds: ['user-id'],
    canaryPercentage: 0,
    timeoutMs: 25_000,
    valid: true,
  };
  const evaluation = {
    summary: {
      status: 'OFFICIAL_CANDIDATE',
      mode: 'INTERNAL',
      operationKey: 'key',
      understandingStatus: 'UNDERSTOOD',
      recognizedIntent: 'COMMON_MESSAGE',
      goal: 'ANSWER_MESSAGE',
      routeKind: 'ANSWER_MESSAGE',
      confidence: 'HIGH',
      ambiguityPresent: false,
      safetyRequired: false,
      authorized: true,
      fallbackReason: null,
      durationMs: 1,
      versions: {
        runtime: 'conversation-runtime:v1',
        understanding: 'conversation-understanding:v1',
        routing: 'conversation-routing-decision:v1',
      },
    },
    decision: null,
  } satisfies ConversationRuntimeEvaluation;
  const bridge = {
    status: 'COMPLETED',
    content: 'Resposta runtime',
    routeKind: 'ANSWER_MESSAGE',
  } satisfies ConversationBridgeResult;

  it('selects a valid runtime candidate', () => {
    expect(
      service.select({
        legacyContent: 'Legado',
        config,
        eligible: true,
        evaluation,
        bridge,
      }),
    ).toEqual({
      source: 'CONVERSATION_RUNTIME',
      content: 'Resposta runtime',
      reason: 'RUNTIME_SELECTED',
    });
  });

  it.each([
    [{ ...config, mode: 'OFF' as const }, true],
    [{ ...config, mode: 'SHADOW' as const }, true],
    [{ ...config, killSwitch: true }, true],
    [{ ...config, valid: false }, true],
    [config, false],
  ] as const)(
    'keeps legacy when runtime governance does not authorize release',
    (runtimeConfig, eligible) => {
      expect(
        service.select({
          legacyContent: 'Legado',
          config: runtimeConfig,
          eligible,
          evaluation,
          bridge,
        }),
      ).toMatchObject({ source: 'LEGACY' });
    },
  );

  it('keeps legacy when the Bridge requires fallback', () => {
    expect(
      service.select({
        legacyContent: 'Legado',
        config,
        eligible: true,
        evaluation,
        bridge: {
          status: 'FALLBACK_REQUIRED',
          content: null,
          routeKind: null,
          reason: 'unsupported',
        },
      }),
    ).toEqual({
      source: 'LEGACY',
      content: 'Legado',
      reason: 'RUNTIME_FALLBACK',
    });
  });

  it('never selects an empty completed candidate', () => {
    expect(
      service.select({
        legacyContent: 'Legado',
        config,
        eligible: true,
        evaluation,
        bridge: {
          status: 'COMPLETED',
          content: '   ',
          routeKind: 'ANSWER_MESSAGE',
        },
      }),
    ).toMatchObject({ source: 'LEGACY', reason: 'RUNTIME_FALLBACK' });
  });

  it('never selects a candidate with unresolved ambiguity', () => {
    expect(
      service.select({
        legacyContent: 'Legado',
        config,
        eligible: true,
        evaluation: {
          ...evaluation,
          summary: { ...evaluation.summary, ambiguityPresent: true },
        },
        bridge,
      }),
    ).toMatchObject({ source: 'LEGACY', reason: 'RUNTIME_FALLBACK' });
  });
});
