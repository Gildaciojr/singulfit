import { explicitContinuationDomain } from '../understanding/explicit-continuation-domain.policy';

describe('explicitContinuationDomain', () => {
  it.each([
    ['Qual minha próxima refeição?', 'NUTRITION'],
    [
      'Não mandei sobre treino. Perguntei QUAL A MINHA PRÓXIMA REFEIÇÃO DE HOJE',
      'NUTRITION',
    ],
    ['não perguntei de treino, perguntei minha próxima refeição', 'NUTRITION'],
    ['O que posso comer no jantar?', 'NUTRITION'],
    ['Quanto de proteína consumi hoje?', 'NUTRITION'],
    ['Posso substituir o frango por outra proteína?', 'NUTRITION'],
    ['Quero uma dieta', 'NUTRITION'],
    ['Qual meu treino de amanhã?', 'WORKOUT'],
    ['Quero um treino', 'WORKOUT'],
    ['Quero uma dieta e um treino', 'COMBINED'],
  ])('recognizes %s independently of continuity', (text, domain) => {
    expect(explicitContinuationDomain(text)).toBe(domain);
  });
  it.each([
    'e depois?',
    'e amanhã?',
    'sim',
    'não',
    'já comi',
    'já treinei',
    'arroz, feijão, frango e salada',
    'bebi água',
    'bom dia',
    'oi',
  ])('does not invent a new explicit domain for %s', (text) => {
    expect(explicitContinuationDomain(text)).toBeNull();
  });
});
