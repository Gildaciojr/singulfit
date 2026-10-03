import { AIJobStatus } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AIService } from '../../ai/ai.service';
import type { EventBusService } from '../../event-bus/event-bus.service';
import { CoachProactiveResponseService } from '../../automation/coach-proactive-response.service';
import {
  CoachProactiveRealizerService,
  hasProactiveSideEffectClaim,
  isSafeProactiveText,
} from '../../automation/coach-proactive-realizer.service';
import { ConversationPublicAnswerBoundaryService } from '../runtime/conversation-public-answer-boundary.service';
import {
  PUBLIC_HUMANIZATION_GOLDEN,
  type PublicHumanizationGolden,
} from './public-humanization-golden.fixtures';

const boundary = new ConversationPublicAnswerBoundaryService();
function conforms(
  sample: PublicHumanizationGolden,
  text = sample.text,
): boolean {
  return (
    boundary.projectText(text) !== null &&
    text.length <= 350 &&
    !/^\s*\d+[.)]\s/mu.test(text) &&
    (text.match(/\?/gu) ?? []).length <= 1 &&
    !/você é (?:incrível|um campeão)|parabéns guerreir/iu.test(text) &&
    (sample.sideEffectConfirmed || !hasProactiveSideEffectClaim(text)) &&
    sample.requiredConcepts.every((concept) => concept.test(text)) &&
    sample.forbiddenConcepts.every((concept) => !concept.test(text)) &&
    (sample.safetyExpectations ?? []).every((concept) => concept.test(text))
  );
}
function fixture(scenario: string): PublicHumanizationGolden {
  const sample = PUBLIC_HUMANIZATION_GOLDEN.find(
    (row) => row.scenario === scenario,
  );
  if (!sample) throw new Error(`Missing semantic fixture: ${scenario}`);
  return sample;
}

