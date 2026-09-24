import type { ConversationRoutingDecision } from '../contracts/conversation-execution-route.contract';
import type { ConversationRuntimeEvaluation } from '../contracts/conversation-runtime.contract';
import { ConversationRuntimeIntegrationService } from '../runtime/conversation-runtime-integration.service';
import { ConversationOfficialSelectionService } from '../runtime/conversation-official-selection.service';

describe('ConversationRuntimeIntegrationService', () => {
  const decisionRequest = {
    userId: 'user-id',
    conversationId: 'conversation-id',
    messageId: 'message-id',
    text: 'Olá',
    receivedAt: '2026-08-01T12:00:00.000Z',
    legacyIntent: 'UNKNOWN' as const,
  };
  const request = {
    ...decisionRequest,
    legacyContent: 'Resposta legada',
  };

  function createSubject(options: {
    mode: 'OFF' | 'SHADOW' | 'INTERNAL' | 'CANARY' | 'ROLLOUT' | 'PRIMARY';
    eligible?: boolean;
    timeoutMs?: number;
    evaluation?: Promise<ConversationRuntimeEvaluation>;
  }) {
    const configValue = {
      mode: options.mode,
      killSwitch: false,
      internalUserIds: ['user-id'],
      canaryPercentage: 100,
      timeoutMs: options.timeoutMs ?? 25_000,
      valid: true,
    } as const;
    const config = {
      get: jest.fn().mockReturnValue(configValue),
      isOfficiallyEligible: jest.fn().mockReturnValue(options.eligible ?? true),
    };
    const evaluation: ConversationRuntimeEvaluation = {
      summary: {
        status: 'OFFICIAL_CANDIDATE',
        mode: options.mode,
        operationKey: 'key',
        understandingStatus: 'UNDERSTOOD',
        recognizedIntent: 'COMMON_MESSAGE',
        goal: 'ANSWER_MESSAGE',
        routeKind: 'ANSWER_MESSAGE',
        confidence: 'HIGH',
        ambiguityPresent: false,
        safetyRequired: false,
        authorized: options.mode !== 'SHADOW',
        fallbackReason: null,
        durationMs: 2,
        versions: {
          runtime: 'conversation-runtime:v1',
          understanding: 'conversation-understanding:v1',
          routing: 'conversation-routing-decision:v1',
        },
      },
      decision: {} as ConversationRoutingDecision,
    };
    const runtime = {
      evaluate: jest
        .fn()
        .mockReturnValue(options.evaluation ?? Promise.resolve(evaluation)),
    };
    const bridge = {
      execute: jest.fn().mockResolvedValue({
        status: 'COMPLETED',
        content: 'Resposta runtime',
        routeKind: 'ANSWER_MESSAGE',
      }),
    };
    const comparator = {
      compare: jest.fn().mockReturnValue({
        equivalent: true,
        classification: 'MATCH',
        code: 'GENERAL_ROUTE_MATCH',
      }),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new ConversationRuntimeIntegrationService(
      config as never,
      runtime as never,
      bridge as never,
      new ConversationOfficialSelectionService(),
      comparator as never,
      audit as never,
    );
    return { service, config, runtime, bridge, comparator, audit };
  }

  it('keeps Runtime OFF out of official execution', async () => {
    const subject = createSubject({ mode: 'OFF' });

    await expect(subject.service.select(request)).resolves.toEqual({
      source: 'LEGACY',
      content: 'Resposta legada',
      reason: 'RUNTIME_DISABLED',
    });
    expect(subject.runtime.evaluate).not.toHaveBeenCalled();
    expect(subject.audit.record).not.toHaveBeenCalled();
  });

  it('runs SHADOW for audit without making it official', async () => {
    const subject = createSubject({ mode: 'SHADOW' });

    await expect(subject.service.select(request)).resolves.toEqual({
      source: 'LEGACY',
      content: 'Resposta legada',
      reason: 'SHADOW_ONLY',
    });
    expect(subject.runtime.evaluate).toHaveBeenCalledTimes(1);
    expect(subject.audit.record).toHaveBeenCalledTimes(1);
  });

  it('selects a valid runtime response for an eligible internal user', async () => {
    const subject = createSubject({ mode: 'INTERNAL' });
    const startedAt = Date.now();

    await expect(subject.service.select(request)).resolves.toEqual({
      source: 'CONVERSATION_RUNTIME',
      content: 'Resposta runtime',
      reason: 'RUNTIME_SELECTED',
    });
    expect(subject.bridge.execute).toHaveBeenCalledTimes(1);
    expect(subject.bridge.execute).toHaveBeenCalledWith(
      expect.objectContaining({}),
      undefined,
      expect.objectContaining({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
      }),
    );
    const executionContext = subject.bridge.execute.mock.calls[0][2] as {
      deadlineAtMs: number;
    };
    expect(executionContext.deadlineAtMs).toBeGreaterThanOrEqual(
      startedAt + 24_000,
    );
    expect(subject.audit.record).toHaveBeenCalledTimes(1);
  });

  it('returns the pre-execution runtime decision without requiring legacy content', async () => {
    const subject = createSubject({ mode: 'INTERNAL' });

    await expect(subject.service.decide(decisionRequest)).resolves.toEqual({
      source: 'CONVERSATION_RUNTIME',
      content: 'Resposta runtime',
      reason: 'RUNTIME_SELECTED',
    });
    expect(subject.runtime.evaluate).toHaveBeenCalledTimes(1);
    expect(subject.bridge.execute).toHaveBeenCalledTimes(1);
  });

  it('returns a legacy pre-execution decision when Runtime is OFF', async () => {
    const subject = createSubject({ mode: 'OFF' });

    await expect(subject.service.decide(decisionRequest)).resolves.toEqual({
      source: 'LEGACY',
      reason: 'RUNTIME_DISABLED',
    });
    expect(subject.runtime.evaluate).not.toHaveBeenCalled();
  });

  it('keeps an ineligible canary user on the legacy path', async () => {
    const subject = createSubject({ mode: 'CANARY', eligible: false });

    await expect(subject.service.select(request)).resolves.toMatchObject({
      source: 'LEGACY',
      reason: 'USER_NOT_ELIGIBLE',
    });
    expect(subject.runtime.evaluate).not.toHaveBeenCalled();
  });

  it('fails closed on runtime failure instead of returning a legacy decision', async () => {
    const subject = createSubject({
      mode: 'PRIMARY',
      evaluation: Promise.reject(new Error('runtime failed')),
    });

    await expect(
      subject.service.decide(decisionRequest),
    ).resolves.toMatchObject({
      source: 'SAFE_RESPONSE',
      reason: 'RUNTIME_FAILURE',
    });
  });

  it('fails closed on timeout without sending a second response', async () => {
    jest.useFakeTimers();
    const subject = createSubject({
      mode: 'PRIMARY',
      timeoutMs: 5,
      evaluation: new Promise<ConversationRuntimeEvaluation>(() => undefined),
    });
    const result = subject.service.decide(decisionRequest);
    await jest.advanceTimersByTimeAsync(5);

    await expect(result).resolves.toMatchObject({
      source: 'SAFE_RESPONSE',
      reason: 'RUNTIME_TIMEOUT',
    });
    jest.useRealTimers();
  });

  it.each([
    'NUTRITION_PLAN_GENERATION',
    'WORKOUT_PLAN_GENERATION',
    'COMBINED_PLAN_GENERATION',
    'NUTRITION_PLAN_UPDATE',
    'WORKOUT_PLAN_UPDATE',
  ])('returns a typed planning handoff for %s', async (routeKind) => {
    const subject = createSubject({ mode: 'PRIMARY' });
    subject.bridge.execute.mockResolvedValue({
      status: 'FALLBACK_REQUIRED',
      content: null,
      routeKind,
      reason: 'SIDE_EFFECT_ROUTE_REQUIRES_LEGACY_SINGLE_EXECUTION',
    });
    await expect(subject.service.decide(decisionRequest)).resolves.toEqual({
      source: 'PLANNING_HANDOFF',
      reason: 'SIDE_EFFECT_ROUTE_REQUIRES_SINGLE_EXECUTION',
    });
  });

  it('preserves the typed profile-acquisition decision in the handoff', async () => {
    const subject = createSubject({ mode: 'INTERNAL' });
    const decision = {
      plannerSummary: { currentLogicalTurn: 8 },
      executionRoute: {
        kind: 'PROFILE_ACQUISITION',
        targetPlan: 'WORKOUT',
        selectedProfileField: 'CURRENT_RUNNING_DISTANCE',
        goalDecision: {},
        reasonCodes: [],
        canExecute: true,
        missingPreconditions: [],
      },
    } as unknown as ConversationRoutingDecision;
    subject.runtime.evaluate.mockResolvedValue({
      summary: {} as ConversationRuntimeEvaluation['summary'],
      decision,
    } as ConversationRuntimeEvaluation);
    subject.bridge.execute.mockResolvedValue({
      status: 'FALLBACK_REQUIRED',
      content: null,
      routeKind: 'PROFILE_ACQUISITION',
      reason: 'PROFILE_ACQUISITION_NOT_CONNECTED',
    });

    await expect(subject.service.decide(decisionRequest)).resolves.toEqual({
      source: 'PLANNING_HANDOFF',
      reason: 'PROFILE_ACQUISITION_REQUIRES_SINGLE_EXECUTION',
      profileAcquisition: {
        executionRoute: expect.objectContaining({
          kind: 'PROFILE_ACQUISITION',
          targetPlan: 'WORKOUT',
          selectedProfileField: 'CURRENT_RUNNING_DISTANCE',
        }),
        logicalTurn: 8,
      },
    });
  });

  it('fails closed when a profile handoff has no selected field', async () => {
    const subject = createSubject({ mode: 'INTERNAL' });
    const decision = {
      plannerSummary: { currentLogicalTurn: 8 },
      executionRoute: { kind: 'PROFILE_ACQUISITION' },
    } as unknown as ConversationRoutingDecision;
    subject.runtime.evaluate.mockResolvedValue({
      summary: {} as ConversationRuntimeEvaluation['summary'],
      decision,
    } as ConversationRuntimeEvaluation);
    subject.bridge.execute.mockResolvedValue({
      status: 'FALLBACK_REQUIRED',
      content: null,
      routeKind: 'PROFILE_ACQUISITION',
      reason: 'PROFILE_ACQUISITION_NOT_CONNECTED',
    });

    await expect(subject.service.decide(decisionRequest)).resolves.toMatchObject({
      source: 'SAFE_RESPONSE',
      reason: 'BRIDGE_FAILURE',
    });
  });

  it('fails closed when a profile-acquisition route has no recognized handoff reason', async () => {
    const subject = createSubject({ mode: 'INTERNAL' });
    subject.bridge.execute.mockResolvedValue({
      status: 'FALLBACK_REQUIRED',
      content: null,
      routeKind: 'PROFILE_ACQUISITION',
      reason: 'RESPONSE_PIPELINE_FAILED',
    });

    await expect(subject.service.decide(decisionRequest)).resolves.toMatchObject({
      source: 'SAFE_RESPONSE',
      reason: 'BRIDGE_FAILURE',
    });
  });

  it.each([
    'NUTRITION_PLAN_GENERATION',
    'WORKOUT_PLAN_GENERATION',
    'COMBINED_PLAN_GENERATION',
    'NUTRITION_PLAN_UPDATE',
    'WORKOUT_PLAN_UPDATE',
  ])(
    'keeps %s shadow-only instead of handing planning off',
    async (routeKind) => {
      const subject = createSubject({ mode: 'SHADOW' });
      subject.bridge.execute.mockResolvedValue({
        status: 'FALLBACK_REQUIRED',
        content: null,
        routeKind,
        reason: 'SIDE_EFFECT_ROUTE_REQUIRES_LEGACY_SINGLE_EXECUTION',
      });
      await expect(subject.service.decide(decisionRequest)).resolves.toEqual({
        source: 'LEGACY',
        reason: 'SHADOW_ONLY',
      });
    },
  );
});
