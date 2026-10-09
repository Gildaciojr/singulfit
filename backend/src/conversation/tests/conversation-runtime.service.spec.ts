import { Test, type TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ConversationRuntimeAuditService } from '../runtime/conversation-runtime-audit.service';
import { ConversationModule } from '../conversation.module';
import { ConversationExecutionBridgeService } from '../runtime/conversation-execution-bridge.service';
import { ConversationLanguageRealizerService } from '../runtime/conversation-language-realizer.service';
import { ConversationResponseFormatterService } from '../runtime/conversation-response-formatter.service';
import { ConversationResponsePayloadBuilder } from '../runtime/conversation-response-payload.builder';
import { ConversationResponseValidatorService } from '../runtime/conversation-response-validator.service';
import { ConversationRuntimeService } from '../runtime/conversation-runtime.service';
import { ConversationRoutingDecisionService } from '../routing/conversation-routing-decision.service';
import { ConversationUnderstandingService } from '../understanding/conversation-understanding.service';
import { goalPreparationInput } from './conversation-routing.fixtures';
import { understandingInput } from './conversation-understanding.fixtures';

describe('ConversationRuntimeService', () => {
  let module: TestingModule;
  let understanding: ConversationUnderstandingService;
  let routing: ConversationRoutingDecisionService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ConversationModule],
    }).compile();
    understanding = module.get(ConversationUnderstandingService);
    routing = module.get(ConversationRoutingDecisionService);
  });

  afterAll(async () => module.close());

  function service(mode: 'OFF' | 'SHADOW' | 'INTERNAL', text = 'Olá') {
    const base = goalPreparationInput({} as never);
    const config = {
      get: jest.fn().mockReturnValue({
        mode,
        killSwitch: false,
        internalUserIds: [],
        canaryPercentage: 0,
        timeoutMs: 25_000,
        valid: true,
      }),
      isOfficiallyEligible: jest.fn().mockReturnValue(mode === 'INTERNAL'),
    };
    const contextBuilder = {
      build: jest.fn().mockResolvedValue({
        understandingInput: understandingInput(text),
        snapshot: base.snapshot,
        adaptiveDecision: base.adaptiveDecision,
        preparationBase: {
          snapshot: base.snapshot,
          adaptiveDecision: base.adaptiveDecision,
          progressContextAvailable: base.progressContextAvailable,
          confirmationPending: base.confirmationPending,
          recentHistory: base.recentHistory,
          continuity: base.continuity,
          referenceDate: base.referenceDate,
        },
      }),
    };
    return {
      runtime: new ConversationRuntimeService(
        config as never,
        contextBuilder as never,
        understanding,
        routing,
      ),
      contextBuilder,
    };
  }

  const request = {
    userId: 'user-id',
    conversationId: 'conversation-id',
    messageId: 'message-id',
    text: 'Olá',
    receivedAt: '2026-08-01T12:00:00.000Z',
    legacyIntent: 'UNKNOWN' as const,
  };

  it('evaluates officially even when historical mode metadata is OFF', async () => {
    const subject = service('OFF');

    await expect(subject.runtime.evaluate(request)).resolves.toMatchObject({
      summary: { status: 'OFFICIAL_CANDIDATE', routeKind: 'ANSWER_MESSAGE' },
    });
    expect(subject.contextBuilder.build).toHaveBeenCalledTimes(1);
  });

  it('runs the real deterministic understanding, planner and router pipeline', async () => {
    const subject = service('INTERNAL');
    const result = await subject.runtime.evaluate(request);

    expect(result.summary).toMatchObject({
      status: 'OFFICIAL_CANDIDATE',
      understandingStatus: 'UNDERSTOOD',
      goal: 'ANSWER_MESSAGE',
      routeKind: 'ANSWER_MESSAGE',
      confidence: 'HIGH',
    });
    const bridge = new ConversationExecutionBridgeService(
      new ConversationResponsePayloadBuilder(),
      new ConversationLanguageRealizerService(),
      new ConversationResponseFormatterService(),
      new ConversationResponseValidatorService(),
    );
    await expect(bridge.execute(result.decision!)).resolves.toMatchObject({
      status: 'COMPLETED',
      routeKind: 'ANSWER_MESSAGE',
    });
  });

  it('marks ambiguous text for fallback without calling the router', async () => {
    const subject = service('INTERNAL', 'quero mudar');

    await expect(
      subject.runtime.evaluate({ ...request, text: 'quero mudar' }),
    ).resolves.toMatchObject({
      summary: { status: 'FALLBACK_REQUIRED', ambiguityPresent: true },
      decision: null,
    });
  });

  it('treats historical SHADOW mode only as metadata', async () => {
    const subject = service('SHADOW');

    await expect(subject.runtime.evaluate(request)).resolves.toMatchObject({
      summary: { status: 'OFFICIAL_CANDIDATE', routeKind: 'ANSWER_MESSAGE' },
    });
  });

  it('returns FAILED and keeps a stable versioned operation key when context fails', async () => {
    const subject = service('INTERNAL');
    subject.contextBuilder.build.mockRejectedValue(new Error('context failed'));

    const first = await subject.runtime.evaluate(request);
    const second = await subject.runtime.evaluate(request);

    expect(first.summary).toMatchObject({
      status: 'FAILED',
      fallbackReason: 'CONTEXT_BUILD_FAILED',
      operationKey:
        'conversation-runtime:v1:39eb3bcc40aea12a8b72d16eba5072350c1819c0a71e34bb4240449122e2b85e',
    });
    expect(second.summary.operationKey).toBe(first.summary.operationKey);
  });

  it('rejects invalid identifiers before loading context', async () => {
    const subject = service('INTERNAL');

    await expect(
      subject.runtime.evaluate({ ...request, messageId: ' ' }),
    ).resolves.toMatchObject({
      summary: { status: 'FAILED', fallbackReason: 'INVALID_IDENTIFIERS' },
      decision: null,
    });
    expect(subject.contextBuilder.build).not.toHaveBeenCalled();
  });

  it('identifies a pre-QA context failure without logging private exception data', async () => {
    const subject = service('INTERNAL');
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    subject.contextBuilder.build.mockRejectedValue(
      new TypeError('private profile and message body'),
    );
    try {
      const result = await subject.runtime.evaluate({
        ...request,
        messageId: '95755ed4-6a56-4bd1-9977-6a13b55dd947',
        text: 'o treino que você montou para mim para academia, consigo gastar quantas calorias em média por treino?',
      });
      expect(result).toMatchObject({
        summary: {
          status: 'FAILED',
          understandingStatus: 'NOT_EVALUATED',
          recognizedIntent: null,
          routeKind: null,
          fallbackReason: 'CONTEXT_BUILD_FAILED',
        },
        decision: null,
      });
      expect(warning).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: '95755ed4-6a56-4bd1-9977-6a13b55dd947',
          stage: 'CONTEXT_BUILD',
          errorType: 'TypeError',
        }),
      );
      expect(JSON.stringify(warning.mock.calls)).not.toContain(
        'private profile',
      );
      const audit = { record: jest.fn().mockResolvedValue(undefined) };
      await new ConversationRuntimeAuditService(audit as never).record({
        request,
        evaluation: result,
        bridge: {
          status: 'FALLBACK_REQUIRED',
          content: null,
          routeKind: null,
          reason: 'RUNTIME_EVALUATION_FAILED',
        },
        selection: {
          source: 'LEGACY',
          content: 'Não consegui concluir isso com segurança agora.',
          reason: 'RUNTIME_FALLBACK',
        },
        comparison: {
          equivalent: false,
          classification: 'LEGACY_ONLY',
          code: 'NO_RUNTIME_ROUTE',
        },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            runtimeFallbackReason: 'CONTEXT_BUILD_FAILED',
          }),
        }),
      );
      expect(JSON.stringify(audit.record.mock.calls)).not.toContain(
        'private profile',
      );
    } finally {
      warning.mockRestore();
    }
  });

  it.each([
    'o treino que você montou para mim para academia, consigo gastar quantas calorias em média por treino?',
    'Qual seria uma estimativa de gasto energético por sessão desse treino?',
    'Quanto posso gastar em média de calorias fazendo meu treino de academia?',
  ])(
    'evaluates an expenditure question read-only when context is available: %s',
    async (text) => {
      const subject = service('INTERNAL', text);
      const result = await subject.runtime.evaluate({ ...request, text });
      expect(result.summary.status).toBe('OFFICIAL_CANDIDATE');
      expect(result.summary.understandingStatus).toBe('UNDERSTOOD');
      expect(result.summary.routeKind).toBe('ANSWER_MESSAGE');
    },
  );

  it.each(['UNDERSTANDING', 'ROUTING'] as const)(
    'distinguishes %s failures from context construction failures',
    async (stage) => {
      const subject = service('INTERNAL');
      const failure = new Error('private failure details');
      const fault =
        stage === 'UNDERSTANDING'
          ? jest.spyOn(understanding, 'understand').mockRejectedValue(failure)
          : jest.spyOn(routing, 'decide').mockImplementation(() => {
              throw failure;
            });
      try {
        await expect(subject.runtime.evaluate(request)).resolves.toMatchObject({
          summary: { status: 'FAILED', fallbackReason: `${stage}_FAILED` },
          decision: null,
        });
      } finally {
        fault.mockRestore();
      }
    },
  );
});
