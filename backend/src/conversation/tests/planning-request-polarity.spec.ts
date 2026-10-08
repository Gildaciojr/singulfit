import { explicitPlanningIntent } from '../understanding/explicit-planning-intent';
import { ConversationOperationResolverService } from '../understanding/conversation-operation-resolver.service';
import { ConversationMessageNormalizerService } from '../understanding/conversation-message-normalizer.service';
import { currentWorkoutModality } from '../../workout/v2/workout-modality-resolution.service';
import { isWorkoutEffectAuthorized } from '../../workout/v2/workout-generation-authorization.policy';

describe('Planning request polarity at recognition and effect authorization', () => {
  it.each([
    'Evite criar um novo plano de treino.',
    'Quero que você evite criar um novo treino.',
    'Por favor, pare de montar planos para mim.',
    'Impeça que você crie um novo treino.',
    'Proíbo você de alterar meu treino.',
    'Deixe de montar treinos para mim.',
    'Cesse de substituir meu plano de treino.',
    'Monte um treino; evite criar outro treino.',
    'Não gere um novo treino para mim.',
    'Não crie um plano de treino.',
    'Quero que você não monte um treino de CrossFit.',
    'Não precisa ajustar meu treino.',
    'Treinei superiores; não monte um treino para mim.',
    'Monte um treino de CrossFit; não crie outro treino.',
    'Nunca substitua meu treino por outro plano.',
    'Monte um treino; não o substitua.',
  ])('never authorizes the refused request: %s', (text) => {
    expect(isWorkoutEffectAuthorized(text)).toBe(false);
    expect(
      isWorkoutEffectAuthorized(text, {
        effect: 'GENERATE',
        requestQuote: text,
      }),
    ).toBe(false);
    expect(explicitPlanningIntent(text)).not.toMatch(
      /WORKOUT_PLAN_(REQUEST|UPDATE_REQUEST)/u,
    );
    expect(currentWorkoutModality(text).action).not.toBe('PLAN_REQUEST');
    const operation = new ConversationOperationResolverService().resolve(
      {
        continuity: {
          currentLogicalTurn: 0,
          activeProfileField: null,
          pendingConfirmation: false,
          targetPlan: null,
        },
      },
      new ConversationMessageNormalizerService().normalize(text),
    );
    expect(['GENERATE_PLAN', 'UPDATE_PLAN', 'SUBSTITUTE_ITEM']).not.toContain(
      operation.operation,
    );
  });
  it.each([
    'Monte um treino de CrossFit para mim.',
    'Pode montar um treino de musculação para mim?',
    'Não tenho equipamento; monte um treino em casa.',
    'Não quero dieta, mas monte um treino de CrossFit.',
    'Bebi água e treinei superiores; monte um novo treino de musculação.',
    'Não crie outro plano; adapte meu treino para casa.',
    'Monte um treino sem alterar minha dieta.',
    'Evite criar uma dieta, mas monte um treino.',
    'Não tenho equipamentos; crie um treino para mim.',
  ])(
    'preserves an affirmative request and unrelated negative facts: %s',
    (text) => {
      expect(isWorkoutEffectAuthorized(text)).toBe(true);
    },
  );
  it('does not let a model quote erase a negation or a later refusal', () => {
    expect(
      isWorkoutEffectAuthorized('Não gere um novo treino.', {
        effect: 'GENERATE',
        requestQuote: 'gere um novo treino',
      }),
    ).toBe(false);
    expect(
      isWorkoutEffectAuthorized('Monte um treino. Não crie outro treino.', {
        effect: 'GENERATE',
        requestQuote: 'Monte um treino',
      }),
    ).toBe(false);
    expect(
      isWorkoutEffectAuthorized('Não quero dieta, mas monte um treino.', {
        effect: 'GENERATE',
        requestQuote: 'monte um treino',
      }),
    ).toBe(true);
  });
  it.each([
    'Evite criar um novo treino.',
    'Por favor, pare de montar planos para mim.',
  ])('does not authorize a model-selected affirmative fragment: %s', (text) => {
    const requestQuote = text.includes('criar')
      ? 'criar um novo treino'
      : 'montar planos para mim';
    expect(
      isWorkoutEffectAuthorized(text, { effect: 'GENERATE', requestQuote }),
    ).toBe(false);
  });
  it('does not turn a refused domain into a combined request', () => {
    expect(isWorkoutEffectAuthorized('Quero uma dieta, não treino.')).toBe(
      false,
    );
    expect(explicitPlanningIntent('Quero uma dieta, não treino.')).toBe(
      'DIET_PLAN_REQUEST',
    );
    expect(
      explicitPlanningIntent('Não quero dieta, mas monte um treino.'),
    ).toBe('WORKOUT_PLAN_REQUEST');
  });
});
