import { ConversationNutritionMutationService } from '../runtime/conversation-nutrition-mutation.service';
import { CurrentNutritionPlanReaderService } from '../../diet/current-nutrition-plan-reader.service';
import { CoachProfileSnapshotBuilder } from '../../context/coach-profile-snapshot.builder';
import { ConversationPlanReferenceService } from '../understanding/conversation-plan-reference.service';
import { NutritionApplicationExecutorService } from '../../diet/v2/execution/nutrition-application-executor.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { ConversationGoalDecision } from '../../context/conversation-goal-planner.contract';

describe('ConversationNutritionMutationService', () => {
  const at = new Date('2026-08-24T15:00:00Z');
  function setup(text = 'troque o frango') {
    const days = ['segunda', 'terça'].map((day, index) => ({
      dayNumber: index + 1,
      label: `${day}-feira`,
      meals: [
        {
          mealKey: `lunch-${index}`,
          name: `Almoço ${day}`,
          period: 'LUNCH',
          items: [
            {
              itemKey: `rice-${index}`,
              foodName: 'Arroz integral',
              quantity: '150 g',
            },
            {
              itemKey: `chicken-${index}`,
              foodName: 'Frango grelhado',
              quantity: '120 g',
            },
          ],
        },
      ],
    }));
    const current = {
      id: 'source-plan',
      userId: 'user',
      profileId: 'profile',
      implementation: 'V2',
      document: { artifactType: 'WEEKLY_PLAN', days },
    };
    const reader = { getCurrent: jest.fn().mockResolvedValue(current) };
    const snapshot = {
      identity: { userId: { status: 'KNOWN', value: 'user' } },
      conversation: {
        timezone: { status: 'KNOWN', value: 'America/Sao_Paulo' },
      },
    };
    const snapshots = { build: jest.fn().mockResolvedValue(snapshot) };
    const references = {
      recentAssistant: jest
        .fn()
        .mockResolvedValue(
          '*Almoço segunda*: 150 g de Arroz integral, 120 g de Frango grelhado.',
        ),
    };
    const executor = {
      execute: jest
        .fn()
        .mockResolvedValue({ kind: 'PLAN', document: current.document }),
    };
    const prisma = {
      message: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'message',
          content: text,
          timestamp: at,
          conversation: { id: 'conversation', userId: 'user' },
        }),
      },
    };
    const service = new ConversationNutritionMutationService(
      reader as unknown as CurrentNutritionPlanReaderService,
      snapshots as unknown as CoachProfileSnapshotBuilder,
      references as unknown as ConversationPlanReferenceService,
      executor as unknown as NutritionApplicationExecutorService,
      prisma as unknown as PrismaService,
    );
    const input = {
      userId: 'user',
      conversationId: 'conversation',
      messageId: 'message',
      referenceDate: at,
      decision: {
        goal: 'UPDATE_DIET_PLAN',
        targetPlan: 'DIET',
        canExecute: true,
      } as ConversationGoalDecision,
    };
    return {
      service,
      current,
      reader,
      snapshots,
      references,
      executor,
      prisma,
      input,
    };
  }
  it.each([
    ['troque o frango', 'chicken-0'],
    ['não tenho arroz', 'rice-0'],
  ])(
    'resolves %s against only the immediately presented lunch',
    async (text, itemKey) => {
      const s = setup(text);
      expect(await s.service.execute(s.input)).toMatchObject({
        completed: true,
      });
      expect(s.executor.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          ownership: { userId: 'user', profileId: 'profile' },
          continuationOperationKey: 'nutrition-mutation:user:message',
          generationInput: expect.objectContaining({
            previousPlan: s.current.document,
            explicitArtifactType: 'FOOD_SUBSTITUTION',
            mutationTarget: expect.objectContaining({
              dayNumber: 1,
              mealKey: 'lunch-0',
              itemKey,
              sourcePlanId: 'source-plan',
            }),
          }),
        }),
      );
    },
  );
  it('resolves lunch today by local day without relying on dayNumber as weekday', async () => {
    const s = setup('troque meu almoço de hoje');
    s.current.document.days[0].dayNumber = 7;
    await s.service.execute(s.input);
    expect(s.executor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        generationInput: expect.objectContaining({
          mutationTarget: expect.objectContaining({
            dayNumber: 7,
            mealKey: 'lunch-0',
            itemKey: null,
          }),
          explicitArtifactType: 'PLAN_ADAPTATION',
        }),
      }),
    );
  });
  it('clarifies multiple named targets without a recent presentation', async () => {
    const s = setup();
    s.references.recentAssistant.mockResolvedValue(null);
    expect(await s.service.execute(s.input)).toMatchObject({
      completed: false,
      content: expect.stringContaining('Qual refeição'),
    });
    expect(s.executor.execute).not.toHaveBeenCalled();
  });
  it('clarifies a deictic food within a meal that contains multiple items', async () => {
    const s = setup('troque esse alimento');
    expect(await s.service.execute(s.input)).toMatchObject({
      completed: false,
      content: expect.stringContaining('Qual alimento'),
    });
    expect(s.executor.execute).not.toHaveBeenCalled();
  });
  it('does not mutate an unreferenced deictic request', async () => {
    const s = setup('troque isso');
    s.references.recentAssistant.mockResolvedValue(null);
    expect(await s.service.execute(s.input)).toMatchObject({
      completed: false,
    });
    expect(s.executor.execute).not.toHaveBeenCalled();
  });
  it.each(['troque carne', 'troque carne do almoço'])(
    'does not widen an unresolved named food into a meal mutation: %s',
    async (request) => {
      const s = setup(request);
      expect(await s.service.execute(s.input)).toMatchObject({
        completed: false,
      });
      expect(s.executor.execute).not.toHaveBeenCalled();
    },
  );
  it.each(['FOREIGN', 'LEGACY', 'ABSENT'])(
    'blocks %s current plan without generation',
    async (variant) => {
      const s = setup();
      s.reader.getCurrent.mockResolvedValue(
        variant === 'ABSENT'
          ? null
          : {
              ...s.current,
              userId: variant === 'FOREIGN' ? 'other' : 'user',
              implementation: variant === 'LEGACY' ? 'LEGACY' : 'V2',
            },
      );
      expect(await s.service.execute(s.input)).toMatchObject({
        completed: false,
      });
      expect(s.executor.execute).not.toHaveBeenCalled();
    },
  );
  it.each(['posso trocar arroz por batata?', 'qual meu almoço de hoje?'])(
    'never mutates a question: %s',
    async (text) => {
      const s = setup(text);
      expect(await s.service.execute(s.input)).toMatchObject({
        completed: false,
      });
      expect(s.executor.execute).not.toHaveBeenCalled();
    },
  );
  it('blocks foreign inbound/snapshot and false authorization', async () => {
    const s = setup();
    s.prisma.message.findFirst.mockResolvedValue({
      id: 'message',
      timestamp: at,
      conversation: { id: 'conversation', userId: 'other' },
    });
    expect(await s.service.execute(s.input)).toMatchObject({
      completed: false,
    });
    expect(s.reader.getCurrent).not.toHaveBeenCalled();
    const other = setup();
    other.input.decision = { ...other.input.decision, canExecute: false };
    expect(await other.service.execute(other.input)).toMatchObject({
      completed: false,
    });
    expect(other.prisma.message.findFirst).not.toHaveBeenCalled();
  });
  it('does not claim a mutation when execution/validation fails', async () => {
    const s = setup();
    s.executor.execute.mockRejectedValue(new Error('allergy conflict'));
    const result = await s.service.execute(s.input);
    expect(result.completed).toBe(false);
    expect(result.content).not.toContain('Atualizei');
  });
});
