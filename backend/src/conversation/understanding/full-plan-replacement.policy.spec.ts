import { isFullPlanReplacementRequest } from './full-plan-replacement.policy';

describe('isFullPlanReplacementRequest', () => {
  it.each([
    'quero outra dieta',
    'crie uma nova dieta',
    'monte outro plano',
    'quero um plano totalmente diferente',
    'faça outro treino',
    'substitua todo o meu treino',
  ])('recognizes a full commercial replacement: %s', (message) => {
    expect(isFullPlanReplacementRequest(message)).toBe(true);
  });

  it.each([
    'troque o arroz da minha dieta',
    'substitua o agachamento',
    'adapte meu treino para 45 minutos',
    'mostre meu plano atual',
  ])('keeps a point maintenance request outside generation: %s', (message) => {
    expect(isFullPlanReplacementRequest(message)).toBe(false);
  });
});
