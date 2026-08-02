import type { ConversationSafetySignal } from '../contracts/conversation-understanding.contract';
import { evaluateConversationSafety } from '../routing/conversation-safety-routing.policy';

describe('evaluateConversationSafety', () => {
  it.each([
    ['PAIN', 'LOW', 'CAUTION_GUIDANCE', true],
    ['INJURY', 'UNSPECIFIED', 'PROFESSIONAL_GUIDANCE', true],
    ['MEDICAL', 'LOW', 'PROFESSIONAL_GUIDANCE', true],
    ['INCAPACITY', 'MEDIUM', 'PROFESSIONAL_GUIDANCE', true],
    ['EXTREME_REQUEST', 'HIGH', 'URGENT_GUIDANCE', true],
    ['OTHER_RISK', 'LOW', 'CONTINUE', false],
  ] as const)(
    'maps %s/%s deterministically',
    (category, severity, action, routeRequired) => {
      expect(
        evaluateConversationSafety({
          signals: [{ category, severity }],
          requiresSafeResponse: routeRequired,
          requiresProfessionalGuidance:
            action === 'PROFESSIONAL_GUIDANCE' || action === 'URGENT_GUIDANCE',
          medicalAdviceProhibited: true,
        }),
      ).toMatchObject({ action, routeRequired });
    },
  );

  it('selects the highest-priority signal independently of input order', () => {
    const signals: readonly ConversationSafetySignal[] = [
      { category: 'PAIN', severity: 'LOW' },
      { category: 'OTHER_RISK', severity: 'HIGH' },
      { category: 'MEDICAL', severity: 'MEDIUM' },
    ];
    expect(
      evaluateConversationSafety({
        signals,
        requiresSafeResponse: true,
        requiresProfessionalGuidance: true,
        medicalAdviceProhibited: true,
      }).action,
    ).toBe('URGENT_GUIDANCE');
  });
});
