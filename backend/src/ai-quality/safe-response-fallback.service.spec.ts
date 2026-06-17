import { SafeResponseFallbackService } from './safe-response-fallback.service';

describe('SafeResponseFallbackService', () => {
  it('returns a short, non-medical and actionable fallback', () => {
    const content = new SafeResponseFallbackService().build();

    expect(content).toContain('orientações gerais de alimentação e hábitos');
    expect(content).toContain('acompanhamento profissional');
    expect(content).toContain('alternativa alimentar mais segura');
    expect(content.length).toBeLessThan(300);
  });
});
