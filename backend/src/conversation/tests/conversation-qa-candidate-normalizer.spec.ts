import { ConversationPublicAnswerBoundaryService } from '../runtime/conversation-public-answer-boundary.service';
import { normalizeConversationQACandidate } from '../runtime/conversation-qa-candidate-normalizer';
import type { ConversationAnswerCandidate } from '../runtime/conversation-qa.contract';

describe('normalizeConversationQACandidate', () => {
  const boundary = new ConversationPublicAnswerBoundaryService();

  function candidate(
    answer: string | null,
    followUpQuestion: string | null = null,
  ): ConversationAnswerCandidate {
    return Object.freeze({
      disposition: 'ANSWER',
      domain: 'NUTRITION',
      answer,
      followUpQuestion,
      grounding: 'CURRENT_PLAN',
      confidence: 'HIGH',
    });
  }

  it('moves the production trailing offer without changing public output', () => {
    const original = candidate(
      'No almoço, você tem *3 xícaras de arroz branco cozido* 🍚\n\nSe quiser, eu também posso te passar isso em gramas aproximadas.',
    );

    const normalized = normalizeConversationQACandidate(original);

    expect(normalized).toEqual({
      ...original,
      answer: 'No almoço, você tem *3 xícaras de arroz branco cozido* 🍚',
      followUpQuestion:
        'Se quiser, eu também posso te passar isso em gramas aproximadas.',
    });
    expect(boundary.project(normalized)).toBe(boundary.project(original));
  });

  it.each([
    'Quer que eu converta isso para gramas?',
    'Posso te mostrar as substituições também?',
    'Se você quiser, posso comparar isso com seu plano.',
    'Se quiser, eu posso te mostrar isso em gramas.',
  ])('moves an explicit trailing coach offer verbatim: %s', (offer) => {
    const normalized = normalizeConversationQACandidate(
      candidate(`Resposta factual.\n\n${offer}`),
    );

    expect(normalized.answer).toBe('Resposta factual.');
    expect(normalized.followUpQuestion).toBe(offer);
  });

  it.each([
    candidate('Resposta factual.'),
    candidate(
      'Resposta factual.\n\nSe quiser emagrecer, mantenha regularidade nas refeições.',
    ),
    candidate('Resposta factual.\n\nPosso consumir arroz no jantar?'),
    candidate(null),
    candidate(
      'Resposta factual.\n\nPosso te ajudar?',
      'Pergunta já estruturada.',
    ),
  ])('leaves a non-eligible candidate unchanged', (original) => {
    expect(normalizeConversationQACandidate(original)).toBe(original);
  });

  it('does not make unsafe content public while normalizing its structure', () => {
    const normalized = normalizeConversationQACandidate(
      candidate(
        'O operationKey interno não pode aparecer.\n\nQuer que eu detalhe isso?',
      ),
    );

    expect(normalized.followUpQuestion).toBe('Quer que eu detalhe isso?');
    expect(boundary.project(normalized)).toBeNull();
  });
});