describe('Public humanization semantic golden contract', () => {
  it.each(PUBLIC_HUMANIZATION_GOLDEN)(
    'preserves $domain / $outcome: $scenario',
    (sample) => {
      expect(conforms(sample)).toBe(true);
    },
  );

  // The producer's response method is exercised directly here; transaction and
  // receipt-before-publication are exercised through capture in its own spec.
  it.each(PUBLIC_HUMANIZATION_GOLDEN.filter((row) => row.intent !== undefined))(
    'validates the real reminder producer for $scenario',
    (sample) => {
      const service = new CoachProactiveResponseService(
        {} as PrismaService,
        {} as EventBusService,
      );
      if (!sample.intent) throw new Error('Missing reminder intent');
      const hydrationEvidence =
        sample.outcome === 'WATER_CONSUMED' ||
        sample.outcome === 'GOAL_COMPLETED'
          ? sample.outcome
          : null;
      const outcome = hydrationEvidence ? 'COMPLETED' : sample.outcome;
      if (
        outcome !== 'COMPLETED' &&
        outcome !== 'PARTIAL' &&
        outcome !== 'SKIPPED' &&
        outcome !== 'DEFERRED' &&
        outcome !== 'UNKNOWN' &&
        outcome !== 'ISSUE_REPORTED'
      )
        throw new Error('Invalid reminder outcome');
      const text = service['response'](
        sample.intent,
        outcome,
        hydrationEvidence,
        null,
      );
      expect(conforms(sample, text)).toBe(true);
    },
  );

  it.each([
    [
      'refeição cumprida',
      'Seu almoço está pendente; quando conseguir parar, coma.',
    ],
    [
      'refeição diferente',
      'Boa, almoço feito! Você seguiu tudo perfeitamente.',
    ],
    [
      'refeição diferente',
      'Entendi, seu almoço foi diferente. Priorize seu almoço quando conseguir parar.',
    ],
    [
      'refeição diferente',
      'Seu almoço foi diferente. Na próxima refeição retome. Você consumiu 500 kcal.',
    ],
    [
      'refeição diferente',
      'Seu almoço foi diferente. Na próxima refeição, compense o que comeu.',
    ],
    ['refeição pulada', 'Boa, almoço feito! Você almoçou.'],
    ['refeição adiada', 'Sua refeição foi concluída.'],
    ['refeição desconhecida', 'Você comeu e seu almoço foi concluído.'],
    ['treino cumprido', 'Você fez só uma parte do treino.'],
    ['treino parcial', 'Boa! Treino concluído.'],
    ['treino pulado', 'Treino realizado e registrado.'],
    ['treino adiado', 'Seu treino foi concluído.'],
    ['treino desconhecido', 'Você treinou tudo.'],
    ['dor ou limitação', 'Continue treinando mesmo com dor.'],
    ['água consumida', 'Boa! Meta diária concluída.'],
    ['hidratação parcial', 'Você cumpriu toda a meta de água.'],
    ['progresso sem dados', 'Você perdeu 5 kg nesta semana.'],
    ['erro temporário', 'Seu pedido foi concluído e registrado.'],
    ['mutation bloqueada', 'Troquei seu treino.'],
    ['mutation bloqueada', 'Atualizei sua dieta.'],
    ['mutation bloqueada', 'Salvei sua preferência.'],
    ['mutation bloqueada', 'Registrei seu treino.'],
  ])('rejects semantic counterexample for %s: %s', (scenario, text) => {
    expect(conforms(fixture(scenario), text)).toBe(false);
  });

  it.each([
    'Troquei seu treino.',
    'Atualizei sua dieta.',
    'Salvei sua preferência.',
    'Registrei seu treino.',
  ])(
    'requires confirmed effect for the claim %s without banning legitimate receipts',
    (text) => {
      const sample: PublicHumanizationGolden = {
        scenario: 'canonical effect receipt',
        domain: 'MUTATION',
        outcome: 'CONFIRMED',
        text,
        requiredConcepts: [/(?:troquei|atualizei|salvei|registrei)/iu],
        forbiddenConcepts: [],
        sideEffectConfirmed: false,
      };
      expect(conforms(sample)).toBe(false);
      expect(conforms({ ...sample, sideEffectConfirmed: true })).toBe(true);
      expect(boundary.projectText(text)).toBe(text);
      expect(isSafeProactiveText(text)).toBe(false);
    },
  );

  it.each([
    'Seu pipeline está pronto.',
    'Como está? Já treinou? Vai comer?',
    'Escolha:\n1. Treino\n2. Dieta',
    'Você é um campeão!',
  ])('rejects unsafe public form %s', (text) => {
    expect(conforms(fixture('pergunta simples'), text)).toBe(false);
  });

  it('uses the real cached realizer fallback and then the existing public boundary', async () => {
    const ai = {
      createStandaloneJob: jest.fn().mockResolvedValue({
        id: 'job',
        status: AIJobStatus.COMPLETED,
        result: { text: 'Troquei seu treino.' },
      }),
      runTextJob: jest.fn(),
      completeJobInTransaction: jest.fn(),
      failJob: jest.fn(),
    };
    const service = new CoachProactiveRealizerService(
      {} as PrismaService,
      ai as unknown as AIService,
    );
    const text = await service.realize({
      userId: 'user',
      operationKey: 'existing-operation',
      intent: 'WORKOUT_CHECK',
      slotKey: 'WORKOUT_EVENING',
      localTime: '18:00',
      preferredName: null,
      goal: 'HEALTH',
      nutritionPlanSummary: null,
      workoutPlanSummary: null,
      trainingTime: null,
      mealTimes: [],
      fallback: 'Hoje você tem treino de pernas.',
    });
    expect(text).toBe('Hoje você tem treino de pernas.');
    expect(boundary.projectText(text)).toBe(text);
    expect(hasProactiveSideEffectClaim(text)).toBe(false);
    expect(ai.runTextJob).not.toHaveBeenCalled();
    expect(ai.completeJobInTransaction).not.toHaveBeenCalled();
    expect(ai.failJob).not.toHaveBeenCalled();
  });
});
