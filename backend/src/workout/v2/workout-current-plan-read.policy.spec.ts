import { isWorkoutCurrentPlanRead } from './workout-current-plan-read.policy';

describe('isWorkoutCurrentPlanRead', () => {
  it.each([
    'Qual é meu treino atual?',
    'Mostre meu treino atual',
    'Quero ver meu treino',
    'Qual é meu treino de hoje?',
    'O que treino hoje?',
    'Como está meu plano de treino ativo?',
    'Status do meu treino',
    'Meu treino',
    'Sessão 1',
    'Mostre a sessão 7',
    'E a sessão três',
  ])('recognizes the side-effect-free current Workout read: %s', (message) => {
    expect(isWorkoutCurrentPlanRead(message)).toBe(true);
  });

  it.each([
    'quero um novo treino',
    'gere outro treino',
    'troque meu treino',
    'adapte meu treino',
    'substitua o agachamento no meu treino',
    'quero treinar 4 vezes por semana',
    'preciso mudar a duração do treino para 45 minutos',
    'altere a modalidade para corrida',
    'monte um treino para academia',
    'Treino em academia, monte um treino de 5 vezes na semana',
    'Monte meu treino 5 vezes por semana',
    'Quero treinar 4 dias na semana',
  ])('rejects Workout creation or mutation: %s', (message) => {
    expect(isWorkoutCurrentPlanRead(message)).toBe(false);
  });

  it.each([undefined, '', 'qual é minha dieta atual?', 'como você está?'])(
    'rejects a non-Workout read: %s',
    (message) => {
      expect(isWorkoutCurrentPlanRead(message)).toBe(false);
    },
  );
});
