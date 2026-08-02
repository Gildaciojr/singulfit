import { ConversationRuntimeAuditService } from '../runtime/conversation-runtime-audit.service';

describe('ConversationRuntimeAuditService', () => {
  it('persists only hashes and decision metadata', async () => {
    const audit = { record: jest.fn().mockResolvedValue({ id: 'audit-id' }) };
    const service = new ConversationRuntimeAuditService(audit as never);

    await service.record({
      request: {
        userId: 'sensitive-user',
        conversationId: 'sensitive-conversation',
        messageId: 'sensitive-message',
        text: 'private message body',
        receivedAt: '2026-08-01T12:00:00.000Z',
        legacyIntent: 'UNKNOWN',
      },
      evaluation: {
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
          durationMs: 3,
          versions: {
            runtime: 'conversation-runtime:v1',
            understanding: 'conversation-understanding:v1',
            routing: 'conversation-routing-decision:v1',
          },
        },
        decision: null,
      },
      bridge: {
        status: 'COMPLETED',
        content: 'private runtime response',
        routeKind: 'ANSWER_MESSAGE',
      },
      selection: {
        source: 'CONVERSATION_RUNTIME',
        content: 'private runtime response',
        reason: 'RUNTIME_SELECTED',
      },
      comparison: {
        equivalent: true,
        classification: 'MATCH',
        code: 'GENERAL_ROUTE_MATCH',
      },
    });

    const serialized = JSON.stringify(audit.record.mock.calls[0][0]);
    expect(serialized).not.toContain('private message body');
    expect(serialized).not.toContain('private runtime response');
    expect(serialized).not.toContain('sensitive-user');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CONVERSATION_RUNTIME_EVALUATED',
        entityType: 'CONVERSATION_RUNTIME',
      }),
    );
  });

  it('never propagates an audit failure', async () => {
    const service = new ConversationRuntimeAuditService({
      record: jest.fn().mockRejectedValue(new Error('audit unavailable')),
    } as never);

    await expect(
      service.record({
        request: {
          userId: 'u',
          conversationId: 'c',
          messageId: 'm',
          text: 'x',
          receivedAt: '2026-08-01T12:00:00.000Z',
          legacyIntent: 'UNKNOWN',
        },
        evaluation: {
          summary: {
            status: 'FAILED',
            mode: 'PRIMARY',
            operationKey: 'k',
            understandingStatus: 'FAILED',
            recognizedIntent: null,
            goal: null,
            routeKind: null,
            confidence: null,
            ambiguityPresent: false,
            safetyRequired: false,
            authorized: true,
            fallbackReason: 'Error',
            durationMs: 1,
            versions: {
              runtime: 'conversation-runtime:v1',
              understanding: 'conversation-understanding:v1',
              routing: 'conversation-routing-decision:v1',
            },
          },
          decision: null,
        },
        bridge: {
          status: 'FAILED',
          content: null,
          routeKind: null,
          reason: 'failed',
        },
        selection: {
          source: 'LEGACY',
          content: 'legacy',
          reason: 'RUNTIME_FALLBACK',
        },
        comparison: {
          equivalent: false,
          classification: 'LEGACY_ONLY',
          code: 'NO_RUNTIME_ROUTE',
        },
      }),
    ).resolves.toBeUndefined();
  });
});
