import { ConversationLanguageRealizerService } from '../runtime/conversation-language-realizer.service';
import { ConversationResponseFormatterService } from '../runtime/conversation-response-formatter.service';
import { ConversationResponseValidatorService } from '../runtime/conversation-response-validator.service';

describe('Conversation response pipeline', () => {
  const realizer = new ConversationLanguageRealizerService();
  const formatter = new ConversationResponseFormatterService();
  const validator = new ConversationResponseValidatorService();

  it.each([
    ['DIET', 'plano alimentar'],
    ['WORKOUT', 'treino'],
    ['BOTH', 'plano alimentar e do treino'],
    [null, 'alimentação, treino ou dos dois'],
  ] as const)(
    'realizes one contextual confirmation for %s',
    (targetPlan, expected) => {
      const result = realizer.realize({
        kind: 'CONFIRMATION_REQUEST',
        targetPlan,
      });

      expect(result.requiresFollowUp).toBe(true);
      expect(result.followUpQuestion).toContain(expected);
      expect(validator.isValid(result)).toBe(true);
      expect(formatter.format(result).match(/\?/g)).toHaveLength(1);
    },
  );

  it.each([
    ['CAUTION_GUIDANCE', 'observe os sintomas'],
    ['PROFESSIONAL_GUIDANCE', 'profissional de saúde'],
    ['URGENT_GUIDANCE', 'serviço de urgência'],
  ] as const)(
    'realizes safe non-clinical guidance for %s',
    (action, expected) => {
      const result = realizer.realize({ kind: 'SAFETY_GUIDANCE', action });

      expect(result.message).toContain(expected);
      expect(result.requiresFollowUp).toBe(false);
      expect(validator.isValid(result)).toBe(true);
    },
  );

  it.each([
    { message: '', requiresFollowUp: false, followUpQuestion: null },
    {
      message: 'x'.repeat(4_001),
      requiresFollowUp: false,
      followUpQuestion: null,
    },
    { message: 'Mensagem', requiresFollowUp: true, followUpQuestion: null },
    { message: 'Uma? Duas?', requiresFollowUp: false, followUpQuestion: null },
    {
      message: '{"message":"visível"}',
      requiresFollowUp: false,
      followUpQuestion: null,
    },
    {
      message: 'Este é um diagnóstico.',
      requiresFollowUp: false,
      followUpQuestion: null,
    },
    {
      message: 'Salvei seu plano.',
      requiresFollowUp: false,
      followUpQuestion: null,
    },
  ] as const)('rejects an invalid realized response: %o', (response) => {
    expect(validator.isValid(response)).toBe(false);
  });
});
