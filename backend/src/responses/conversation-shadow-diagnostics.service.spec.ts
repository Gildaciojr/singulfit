import { Logger } from '@nestjs/common';
import { ConversationShadowDiagnosticsService } from './conversation-shadow-diagnostics.service';

describe('ConversationShadowDiagnosticsService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('logs only supplied safe technical metrics', () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const service = new ConversationShadowDiagnosticsService();

    service.record({
      event: 'COMPLETED',
      realizerStatus: 'COMPLETED',
      candidateEligible: true,
      latencyMs: 12,
      legacyCharacters: 20,
      candidateCharacters: 18,
    });

    const serialized = String(log.mock.calls[0]?.[0]);
    expect(serialized).toContain('"event":"COMPLETED"');
    expect(serialized).not.toContain('candidateText');
    expect(serialized).not.toContain('legacyText');
    expect(serialized).not.toContain('payload');
    expect(serialized).not.toContain('base64');
  });

  it('absorbs logger failures', () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {
      throw new Error('logger unavailable');
    });

    expect(() =>
      new ConversationShadowDiagnosticsService().record({ event: 'FAILED' }),
    ).not.toThrow();
  });
});
