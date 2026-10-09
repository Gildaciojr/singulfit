import { AIJobStatus, AIJobType } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import type { OpenAIGateway } from '../../ai/openai.gateway';
import { AIService } from '../../ai/ai.service';
import { ConversationPublicAnswerBoundaryService } from '../runtime/conversation-public-answer-boundary.service';
import { ConversationQAExecutorService } from '../runtime/conversation-qa-executor.service';
import { ConversationNutritionDeterministicAnswerService } from '../runtime/conversation-nutrition-deterministic-answer.service';
import {
  nutritionAdviceContext,
  nutritionAdviceViolation,
} from '../runtime/nutrition-advice.policy';
import { nutritionRequest } from '../understanding/nutrition-request.policy';
import type { PersonalizedCoachContextService } from '../runtime/personalized-coach-context.service';
import type { CoachConversationHumanContext } from '../../context/coach-conversation-human-context.contract';
import type { PublicNutritionResponse } from '../../diet/v2/presentation/public-nutrition-response.contract';
import type { ConversationExecutionRoute } from '../contracts/conversation-execution-route.contract';
import {
  COACH_CONVERSATIONAL_QA_V1_PROMPT,
  COACH_CONVERSATIONAL_QA_V2_PROMPT_SEED,
} from '../runtime/coach-conversational-qa.prompt.definition';

describe('ConversationQAExecutorService', () => {
  const substitutionQuestion =
    'Nesse almoço das 12h que você acabou de me mostrar, posso substituir o peito de frango por ovos? Essa substituição está prevista na minha dieta atual? Não quero alterar meu plano, apenas saber.';
  const informalSubstitution =
    'uai no almoço kkk, posso trocar o frango por ovo ou não?';
  it('does not turn historical plan commands into food exclusions, preserving confirmed vegetables', async () => {
    const message = 'Me dê uma dica alternativa de jantar para hoje?';
    const context = {
      ...human(message),
      nutrition: {
        ...human('').nutrition,
        rejectedFoods: {
          value: ['beterraba', 'tomate', 'alterar meu plano'],
          sources: [],
        },
      },
    };
    const advice = nutritionAdviceContext(
      context,
      null,
      null,
      null,
      new Date('2026-10-08T12:00:00Z'),
    );
    expect(advice?.excludedFoods).toEqual(['beterraba', 'tomate']);
    for (const answer of [
      'Uma opção é tomate com lentilhas.',
      'Uma opção é beterraba com legumes.',
    ]) {
      expect(
        nutritionAdviceViolation(advice, {
          disposition: 'ANSWER',
          domain: 'NUTRITION',
          answer,
          followUpQuestion: null,
          grounding: 'MIXED',
          confidence: 'HIGH',
        }),
      ).toBe('NUTRITION_ADVICE_REJECTED_FOOD');
    }
    const answer =
      'Sem alterar meu plano, uma ideia aproximada é lentilhas com legumes.';
    const s = createSubject(
      substitutionAnswer(answer),
      AIJobStatus.PENDING,
      true,
    );
    expect(
      await s.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'clean-exclusions',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: context,
      }),
    ).toMatchObject({ status: 'COMPLETED', content: answer });
    expect(JSON.parse(s.ai.runTextJob.mock.calls[0][1].input)).toMatchObject({
      nutritionGuidance: { excludedFoods: ['beterraba', 'tomate'] },
    });
  });
  it.each([AIJobStatus.PENDING, AIJobStatus.FAILED])(
    'clarifies rejected free advice without a correction gateway or replaying a failed provider: %s',
    async (status) => {
      const s = createSubject(
        substitutionAnswer('Experimente frango grelhado.'),
        status,
        true,
      );
      const job = {
        id: 'job-id',
        userId: 'user-id',
        status,
        result: null,
        error:
          status === AIJobStatus.FAILED
            ? 'NUTRITION_ADVICE_REJECTED_FOOD'
            : null,
        promptVersion: { prompt: 'Existing QA instructions' },
      };
      s.ai.createJob.mockResolvedValue(job);
      const context = {
        ...human('Me dê uma dica alternativa de jantar para hoje?'),
        nutrition: {
          ...human('').nutrition,
          rejectedFoods: { value: ['frango'], sources: [] },
        },
      };
      const result = await s.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'preference-no-retry',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: context,
      });
      expect(result).toMatchObject({
        status: 'COMPLETED',
        content: 'Que alimentos você tem disponíveis para uma alternativa?',
        observability: {
          fallbackReason: 'NUTRITION_ADVICE_REJECTED_FOOD',
          nutritionAdviceRetryAttempted: false,
        },
      });
      expect(s.ai.runTextJob).toHaveBeenCalledTimes(
        status === AIJobStatus.PENDING ? 1 : 0,
      );
      expect(s.ai.completeJobInTransaction).not.toHaveBeenCalled();
    },
  );

  it('derives compatible food evidence from the plan and preferences using the public food safety policy', () => {
    const context = {
      ...human('Me dê uma dica alternativa de jantar para hoje?'),
      nutrition: {
        ...human('').nutrition,
        rejectedFoods: { value: ['tomate', 'beterraba'], sources: [] },
        preferredFoods: {
          value: ['Arroz', 'Feijão', 'Iogurte sem lactose', 'Amendoim'],
          sources: [],
        },
      },
      restrictions: { value: ['MILK', 'PEANUT'], sources: [] },
    };
    const plan: PublicNutritionResponse = {
      ...publicPlan,
      days: [
        {
          meals: [
            {
              name: 'Jantar',
              items: [
                { name: 'Arroz', quantity: '1 porção' },
                { name: 'Tomate', quantity: '1 unidade' },
                { name: 'Beterraba', quantity: '1 unidade' },
                { name: 'Iogurte sem lactose', quantity: '1 pote' },
              ],
            },
          ],
        },
      ],
    };
    const advice = nutritionAdviceContext(
      context,
      null,
      plan,
      null,
      new Date(),
    );
    expect(advice?.compatibleFoods).toEqual([
      { name: 'Arroz', source: 'CURRENT_PLAN' },
      { name: 'Feijão', source: 'PROFILE_PREFERENCE' },
    ]);
    expect(advice?.excludedFoods).toEqual(['tomate', 'beterraba']);
    expect(advice?.safetyConstraints).toEqual(['MILK', 'PEANUT']);
  });

  it('does not certify food candidates when dietary safety is conflicted', () => {
    const context = {
      ...human('Me sugira um jantar'),
      nutrition: {
        ...human('').nutrition,
        preferredFoods: { value: ['Arroz'], sources: [] },
      },
    };
    const advice = nutritionAdviceContext(
      context,
      {
        nutrition: { dietaryPattern: { status: 'CONFLICTED', value: 'VEGAN' } },
      },
      null,
      null,
      new Date(),
    );
    expect(advice).toMatchObject({
      unresolvedSafety: true,
      compatibleFoods: [],
    });
  });
  it.each([
    ['Não tenho frango, o que uso no lugar?', 'OFF_PLAN_ADVICE'],
    ['O que posso comer no lugar do frango no almoço?', 'OFF_PLAN_ADVICE'],
    ['Me sugere um jantar diferente hoje?', undefined],
  ] as const)(
    'publishes free contextual advice without a registered swap: %s',
    async (message, purpose) => {
      const answer =
        'Pode usar lentilhas com legumes como uma ideia aproximada para essa refeição. Ajuste ao seu apetite; isso não confirma uma troca nem uma porção equivalente da dieta.';
      const subject = createSubject(
        substitutionAnswer(answer),
        AIJobStatus.PENDING,
        true,
      );
      subject.currentNutrition.read.mockResolvedValue({
        status: 'AVAILABLE',
        plan: substitutionPlan(),
      });
      expect(nutritionRequest(message)?.substitutionPurpose).toBe(purpose);
      const result = await subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'free-advice',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human(message),
      });
      expect(result).toMatchObject({
        status: 'COMPLETED',
        content: answer,
        observability: { answerSource: 'AI' },
      });
      const saved = subject.ai.completeJobInTransaction.mock.calls[0][1].result;
      expect(saved.answer).toBe(answer);
      expect(saved).not.toHaveProperty('nutritionDecisionFingerprint');
    },
  );
  it.each(['ANSWER', 'CLARIFY'] as const)(
    'keeps safety and read-only boundaries in free advice: %s',
    (disposition) => {
      const context = nutritionAdviceContext(
        human('Não tenho frango, o que uso no lugar?'),
        null,
        substitutionPlan(),
        null,
        new Date('2026-10-08T12:00:00Z'),
      );
      if (!context) throw new Error('Expected nutrition advice context');
      for (const [answer, violation] of [
        [
          'Atualizei seu plano com lentilhas.',
          'NUTRITION_ADVICE_FALSE_MUTATION',
        ],
        [
          'Lentilhas são exatamente a mesma proteína.',
          'NUTRITION_SUBSTITUTION_UNSUPPORTED_EQUIVALENCE',
        ],
        [
          'A troca está cadastrada na dieta.',
          'NUTRITION_SUBSTITUTION_UNSUPPORTED_PLAN_CLAIM',
        ],
        ['Uma opção é pasta de amendoim.', 'NUTRITION_ADVICE_UNSAFE_FOOD'],
      ] as const) {
        expect(
          nutritionAdviceViolation(
            { ...context, safetyConstraints: ['PEANUT'] },
            {
              disposition,
              domain: 'NUTRITION',
              answer: disposition === 'ANSWER' ? answer : null,
              followUpQuestion: disposition === 'CLARIFY' ? answer : null,
              grounding: 'MIXED',
              confidence: 'HIGH',
            },
            true,
          ),
        ).toBe(violation);
      }
    },
  );
  it.each([AIJobStatus.PENDING, AIJobStatus.COMPLETED, AIJobStatus.PROCESSING])(
    'vetoes opposite-domain answers on fresh and reused QA jobs: %s',
    async (status) => {
      for (const [message, domain] of [
        ['Quantas calorias preciso amanhã?', 'WORKOUT'],
        ['Como meu treino contribui para minha evolução?', 'NUTRITION'],
      ] as const) {
        const subject = createSubject(
          {
            disposition: 'ANSWER',
            domain,
            answer: 'Resposta de outro assunto.',
            followUpQuestion: null,
            grounding: 'GENERAL_KNOWLEDGE',
            confidence: 'HIGH',
          },
          status,
        );
        const result = await subject.service.execute({
          userId: 'user-id',
          conversationId: 'conversation-id',
          messageId: 'domain-guard',
          route: route('ANSWER_MESSAGE'),
          humanContext: human(message),
        });
        expect(result).toMatchObject({
          status: 'FAILED',
          reason: 'ANSWER_DOMAIN_MISMATCH',
        });
        expect(subject.ai.completeJobInTransaction).not.toHaveBeenCalled();
      }
    },
  );
  function substitutionPlan(registered = false): PublicNutritionResponse {
    return {
      ...publicPlan,
      days: [
        {
          meals: [
            {
              name: 'Café da manhã',
              time: '08:00',
              items: [{ name: 'Ovos mexidos', quantity: '2 unidades' }],
            },
            {
              name: 'Almoço',
              time: '12:00',
              items: [
                { name: 'Arroz', quantity: '4 colheres' },
                { name: 'Feijão', quantity: '1 concha' },
                { name: 'Filé de frango', quantity: '120 g' },
                { name: 'Salada', quantity: '1 prato' },
              ],
            },
          ],
        },
      ],
      substitutions: registered
        ? [{ source: 'Filé de frango', alternative: 'Ovos mexidos' }]
        : [],
    };
  }
  function substitutionAnswer(
    answer: string,
    grounding: 'CURRENT_PLAN' | 'MIXED' = 'MIXED',
  ) {
    return {
      disposition: 'ANSWER',
      domain: 'NUTRITION',
      answer,
      followUpQuestion: null,
      grounding,
      confidence: 'HIGH',
    };
  }
  it.each([
    [
      true,
      'Conferi seu almoço: a troca do filé de frango por ovos mexidos consta no plano. O registro não informa uma porção equivalente.',
    ],
    [
      false,
      'Essa combinação não consta entre as trocas do seu almoço. Então não consigo confirmá-la como parte da dieta; uma ideia fora do plano seria apenas aproximada.',
    ],
  ] as const)(
    'publishes a semantically verified natural realization, with durable replay and usage: registered=%s',
    async (registered, answer) => {
      const gateway = {
        createTextResponse: jest.fn().mockResolvedValue({
          responseId: 'verification-response',
          model: 'model',
          promptTokens: 8,
          completionTokens: 2,
          totalTokens: 10,
          outputText: JSON.stringify({
            status: registered ? 'REGISTERED' : 'NOT_REGISTERED',
            meaningPreserved: true,
          }),
        }),
      };
      const subject = createSubject(
        substitutionAnswer(answer, 'CURRENT_PLAN'),
        AIJobStatus.PENDING,
        true,
        undefined,
        gateway as unknown as OpenAIGateway,
      );
      subject.currentNutrition.read.mockResolvedValue({
        status: 'AVAILABLE',
        plan: substitutionPlan(registered),
      });
      const input = {
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'natural-swap',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human(informalSubstitution),
      };
      const result = await subject.service.execute(input);
      expect(result).toMatchObject({
        status: 'COMPLETED',
        content: answer,
        observability: { answerSource: 'AI', totalTokens: 40 },
      });
      expect(gateway.createTextResponse).toHaveBeenCalledTimes(1);
      expect(gateway.createTextResponse.mock.calls[0][0]).toMatchObject({
        requestId: 'job-id:nutrition-decision-verification:1',
      });
      const saved = subject.ai.completeJobInTransaction.mock.calls[0][1].result;
      subject.ai.createJob.mockResolvedValue({
        id: 'job-id',
        userId: 'user-id',
        status: AIJobStatus.COMPLETED,
        result: saved,
        promptVersion: { prompt: 'Existing QA instructions' },
      });
      expect(await subject.service.execute(input)).toMatchObject({
        status: 'COMPLETED',
        content: answer,
        observability: { answerSource: 'AI_REUSED' },
      });
      expect(subject.ai.runTextJob).toHaveBeenCalledTimes(1);
      expect(gateway.createTextResponse).toHaveBeenCalledTimes(1);
      // A changed decision or altered public text cannot reuse the old receipt.
      subject.currentNutrition.read.mockResolvedValue({
        status: 'AVAILABLE',
        plan: substitutionPlan(!registered),
      });
      const changed = await subject.service.execute(input);
      expect(changed).toMatchObject({
        status: 'COMPLETED',
        observability: { answerSource: 'DETERMINISTIC_FALLBACK' },
      });
      expect(changed.status === 'COMPLETED' && changed.content).not.toBe(
        answer,
      );
    },
  );

  it.each([
    ['ANSWER', false],
    ['CLARIFY', false],
    ['ANSWER', true],
    ['CLARIFY', true],
  ] as const)(
    'keeps domain contradictions blocked despite verifier verdict: %s / %s',
    async (disposition, meaningPreserved) => {
      const gateway = {
        createTextResponse: jest.fn().mockResolvedValue({
          outputText: JSON.stringify({
            status: 'NOT_REGISTERED',
            meaningPreserved,
          }),
          promptTokens: 8,
          completionTokens: 2,
          totalTokens: 10,
        }),
      };
      const subject = createSubject(
        {
          ...substitutionAnswer(
            'Não está cadastrada no seu plano, mas dá sim pra trocar o frango por ovos.',
            'CURRENT_PLAN',
          ),
          disposition,
        },
        AIJobStatus.PENDING,
        true,
        undefined,
        gateway as unknown as OpenAIGateway,
      );
      subject.currentNutrition.read.mockResolvedValue({
        status: 'AVAILABLE',
        plan: substitutionPlan(),
      });
      expect(
        nutritionAdviceViolation(
          nutritionAdviceContext(
            human(informalSubstitution),
            null,
            substitutionPlan(),
            null,
            new Date('2026-10-08T12:00:00Z'),
          ),
          {
            ...substitutionAnswer(
              'Não está cadastrada no seu plano, mas dá sim pra trocar o frango por ovos.',
              'CURRENT_PLAN',
            ),
            disposition,
            domain: 'NUTRITION',
            grounding: 'CURRENT_PLAN',
            confidence: 'HIGH',
          },
          true,
        ),
      ).toBe('NUTRITION_SUBSTITUTION_UNSUPPORTED_PLAN_CLAIM');
      const result = await subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'semantic-refusal',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human(informalSubstitution),
      });
      expect(result).toMatchObject({
        status: 'COMPLETED',
        observability: { answerSource: 'DETERMINISTIC_FALLBACK' },
      });
      expect(result.status === 'COMPLETED' && result.content).not.toContain(
        'dá sim',
      );
      // A known contradiction is rejected before spending a verification call.
      expect(gateway.createTextResponse).not.toHaveBeenCalled();
    },
  );

  it('lets the model clarify only the missing role in natural language', async () => {
    const gateway = {
      createTextResponse: jest.fn().mockResolvedValue({
        outputText: JSON.stringify({
          status: 'UNRESOLVED',
          meaningPreserved: true,
        }),
        promptTokens: 8,
        completionTokens: 2,
        totalTokens: 10,
      }),
    };
    const question =
      'Você quer usar os ovos no lugar de qual alimento do almoço?';
    const subject = createSubject(
      {
        disposition: 'CLARIFY',
        domain: 'NUTRITION',
        answer: null,
        followUpQuestion: question,
        grounding: 'RECENT_CONTEXT',
        confidence: 'LOW',
      },
      AIJobStatus.PENDING,
      true,
      undefined,
      gateway as unknown as OpenAIGateway,
    );
    subject.currentNutrition.read.mockResolvedValue({
      status: 'AVAILABLE',
      plan: substitutionPlan(),
    });
    expect(
      await subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'missing-role',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human('Posso substituir por ovos no almoço?'),
      }),
    ).toMatchObject({
      status: 'COMPLETED',
      content: question,
      observability: { answerSource: 'AI' },
    });
  });
  it.each([
    ['ANSWER', AIJobStatus.PENDING],
    ['CLARIFY', AIJobStatus.PENDING],
    ['ANSWER', AIJobStatus.COMPLETED],
    ['CLARIFY', AIJobStatus.COMPLETED],
    ['ANSWER', AIJobStatus.PROCESSING],
    ['CLARIFY', AIJobStatus.PROCESSING],
  ])(
    'publishes domain facts instead of contradictory AI approval: %s / %s',
    async (disposition, status) => {
      const contradictory =
        'Não está cadastrada no seu plano, mas dá sim pra trocar o frango por ovos.';
      const candidate = {
        ...substitutionAnswer(contradictory),
        disposition,
        followUpQuestion: disposition === 'CLARIFY' ? 'Quer trocar?' : null,
      };
      expect(
        nutritionAdviceViolation(
          nutritionAdviceContext(
            human(informalSubstitution),
            null,
            substitutionPlan(),
            null,
            new Date('2026-10-08T12:00:00.000Z'),
          ),
          {
            disposition: disposition === 'CLARIFY' ? 'CLARIFY' : 'ANSWER',
            domain: 'NUTRITION',
            answer: contradictory,
            followUpQuestion: candidate.followUpQuestion,
            grounding: 'MIXED',
            confidence: 'HIGH',
          },
        ),
      ).toBe('NUTRITION_SUBSTITUTION_UNSUPPORTED_PLAN_CLAIM');
      const subject = createSubject(candidate, status, true);
      subject.currentNutrition.read.mockResolvedValue({
        status: 'AVAILABLE',
        plan: substitutionPlan(),
      });
      const result = await subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'contradictory-substitution',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human(informalSubstitution),
      });
      expect(result).toMatchObject({
        status: 'COMPLETED',
        observability: { answerSource: 'DETERMINISTIC_FALLBACK' },
      });
      if (result.status !== 'COMPLETED')
        throw new Error('Expected factual answer');
      expect(result.content).toContain(
        'Não há essa troca cadastrada para Filé de frango em Almoço',
      );
      expect(result.content).toContain(
        'Não posso confirmar essa substituição como parte da sua dieta',
      );
      expect(result.content).not.toContain('dá sim');
      expect(result.content).not.toContain('Quer trocar?');
      if (status === AIJobStatus.PENDING) {
        expect(subject.ai.completeJobInTransaction).toHaveBeenCalledWith(
          expect.objectContaining({}),
          expect.objectContaining({
            result: expect.objectContaining({ answer: result.content }),
          }),
        );
      }
    },
  );
  it.each(['ANSWER', 'CLARIFY'])(
    'never confirms an unresolved swap from AI prose: %s',
    async (disposition) => {
      const subject = createSubject(
        {
          ...substitutionAnswer(
            'Não está cadastrada no seu plano, mas dá sim pra trocar o frango por ovos.',
          ),
          disposition,
          followUpQuestion: null,
        },
        AIJobStatus.PENDING,
        true,
      );
      subject.currentNutrition.read.mockResolvedValue({
        status: 'AVAILABLE',
        plan: substitutionPlan(),
      });
      const result = await subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'unresolved-contradiction',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human('No almoço posso substituir isso?'),
      });
      expect(result).toMatchObject({
        status: 'COMPLETED',
        observability: {
          disposition: 'CLARIFY',
          answerSource: 'DETERMINISTIC_FALLBACK',
        },
      });
      if (result.status !== 'COMPLETED')
        throw new Error('Expected clarification');
      expect(result.content).toContain(
        'qual é o original e qual é a alternativa',
      );
      expect(result.content).not.toContain('dá sim');
    },
  );
  it.each([
    ['No almoço posso trocar o frango por ovos?', 'REGISTERED'],
    ['Posso comer ovo no lugar do frango no almoço?', 'REGISTERED'],
    ['Posso usar OVOS em vez do FRANGO no ALMOÇO?', 'REGISTERED'],
    ['No almoço posso trocar o frango por ovos e bacon?', 'NOT_REGISTERED'],
    ['Posso comer ovo e bacon no lugar do frango no almoço?', 'NOT_REGISTERED'],
    ['No almoço posso trocar o frango e bacon por ovos?', 'NOT_REGISTERED'],
    ['Posso comer ovos fritos no lugar do frango no almoço?', 'NOT_REGISTERED'],
  ])(
    'matches the complete requested pair and publishes its actual status: %s',
    async (message, status) => {
      const subject = createSubject(
        substitutionAnswer('Pode sim, essa troca está cadastrada.'),
        AIJobStatus.PENDING,
        true,
      );
      subject.currentNutrition.read.mockResolvedValue({
        status: 'AVAILABLE',
        plan: substitutionPlan(true),
      });
      const result = await subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'complete-pair',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human(message),
      });
      expect(result).toMatchObject({ status: 'COMPLETED' });
      if (result.status !== 'COMPLETED')
        throw new Error('Expected domain decision');
      if (status === 'REGISTERED') {
        expect(result.content).toContain(
          'o plano registra a troca de Filé de frango por Ovos mexidos',
        );
        expect(result.content).not.toContain('?');
      } else {
        expect(result.content).toContain('Não há essa troca cadastrada');
        expect(result.content).not.toContain('o plano registra a troca');
      }
      const payload = JSON.parse(
        subject.ai.runTextJob.mock.calls[0][1].input as string,
      ) as {
        nutritionGuidance: {
          substitutionEvidence: { status: string; registered: unknown[] };
        };
      };
      expect(payload.nutritionGuidance.substitutionEvidence.status).toBe(
        status,
      );
      if (status === 'NOT_REGISTERED')
        expect(
          payload.nutritionGuidance.substitutionEvidence.registered,
        ).toEqual([]);
    },
  );
  it.each([
    [
      'Posso comer no lugar do frango no almoço?',
      'Qual alimento você quer usar como alternativa?',
    ],
    [
      'Posso comer ovo no lugar de algo no almoço?',
      'Qual é o alimento original dessa troca?',
    ],
  ])('clarifies only the missing role: %s', async (message, question) => {
    const subject = createSubject(
      substitutionAnswer('Essa troca está cadastrada.'),
      AIJobStatus.PENDING,
      true,
    );
    subject.currentNutrition.read.mockResolvedValue({
      status: 'AVAILABLE',
      plan: substitutionPlan(true),
    });
    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'missing-role',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human(message),
      }),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      content: question,
      observability: { disposition: 'CLARIFY' },
    });
  });
  it.each([
    ['Posso comer ovo no lugar do frango no almoço?', 'NOT_REGISTERED'],
    ['Posso comer ovo e bacon no lugar do frango no almoço?', 'REGISTERED'],
  ])(
    'requires the entire compound alternative actually registered: %s',
    async (message, status) => {
      const plan = {
        ...substitutionPlan(),
        substitutions: [
          { source: 'Filé de frango', alternative: 'Ovos mexidos e bacon' },
        ],
      };
      const subject = createSubject(
        substitutionAnswer('Pode sim.'),
        AIJobStatus.PENDING,
        true,
      );
      subject.currentNutrition.read.mockResolvedValue({
        status: 'AVAILABLE',
        plan,
      });
      const result = await subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'compound-record',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human(message),
      });
      expect(result).toMatchObject({ status: 'COMPLETED' });
      if (result.status !== 'COMPLETED')
        throw new Error('Expected domain decision');
      expect(result.content).toContain(
        status === 'REGISTERED'
          ? 'o plano registra a troca de Filé de frango por Ovos mexidos e bacon'
          : 'Não há essa troca cadastrada',
      );
    },
  );
  it('asks only for the meal when the same original food belongs to multiple meals', async () => {
    const plan = substitutionPlan(true);
    const multipleMeals = {
      ...plan,
      days: [
        {
          meals: [
            ...plan.days[0].meals,
            {
              name: 'Jantar',
              items: [{ name: 'Filé de frango', quantity: '120 g' }],
            },
          ],
        },
      ],
    };
    const subject = createSubject(
      substitutionAnswer('Pode sim.'),
      AIJobStatus.PENDING,
      true,
    );
    subject.currentNutrition.read.mockResolvedValue({
      status: 'AVAILABLE',
      plan: multipleMeals,
    });
    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'missing-meal',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human('Posso comer ovo no lugar do frango?'),
      }),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      content: 'Em qual refeição você quer conferir essa troca?',
    });
  });
  it('preserves the inverse relation through an elliptical follow-up', async () => {
    const subject = createSubject(
      substitutionAnswer('Pode sim.'),
      AIJobStatus.PENDING,
      true,
    );
    subject.currentNutrition.read.mockResolvedValue({
      status: 'AVAILABLE',
      plan: substitutionPlan(true),
    });
    const result = await subject.service.execute({
      userId: 'user-id',
      conversationId: 'conversation-id',
      messageId: 'inverse-follow-up',
      route: route('NUTRITION_GUIDANCE'),
      humanContext: human('E essa troca?', [
        {
          direction: 'USER',
          text: 'Posso comer ovo no lugar do frango no almoço?',
        },
        {
          direction: 'COACH',
          text: 'A troca de frango por ovos está cadastrada para o almoço.',
        },
      ]),
    });
    expect(result).toMatchObject({
      status: 'COMPLETED',
      content: expect.stringContaining(
        'o plano registra a troca de Filé de frango por Ovos mexidos',
      ),
    });
  });
  it('does not infer a preparation alias when the actual plan contains distinct egg identities', async () => {
    const plan = substitutionPlan(true);
    const ambiguous = {
      ...plan,
      days: [
        {
          meals: [
            ...plan.days[0].meals,
            {
              name: 'Jantar',
              items: [{ name: 'Ovos cozidos', quantity: '2 unidades' }],
            },
          ],
        },
      ],
    };
    const subject = createSubject(
      substitutionAnswer('Essa troca está cadastrada.'),
      AIJobStatus.PENDING,
      true,
    );
    subject.currentNutrition.read.mockResolvedValue({
      status: 'AVAILABLE',
      plan: ambiguous,
    });
    const result = await subject.service.execute({
      userId: 'user-id',
      conversationId: 'conversation-id',
      messageId: 'ambiguous-name',
      route: route('NUTRITION_GUIDANCE'),
      humanContext: human('Posso comer ovo no lugar do frango no almoço?'),
    });
    expect(result).toMatchObject({
      status: 'COMPLETED',
      observability: { disposition: 'CLARIFY' },
    });
    if (result.status !== 'COMPLETED')
      throw new Error('Expected clarification');
    expect(result.content).toContain(
      'Qual é a preparação ou o nome completo de ovo',
    );
    expect(result.content).not.toContain('qual é o original');
  });
  it('keeps the full informal sequence grounded in lunch, without turning an absent swap into a portion', async () => {
    const first = substitutionAnswer(
      'Essa troca não está cadastrada na sua dieta atual para o almoço.',
      'CURRENT_PLAN',
    );
    const second = substitutionAnswer(
      'A troca continua fora do plano. Como orientação aproximada, ovos podem ser uma alternativa, mas não tenho uma porção equivalente registrada.',
    );
    const subject = createSubject(first, AIJobStatus.PENDING, true);
    subject.currentNutrition.read.mockResolvedValue({
      status: 'AVAILABLE',
      plan: substitutionPlan(),
    });
    subject.ai.runTextJob
      .mockResolvedValueOnce({
        outputText: JSON.stringify(first),
        model: 'controlled',
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
        responseId: 'first',
      })
      .mockResolvedValueOnce({
        outputText: JSON.stringify(second),
        model: 'controlled',
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
        responseId: 'second',
      });
    const request = {
      userId: 'user-id',
      conversationId: 'conversation-id',
      messageId: 'first',
      route: route('NUTRITION_GUIDANCE'),
    };
    const lookup = await subject.service.execute({
      ...request,
      humanContext: human('Qual meu almoço?'),
    });
    expect(lookup).toMatchObject({
      status: 'COMPLETED',
      observability: { answerSource: 'DETERMINISTIC_FALLBACK' },
    });
    expect(subject.ai.createJob).not.toHaveBeenCalled();
    const history: NonNullable<
      CoachConversationHumanContext['recentConversation']
    > = [
      { direction: 'USER', text: 'Qual meu almoço?' },
      {
        direction: 'COACH',
        text: lookup.status === 'COMPLETED' ? lookup.content : '',
      },
    ];
    const firstResult = await subject.service.execute({
      ...request,
      humanContext: human(substitutionQuestion, history),
    });
    expect(firstResult).toMatchObject({
      status: 'COMPLETED',
      observability: { answerSource: 'DETERMINISTIC_FALLBACK' },
    });
    if (firstResult.status !== 'COMPLETED')
      throw new Error('Expected domain facts');
    expect(firstResult.content).toContain(
      'Não há essa troca cadastrada para Filé de frango em Almoço',
    );
    const publicFirst = firstResult.content;
    const subsequent: CoachConversationHumanContext = {
      ...human(informalSubstitution, [
        ...history,
        { direction: 'USER', text: substitutionQuestion },
        { direction: 'COACH', text: publicFirst },
      ]),
      currentReadOnlyReferent: {
        source: 'DELIVERED_QA',
        sourceMessageId: request.messageId,
        domain: 'NUTRITION',
        nutrition: null,
        previousAnswer: publicFirst,
        followUpQuestion: null,
        deliveredAt: '2026-10-08T12:00:00.000Z',
      },
    };
    await expect(
      subject.service.execute({
        ...request,
        messageId: 'second',
        humanContext: subsequent,
        previousAnswer: publicFirst,
      }),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      content: publicFirst,
      observability: { answerSource: 'DETERMINISTIC_FALLBACK' },
    });
    expect(subject.ai.runTextJob).toHaveBeenCalledTimes(2);
    const payload = JSON.parse(
      subject.ai.runTextJob.mock.calls[1][1].input as string,
    ) as {
      nutritionGuidance: {
        substitutionEvidence: { status: string; source: string; meal: string };
        recentSuggestions: string[];
      };
    };
    expect(payload.nutritionGuidance.substitutionEvidence).toMatchObject({
      status: 'NOT_REGISTERED',
      source: 'Filé de frango',
      meal: 'almoco',
    });
    expect(payload.nutritionGuidance.recentSuggestions).toContain(publicFirst);
    subject.ai.createJob.mockResolvedValueOnce({
      id: 'job-id',
      userId: 'user-id',
      status: AIJobStatus.COMPLETED,
      result: second,
      promptVersion: { prompt: 'Existing QA instructions' },
    });
    await expect(
      subject.service.execute({
        ...request,
        messageId: 'second',
        humanContext: subsequent,
        previousAnswer: publicFirst,
      }),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      observability: { answerSource: 'DETERMINISTIC_FALLBACK' },
    });
    expect(subject.ai.runTextJob).toHaveBeenCalledTimes(2);
    expect(subject.ai.createJob).toHaveBeenCalledWith(
      expect.objectContaining({ type: AIJobType.TEXT }),
    );
    expect(subject.ai.completeJobInTransaction).toHaveBeenCalledTimes(2);
  });
  it('answers a registered pair from the real substitution records without inventing quantities', async () => {
    const answer =
      'Essa troca está cadastrada no seu plano: filé de frango por ovos mexidos. Não há uma porção da alternativa registrada.';
    const subject = createSubject(
      substitutionAnswer(answer, 'CURRENT_PLAN'),
      AIJobStatus.PENDING,
      true,
    );
    subject.currentNutrition.read.mockResolvedValue({
      status: 'AVAILABLE',
      plan: substitutionPlan(true),
    });
    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human(substitutionQuestion),
      }),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      content: expect.stringContaining(
        'o plano registra a troca de Filé de frango por Ovos mexidos',
      ),
    });
  });
  it.each([
    [
      'Pode sim, use 3 ovos no lugar do frango.',
      'NUTRITION_SUBSTITUTION_MISSING_GROUNDING',
    ],
    [
      'Como orientação aproximada fora do plano, use 3 ovos no lugar do frango.',
      'NUTRITION_SUBSTITUTION_UNSUPPORTED_PORTION',
    ],
    [
      'Como orientação aproximada fora do plano, use três ovos.',
      'NUTRITION_SUBSTITUTION_UNSUPPORTED_PORTION',
    ],
    [
      'Como orientação aproximada fora do plano, ovos têm exatamente a mesma proteína do frango.',
      'NUTRITION_SUBSTITUTION_UNSUPPORTED_EQUIVALENCE',
    ],
    [
      'Essa troca está prevista na sua dieta.',
      'NUTRITION_SUBSTITUTION_UNSUPPORTED_PLAN_CLAIM',
    ],
  ])(
    'discards unsupported prose and publishes domain facts: %s',
    async (answer, reason) => {
      const subject = createSubject(
        substitutionAnswer(answer),
        AIJobStatus.PENDING,
        true,
      );
      subject.currentNutrition.read.mockResolvedValue({
        status: 'AVAILABLE',
        plan: substitutionPlan(),
      });
      expect(
        nutritionAdviceViolation(
          nutritionAdviceContext(
            human(informalSubstitution),
            null,
            substitutionPlan(),
            null,
            new Date('2026-10-08T12:00:00.000Z'),
          ),
          {
            disposition: 'ANSWER',
            domain: 'NUTRITION',
            answer,
            followUpQuestion: null,
            grounding: 'MIXED',
            confidence: 'HIGH',
          },
        ),
      ).toBe(reason);
      const result = await subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human(informalSubstitution),
      });
      expect(result).toMatchObject({ status: 'COMPLETED' });
      if (result.status !== 'COMPLETED')
        throw new Error('Expected domain facts');
      expect(result.content).toContain('Não há essa troca cadastrada');
      expect(result.content).not.toContain(answer);
      expect(subject.ai.completeJobInTransaction).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    [
      'No almoço, posso comer ovos no lugar de frango?',
      'ANSWER',
      'NOT_REGISTERED',
    ],
    [
      'No almoço, posso comer ovos no lugar de frango?',
      'CLARIFY',
      'NOT_REGISTERED',
    ],
    ['No almoço, posso substituir isso?', 'ANSWER', 'UNRESOLVED'],
    ['No almoço, posso substituir isso?', 'CLARIFY', 'UNRESOLVED'],
    ['No almoço, posso trocar o frango?', 'ANSWER', 'UNRESOLVED'],
  ])(
    'blocks invented portions without lexical roles: %s / %s',
    async (message, disposition, evidenceStatus) => {
      const subject = createSubject(
        {
          ...substitutionAnswer(
            'Como orientação aproximada fora do plano, use 3 ovos.',
          ),
          disposition,
          followUpQuestion: disposition === 'CLARIFY' ? 'Qual alimento?' : null,
        },
        AIJobStatus.PENDING,
        true,
      );
      subject.currentNutrition.read.mockResolvedValue({
        status: 'AVAILABLE',
        plan: substitutionPlan(),
      });
      const result = await subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'unresolved-portion',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human(message),
      });
      expect(result).toMatchObject({
        status: 'COMPLETED',
        observability: {
          disposition: evidenceStatus === 'UNRESOLVED' ? 'CLARIFY' : 'ANSWER',
        },
      });
      if (result.status !== 'COMPLETED')
        throw new Error('Expected clarification');
      expect(result.content).not.toContain('3 ovos');
      expect(result.content).not.toContain('use');
      const payload = JSON.parse(
        subject.ai.runTextJob.mock.calls[0][1].input as string,
      ) as {
        nutritionGuidance: {
          substitutionEvidence: { status: string; registered: unknown[] };
        };
      };
      expect(payload.nutritionGuidance.substitutionEvidence).toMatchObject({
        status: evidenceStatus,
        registered: [],
      });
      expect(subject.ai.completeJobInTransaction).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    ['Qual alimento você quer substituir?', 'CLARIFY'],
    [
      'Como orientação aproximada fora do plano, ovos podem ser uma alternativa, sem equivalência confirmada.',
      'ANSWER',
    ],
  ])(
    'preserves safe public decisions for natural swap wording: %s',
    async (answer, disposition) => {
      const subject = createSubject(
        {
          ...substitutionAnswer(answer),
          disposition,
          followUpQuestion: disposition === 'CLARIFY' ? 'Qual alimento?' : null,
        },
        AIJobStatus.PENDING,
        true,
      );
      subject.currentNutrition.read.mockResolvedValue({
        status: 'AVAILABLE',
        plan: substitutionPlan(),
      });
      await expect(
        subject.service.execute({
          userId: 'user-id',
          conversationId: 'conversation-id',
          messageId: 'unresolved-safe',
          route: route('NUTRITION_GUIDANCE'),
          humanContext: human('No almoço posso comer ovos no lugar de frango?'),
        }),
      ).resolves.toMatchObject({ status: 'COMPLETED' });
    },
  );
  it.each([
    'Essa troca está cadastrada na sua dieta.',
    'Como orientação aproximada, ovos fornecem exatamente a mesma proteína.',
    'Como orientação aproximada fora do plano, use 3 ovos.',
    'Como orientação aproximada fora do plano, prepare 3 omeletes.',
  ])('checks unsafe claims in clarification text: %s', async (answer) => {
    const subject = createSubject(
      {
        ...substitutionAnswer(answer),
        disposition: 'CLARIFY',
        followUpQuestion: 'Qual alimento?',
      },
      AIJobStatus.PENDING,
      true,
    );
    subject.currentNutrition.read.mockResolvedValue({
      status: 'AVAILABLE',
      plan: substitutionPlan(true),
    });
    const result = await subject.service.execute({
      userId: 'user-id',
      conversationId: 'conversation-id',
      messageId: 'unresolved-claim',
      route: route('NUTRITION_GUIDANCE'),
      humanContext: human('No almoço posso substituir isso?'),
    });
    expect(result).toMatchObject({
      status: 'COMPLETED',
      observability: { disposition: 'CLARIFY' },
    });
    if (result.status !== 'COMPLETED')
      throw new Error('Expected clarification');
    expect(result.content).not.toContain(answer);
    expect(subject.ai.completeJobInTransaction).toHaveBeenCalledTimes(1);
  });
  it('resolves an elliptical swap from the owned conversational history, preserving lunch and the earlier denial', async () => {
    const previous = 'Essa troca não está cadastrada no plano.';
    const subject = createSubject(
      substitutionAnswer(
        'Não está cadastrada. Como orientação aproximada fora do plano, ovos podem ser uma alternativa sem porção equivalente confirmada.',
      ),
      AIJobStatus.PENDING,
      true,
    );
    subject.currentNutrition.read.mockResolvedValue({
      status: 'AVAILABLE',
      plan: substitutionPlan(),
    });
    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'ellipse',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human('E essa troca então?', [
          { direction: 'USER', text: substitutionQuestion },
          { direction: 'COACH', text: previous },
        ]),
      }),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
    const payload = JSON.parse(
      subject.ai.runTextJob.mock.calls[0][1].input as string,
    ) as {
      nutritionGuidance: {
        meal: string;
        substitutionEvidence: { status: string; source: string };
      };
    };
    expect(payload.nutritionGuidance).toMatchObject({
      meal: 'almoco',
      substitutionEvidence: {
        status: 'NOT_REGISTERED',
        source: 'Filé de frango',
      },
    });
  });
  it('keeps unknown source evidence unresolved instead of claiming plan authorization', async () => {
    const subject = createSubject(
      substitutionAnswer(
        'Essa troca está prevista na sua dieta.',
        'CURRENT_PLAN',
      ),
      AIJobStatus.PENDING,
      true,
    );
    subject.currentNutrition.read.mockResolvedValue({
      status: 'AVAILABLE',
      plan: substitutionPlan(),
    });
    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'unknown',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human('No almoço posso trocar atum por ovos?'),
      }),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      content: 'Qual é o alimento original dessa troca?',
      observability: { disposition: 'CLARIFY' },
    });
  });
  it('does not waive egg allergy for a registered substitution', async () => {
    const subject = createSubject(
      substitutionAnswer('Essa troca está cadastrada: frango por ovos.'),
      AIJobStatus.PENDING,
      true,
    );
    subject.currentNutrition.read.mockResolvedValue({
      status: 'AVAILABLE',
      plan: substitutionPlan(true),
    });
    const context = human(substitutionQuestion);
    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'allergy',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: {
          ...context,
          restrictions: { value: ['alergia a ovo'], sources: [] },
        },
      }),
    ).resolves.toMatchObject({
      status: 'FAILED',
      reason: 'NUTRITION_ADVICE_UNSAFE_FOOD',
    });
  });
  it('does not reuse another user job or substitution response', async () => {
    const subject = createSubject(
      substitutionAnswer('Essa troca está cadastrada.'),
      AIJobStatus.COMPLETED,
      true,
    );
    subject.ai.createJob.mockResolvedValueOnce({
      id: 'job-id',
      userId: 'other-user',
      status: AIJobStatus.COMPLETED,
      result: substitutionAnswer('Essa troca está cadastrada.'),
      promptVersion: { prompt: 'Existing QA instructions' },
    });
    subject.currentNutrition.read.mockResolvedValue({
      status: 'AVAILABLE',
      plan: substitutionPlan(),
    });
    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'owned',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human(informalSubstitution),
      }),
    ).resolves.toMatchObject({
      status: 'FAILED',
      reason: 'AI_JOB_OWNERSHIP_MISMATCH',
    });
    expect(subject.ai.runTextJob).not.toHaveBeenCalled();
    expect(subject.currentNutrition.read).toHaveBeenCalledWith('user-id');
  });
  it('prepares prompt version 2 with the compatible name and full schema wrapper', () => {
    expect(COACH_CONVERSATIONAL_QA_V1_PROMPT.version).toBe(1);
    expect(COACH_CONVERSATIONAL_QA_V2_PROMPT_SEED).toMatchObject({
      name: 'coach_conversational_qa_v1',
      version: 2,
      schema: {
        name: 'coach_conversational_qa_v1',
        schema: expect.objectContaining({ type: 'object' }),
      },
    });
  });

  const publicPlan: PublicNutritionResponse = Object.freeze({
    title: 'Seu plano alimentar',
    summary: 'Plano atual',
    goal: 'emagrecimento',
    energyTargetKcal: 2440,
    macroTargets: Object.freeze({ proteinGrams: 118 }),
    days: Object.freeze([
      Object.freeze({
        meals: Object.freeze([
          Object.freeze({
            name: 'Jantar',
            time: '20:00',
            items: Object.freeze([
              Object.freeze({ name: 'Arroz', quantity: '5 colheres' }),
            ]),
          }),
        ]),
      }),
    ]),
    substitutions: Object.freeze([
      Object.freeze({ source: 'Arroz', alternative: 'Macarrão' }),
    ]),
    hydrationGuidance: Object.freeze(['Beba água ao longo do dia.']),
    generalGuidance: Object.freeze([]),
    adaptationGuidance: Object.freeze([]),
    safetyGuidance: Object.freeze([]),
  });

  function human(
    message: string,
    recentConversation: CoachConversationHumanContext['recentConversation'] = Object.freeze(
      [],
    ),
  ): CoachConversationHumanContext {
    return {
      currentMessage: message,
      turnCue: 'COMMON',
      preferredName: null,
      goal: null,
      desiredOutcome: null,
      routine: {
        trainingTime: null,
        mealTimes: null,
        cookingAvailability: null,
        mealsAwayFromHome: null,
      },
      training: { modality: null, experience: null },
      nutrition: {
        dietaryPattern: null,
        preferredFoods: null,
        rejectedFoods: null,
      },
      restrictions: null,
      communication: {
        style: null,
        coachingStyle: null,
        tone: null,
        motivation: null,
        messagePreference: 'BALANCED',
        journeyStage: null,
      },
      memory: Object.freeze([]),
      recentConversation,
      continuity: null,
      progress: null,
      currentPlans: { diet: null, workout: null },
    };
  }

  function route(kind: 'ANSWER_MESSAGE' | 'NUTRITION_GUIDANCE') {
    return {
      kind,
      operation: 'PROVIDE_GUIDANCE',
    } as ConversationExecutionRoute;
  }

  function createSubject(
    output: object,
    status: AIJobStatus = AIJobStatus.PENDING,
    deterministicNutrition = false,
    personalized?: PersonalizedCoachContextService,
    correctionGateway?: OpenAIGateway,
  ) {
    const response = {
      responseId: 'provider-response',
      model: 'model',
      outputText: JSON.stringify(output),
      promptTokens: 20,
      completionTokens: 10,
      totalTokens: 30,
    };
    const ai = {
      createJob: jest.fn().mockResolvedValue({
        id: 'job-id',
        userId: 'user-id',
        status,
        result: status === AIJobStatus.COMPLETED ? output : null,
        promptVersion: { prompt: 'Existing QA instructions' },
      }),
      runTextJob: jest.fn().mockResolvedValue(response),
      completeJobInTransaction: jest.fn().mockResolvedValue(undefined),
      failJob: jest.fn().mockResolvedValue(undefined),
      failPendingJob: jest.fn().mockResolvedValue(undefined),
      getJob: jest.fn().mockResolvedValue({
        id: 'job-id',
        userId: 'user-id',
        status: AIJobStatus.COMPLETED,
        result: output,
      }),
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation((callback: (transaction: object) => unknown) =>
          callback({}),
        ),
    };
    const currentNutrition = {
      read: jest.fn().mockResolvedValue({
        status: 'AVAILABLE',
        plan: publicPlan,
      }),
    };
    return {
      service: new ConversationQAExecutorService(
        ai as never,
        prisma as never,
        currentNutrition as never,
        new ConversationPublicAnswerBoundaryService(),
        deterministicNutrition
          ? new ConversationNutritionDeterministicAnswerService()
          : undefined,
        personalized,
        correctionGateway,
      ),
      ai,
      prisma,
      currentNutrition,
    };
  }

  it.each([AIJobStatus.PENDING, AIJobStatus.COMPLETED, AIJobStatus.PROCESSING])(
    'validates personalized assertions before exposing fresh, stored or joined answers: %s',
    async (status) => {
      const personalized = {
        build: jest
          .fn()
          .mockResolvedValue({ policy: { noExpenditureSource: true } }),
        answer: jest.fn().mockReturnValue(null),
        validatesAnswer: jest.fn().mockReturnValue(false),
      };
      const subject = createSubject(
        {
          disposition: 'ANSWER',
          domain: 'PROGRESS',
          answer: 'Você queimou 600 kcal.',
          followUpQuestion: null,
          grounding: 'PROFILE',
          confidence: 'HIGH',
        },
        status,
        false,
        personalized as unknown as PersonalizedCoachContextService,
      );
      await expect(
        subject.service.execute({
          userId: 'user-id',
          conversationId: 'conversation-id',
          messageId: 'message-id',
          route: route('ANSWER_MESSAGE'),
          humanContext: human('Como estou indo?'),
        }),
      ).resolves.toMatchObject({
        status: 'FAILED',
        reason: 'UNSUPPORTED_PERSONAL_ASSERTION',
      });
      expect(subject.ai.completeJobInTransaction).not.toHaveBeenCalled();
      expect(personalized.validatesAnswer).toHaveBeenCalled();
    },
  );
  it('fails closed on personalized ownership failure before creating an AI job', async () => {
    const personalized = {
      build: jest.fn().mockRejectedValue(new Error('ownership')),
    };
    const subject = createSubject(
      {},
      AIJobStatus.PENDING,
      false,
      personalized as unknown as PersonalizedCoachContextService,
    );
    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('ANSWER_MESSAGE'),
        humanContext: human('Qual meu objetivo?'),
      }),
    ).resolves.toMatchObject({
      status: 'FAILED',
      reason: 'PERSONALIZED_CONTEXT_UNAVAILABLE',
    });
    expect(subject.ai.createJob).not.toHaveBeenCalled();
  });
  it('answers a confirmed profile read without the provider or any job write', async () => {
    const personalized = {
      build: jest.fn().mockResolvedValue({}),
      answer: jest.fn().mockReturnValue('Seu objetivo é emagrecimento.'),
    };
    const subject = createSubject(
      {},
      AIJobStatus.PENDING,
      false,
      personalized as unknown as PersonalizedCoachContextService,
    );
    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('ANSWER_MESSAGE'),
        humanContext: human('Qual meu objetivo?'),
      }),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      content: 'Seu objetivo é emagrecimento.',
    });
    expect(subject.ai.createJob).not.toHaveBeenCalled();
    expect(subject.ai.runTextJob).not.toHaveBeenCalled();
  });
  it('sends the authorized personal context to reasoning QA instead of unverified human history', async () => {
    const context = {
      identity: { preferredName: 'Gildacio' },
      goals: { training: 'emagrecimento' },
      training: { perceivedConditioning: 'iniciante' },
      safety: { physicalLimitations: 'joelho' },
      recentConversation: [],
    };
    const personalized = {
      build: jest.fn().mockResolvedValue(context),
      answer: jest.fn().mockReturnValue(null),
      validatesAnswer: jest.fn().mockReturnValue(true),
    };
    const subject = createSubject(
      {
        disposition: 'ANSWER',
        domain: 'WORKOUT',
        answer: 'Vamos considerar seu objetivo e suas limitações.',
        followUpQuestion: null,
        grounding: 'PROFILE',
        confidence: 'HIGH',
      },
      AIJobStatus.PENDING,
      false,
      personalized as unknown as PersonalizedCoachContextService,
    );
    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('ANSWER_MESSAGE'),
        humanContext: human('Para mim é melhor caminhar ou correr?', [
          { direction: 'USER', text: 'unverified foreign history' },
        ]),
      }),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
    const payload = JSON.parse(
      subject.ai.runTextJob.mock.calls[0][1].input,
    ) as { trustedContext: unknown };
    expect(payload.trustedContext).toEqual(context);
    expect(JSON.stringify(payload)).not.toContain('unverified foreign history');
  });

  it('answers canonical nutrition facts without creating or running an AI job', async () => {
    const subject = createSubject({}, AIJobStatus.PENDING, true);

    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human('Qual é minha meta de proteína?'),
      }),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      content: 'Sua meta diária no plano é 118 g de proteína.',
      observability: {
        answerSource: 'DETERMINISTIC_FALLBACK',
        totalTokens: 0,
      },
    });
    expect(subject.ai.createJob).not.toHaveBeenCalled();
    expect(subject.ai.runTextJob).not.toHaveBeenCalled();
  });
  it('uses one bounded authorized personalized history when the unified window is absent', async () => {
    const personalized = {
      build: jest.fn().mockResolvedValue({
        recentConversation: [
          { direction: 'INBOUND', text: 'Me dá uma ideia de jantar' },
          { direction: 'OUTBOUND', text: 'Uma opção de jantar é sopa.' },
        ],
      }),
      answer: jest.fn().mockReturnValue(null),
      validatesAnswer: jest.fn().mockReturnValue(true),
    };
    const s = createSubject(
      {
        disposition: 'ANSWER',
        domain: 'GENERAL',
        answer: 'Posso ajudar com isso.',
        followUpQuestion: null,
        grounding: 'RECENT_CONTEXT',
        confidence: 'HIGH',
      },
      AIJobStatus.PENDING,
      false,
      personalized as unknown as PersonalizedCoachContextService,
    );
    await s.service.execute({
      userId: 'user-id',
      conversationId: 'conversation-id',
      messageId: 'message-id',
      route: route('ANSWER_MESSAGE'),
      humanContext: human('Pode explicar?'),
    });
    const payload: unknown = JSON.parse(
      s.ai.runTextJob.mock.calls[0][1].input as string,
    );
    expect(payload).toMatchObject({
      trustedContext: { recentConversation: [] },
      recentConversation: [
        { direction: 'USER', text: 'Me dá uma ideia de jantar', origin: null },
        {
          direction: 'COACH',
          text: 'Uma opção de jantar é sopa.',
          origin: null,
        },
      ],
    });
    expect(
      (s.ai.runTextJob.mock.calls[0][1].input as string).split(
        'Uma opção de jantar é sopa.',
      ),
    ).toHaveLength(2);
  });

  describe('contextual meal advice', () => {
    describe('bounded corrective recovery', () => {
      const repeated = 'Iogurte natural com banana e aveia.';
      const candidate = (answer: string) => ({
        disposition: 'ANSWER',
        domain: 'NUTRITION',
        answer,
        followUpQuestion: null,
        grounding: 'MIXED',
        confidence: 'HIGH',
      });
      function recovery(
        first = repeated,
        second = 'Uma opção diferente é pão integral com frango desfiado.',
        personalized?: PersonalizedCoachContextService,
      ) {
        const gateway = {
          createTextResponse: jest.fn().mockResolvedValue({
            responseId: 'correction',
            model: 'model',
            outputText: JSON.stringify(candidate(second)),
            promptTokens: 25,
            completionTokens: 15,
            totalTokens: 40,
          }),
        };
        const subject = createSubject(
          candidate(first),
          AIJobStatus.PENDING,
          true,
          personalized,
          gateway as unknown as OpenAIGateway,
        );
        subject.currentNutrition.read.mockResolvedValue({
          status: 'AVAILABLE',
          plan: {
            ...publicPlan,
            days: [
              {
                meals: [
                  {
                    name: 'Lanche da tarde',
                    time: '16:00',
                    items: [
                      { name: 'Iogurte natural', quantity: '1 pote' },
                      { name: 'Banana', quantity: '1 unidade' },
                      { name: 'Aveia', quantity: '1 colher' },
                    ],
                  },
                ],
              },
            ],
          },
        });
        const request = {
          userId: 'user-id',
          conversationId: 'conversation-id',
          messageId: 'message-id',
          route: route('NUTRITION_GUIDANCE'),
          humanContext: human('Me dê uma dica de lanche da tarde'),
          referenceDate: new Date('2026-10-05T18:00:00Z'),
          deadlineAtMs: Date.now() + 25_000,
        };
        const stored: {
          id: string;
          userId: string;
          type: AIJobType;
          status: AIJobStatus;
          result: unknown;
          error?: string;
        } = {
          id: 'job-id',
          userId: 'user-id',
          type: AIJobType.TEXT,
          status: AIJobStatus.PROCESSING,
          result: null,
        };
        const usage = {
          recordInTransaction: jest.fn().mockResolvedValue(undefined),
        };
        const usageReservations = {
          reverseInTransaction: jest.fn().mockResolvedValue(undefined),
        };
        const transaction = {
          aIJob: {
            findUnique: jest
              .fn()
              .mockImplementation(() => Promise.resolve(stored)),
            update: jest
              .fn()
              .mockImplementation(
                (input: { data: { status: AIJobStatus; error: string } }) => {
                  Object.assign(stored, input.data);
                  return Promise.resolve(stored);
                },
              ),
          },
        };
        const failureAI = new AIService(
          {
            $transaction: (execute: (tx: object) => Promise<void>) =>
              execute(transaction),
          } as never,
          {} as never,
          gateway as unknown as OpenAIGateway,
          usage as never,
          {} as never,
          usageReservations as never,
          {} as never,
          {} as never,
        );
        subject.ai.failJob.mockImplementation(
          failureAI.failJob.bind(failureAI),
        );
        subject.ai.completeJobInTransaction.mockImplementation(
          (
            _tx: object,
            input: {
              result: unknown;
              response: {
                totalTokens: number;
                promptTokens: number;
                completionTokens: number;
              };
            },
          ) => {
            stored.status = AIJobStatus.COMPLETED;
            stored.result = input.result;
            usage.recordInTransaction(_tx, {
              aiJobId: stored.id,
              ...input.response,
            });
          },
        );
        return { ...subject, gateway, request, stored, usage, failureAI };
      }
      it('corrects the production snack copy once within the original deadline and job', async () => {
        const s = recovery();
        const result = await s.service.execute(s.request);
        expect(result).toMatchObject({
          status: 'COMPLETED',
          content: 'Uma opção diferente é pão integral com frango desfiado.',
          observability: {
            nutritionAdviceInitialViolation:
              'NUTRITION_ADVICE_REPEATS_CURRENT_MEAL',
            nutritionAdviceRetryAttempted: true,
            nutritionAdviceRetryOutcome: 'RECOVERED',
            totalTokens: 70,
          },
        });
        expect(s.gateway.createTextResponse).toHaveBeenCalledTimes(1);
        expect(s.gateway.createTextResponse.mock.calls[0][0]).toMatchObject({
          instructions: 'Existing QA instructions',
          requestId: 'job-id:nutrition-advice-correction:1',
        });
        const call = s.gateway.createTextResponse.mock.calls[0][0] as {
          input: string;
          timeoutMs: number;
        };
        expect(JSON.parse(call.input) as unknown).toMatchObject({
          nutritionAdviceCorrection: {
            originalViolation: 'NUTRITION_ADVICE_REPEATS_CURRENT_MEAL',
            correctiveAttempt: 1,
          },
        });
        expect(call.timeoutMs).toBeLessThanOrEqual(22_500);
        expect(s.ai.createJob).toHaveBeenCalledTimes(1);
        expect(s.ai.completeJobInTransaction).toHaveBeenCalledTimes(1);
        expect(s.ai.failJob).not.toHaveBeenCalled();
        expect(s.stored.status).toBe(AIJobStatus.COMPLETED);
        expect(s.ai.runTextJob).toHaveBeenCalledTimes(1);
        expect(s.usage.recordInTransaction).toHaveBeenCalledTimes(1);
      });
      it.each([
        ['Uma ideia aproximada é lentilhas com legumes.', 'RECOVERED'],
        ['Experimente frango grelhado.', 'FAILED'],
        ['Não use frango; prefira lentilhas.', 'FAILED'],
        ['Uma opção é pasta de amendoim.', 'FAILED'],
      ] as const)(
        'recovers rejected preferences once and revalidates the entire correction: %s',
        async (second, outcome) => {
          const s = recovery('Experimente frango grelhado.', second);
          s.request.humanContext = {
            ...human('Me dê uma dica alternativa de jantar para hoje?'),
            nutrition: {
              ...human('').nutrition,
              rejectedFoods: { value: ['frango'], sources: [] },
            },
            restrictions: { value: ['amendoim'], sources: [] },
          };
          const result = await s.service.execute(s.request);
          expect(result).toMatchObject({
            status: 'COMPLETED',
            content:
              outcome === 'RECOVERED'
                ? second
                : 'Que alimentos você tem disponíveis para uma alternativa?',
            observability: {
              nutritionAdviceInitialViolation: 'NUTRITION_ADVICE_REJECTED_FOOD',
              nutritionAdviceRetryAttempted: true,
              nutritionAdviceRetryOutcome: outcome,
              totalTokens: 70,
            },
          });
          expect(s.gateway.createTextResponse).toHaveBeenCalledTimes(1);
          expect(s.ai.runTextJob).toHaveBeenCalledTimes(1);
          expect(s.usage.recordInTransaction).toHaveBeenCalledTimes(1);
          expect(
            JSON.parse(s.gateway.createTextResponse.mock.calls[0][0].input),
          ).toMatchObject({
            nutritionGuidance: { excludedFoods: ['frango'] },
            nutritionAdviceCorrection: {
              originalViolation: 'NUTRITION_ADVICE_REJECTED_FOOD',
              correctiveAttempt: 1,
            },
          });
          expect(s.stored.status).toBe(
            outcome === 'RECOVERED'
              ? AIJobStatus.COMPLETED
              : AIJobStatus.FAILED,
          );
        },
      );
      it('clarifies a rejected preference if the correction provider fails, preserving first-call accounting', async () => {
        const s = recovery('Experimente frango grelhado.');
        s.request.humanContext = {
          ...human('Me dê uma dica alternativa de jantar para hoje?'),
          nutrition: {
            ...human('').nutrition,
            rejectedFoods: { value: ['frango'], sources: [] },
          },
        };
        s.gateway.createTextResponse.mockRejectedValue(
          new Error('controlled correction timeout'),
        );
        expect(await s.service.execute(s.request)).toMatchObject({
          status: 'COMPLETED',
          observability: {
            disposition: 'CLARIFY',
            fallbackReason: 'PROVIDER_EXECUTION_FAILED',
            totalTokens: 30,
          },
        });
        expect(s.gateway.createTextResponse).toHaveBeenCalledTimes(1);
        expect(s.usage.recordInTransaction).toHaveBeenCalledTimes(1);
      });
      it('clarifies safely when the only corrective candidate still repeats', async () => {
        const s = recovery(repeated, repeated);
        expect(await s.service.execute(s.request)).toMatchObject({
          status: 'COMPLETED',
          content: 'Que alimentos você tem disponíveis para uma alternativa?',
          observability: {
            disposition: 'CLARIFY',
            answerSource: 'DETERMINISTIC_FALLBACK',
            nutritionAdviceRetryOutcome: 'FAILED',
            totalTokens: 70,
          },
        });
        expect(s.gateway.createTextResponse).toHaveBeenCalledTimes(1);
        expect(s.ai.failJob).toHaveBeenCalledTimes(1);
        expect(s.ai.completeJobInTransaction).not.toHaveBeenCalled();
        expect(s.stored).toMatchObject({
          status: AIJobStatus.FAILED,
          result: null,
          error: 'NUTRITION_ADVICE_REPEATS_CURRENT_MEAL',
        });
        expect(s.usage.recordInTransaction).toHaveBeenCalledTimes(1);
        expect(s.usage.recordInTransaction).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            promptTokens: 45,
            completionTokens: 25,
            totalTokens: 70,
          }),
        );
        await s.failureAI.failJob('job-id', new Error('duplicate failure'), {
          responseId: 'duplicate',
          model: 'model',
          outputText: '',
          promptTokens: 45,
          completionTokens: 25,
          totalTokens: 70,
        });
        expect(s.usage.recordInTransaction).toHaveBeenCalledTimes(1);
      });
      it('does not call the corrective provider for an initially valid answer', async () => {
        const s = recovery('Pão integral com frango desfiado.');
        expect(await s.service.execute(s.request)).toMatchObject({
          status: 'COMPLETED',
        });
        expect(s.gateway.createTextResponse).not.toHaveBeenCalled();
        expect(s.ai.runTextJob).toHaveBeenCalledTimes(1);
        expect(s.stored.status).toBe(AIJobStatus.COMPLETED);
      });
      it('does not retry safety violations', async () => {
        const s = recovery('Uma opção é pasta de amendoim.');
        s.request.humanContext = {
          ...s.request.humanContext,
          restrictions: { value: ['amendoim'], sources: [] },
        };
        expect(await s.service.execute(s.request)).toMatchObject({
          status: 'FAILED',
        });
        expect(s.gateway.createTextResponse).not.toHaveBeenCalled();
      });
      it.each([
        ['Uma ideia aproximada é arroz refogado com feijão.', 'RECOVERED'],
        ['Uma alternativa é sopa de beterraba.', 'FAILED'],
        ['Evite tomate; prefira arroz com feijão.', 'FAILED'],
        ['Uma opção é pasta de amendoim.', 'FAILED'],
      ] as const)(
        'uses food evidence in a compact correction while preserving safety: %s',
        async (second, outcome) => {
          const plan: PublicNutritionResponse = {
            ...publicPlan,
            days: Array.from({ length: 7 }, (_, index) => ({
              label: `Dia ${index + 1}`,
              meals: [
                {
                  name: 'Jantar',
                  time: '20:00',
                  items: [
                    'Arroz',
                    'Feijão',
                    'Tomate',
                    'Beterraba',
                    'Amendoim',
                    'Iogurte sem lactose',
                  ].map((name) => ({ name, quantity: '1 porção' })),
                },
              ],
            })),
          };
          const trusted = {
            safety: {
              allergies: { status: 'KNOWN', value: ['PEANUT', 'MILK'] },
            },
            nutrition: {
              declaredFoodRejections: {
                status: 'KNOWN',
                value: ['tomate', 'beterraba'],
              },
              dietaryPattern: { status: 'KNOWN', value: 'VEGAN' },
            },
            goals: { nutrition: 'WEIGHT_LOSS' },
            routine: {
              cookingAvailability: { status: 'KNOWN', value: 'LIMITED' },
            },
            activeNutritionPlan: {
              title: plan.title,
              strategy: { objective: 'WEIGHT_LOSS' },
              days: plan.days,
            },
            activeWorkoutPlan: { title: 'Treino contextual', sessions: [] },
            recentConversation: [],
          };
          const personalized = {
            build: jest.fn().mockResolvedValue(trusted),
            answer: jest.fn().mockReturnValue(null),
            validatesAnswer: jest.fn().mockReturnValue(true),
          };
          const s = recovery(
            'Uma opção é salada de tomate.',
            second,
            personalized as unknown as PersonalizedCoachContextService,
          );
          s.request.humanContext = human(
            'Me dê uma dica alternativa de jantar para hoje?',
          );
          s.currentNutrition.read.mockResolvedValue({
            status: 'AVAILABLE',
            plan,
          });
          const before = JSON.stringify(plan);
          const result = await s.service.execute(s.request);
          expect(result).toMatchObject({
            status: 'COMPLETED',
            content:
              outcome === 'RECOVERED'
                ? second
                : 'Que alimentos você tem disponíveis para uma alternativa?',
            observability: {
              nutritionAdviceRetryAttempted: true,
              nutritionAdviceRetryOutcome: outcome,
              totalTokens: 70,
            },
          });
          expect(s.gateway.createTextResponse).toHaveBeenCalledTimes(1);
          expect(s.ai.runTextJob).toHaveBeenCalledTimes(1);
          expect(s.usage.recordInTransaction).toHaveBeenCalledTimes(1);
          expect(JSON.stringify(plan)).toBe(before);
          const firstPayload = JSON.parse(
            s.ai.runTextJob.mock.calls[0][1].input,
          );
          const corrected = JSON.parse(
            s.gateway.createTextResponse.mock.calls[0][0].input,
          );
          expect(corrected).toMatchObject({
            trustedContext: {
              safety: trusted.safety,
              nutrition: trusted.nutrition,
              goals: trusted.goals,
              routine: trusted.routine,
              activeWorkoutPlan: trusted.activeWorkoutPlan,
              activeNutritionPlan: {
                title: plan.title,
                strategy: trusted.activeNutritionPlan.strategy,
              },
            },
            nutritionGuidance: {
              excludedFoods: ['tomate', 'beterraba'],
              safetyConstraints: expect.arrayContaining([
                'PEANUT',
                'MILK',
                'VEGAN',
              ]),
              originalMeals: firstPayload.nutritionGuidance.originalMeals,
              compatibleFoods: [
                { name: 'Arroz', source: 'CURRENT_PLAN' },
                { name: 'Feijão', source: 'CURRENT_PLAN' },
              ],
              policy: { readOnly: true },
            },
          });
          expect(
            corrected.trustedContext.activeNutritionPlan,
          ).not.toHaveProperty('days');
          expect(corrected.currentNutrition.plan).not.toHaveProperty('days');
          const fullCorrection = {
            ...firstPayload,
            trustedContext: trusted,
            currentNutrition: { ...firstPayload.currentNutrition, plan },
            nutritionAdviceCorrection: corrected.nutritionAdviceCorrection,
          };
          expect(firstPayload.trustedContext.safety).toEqual(trusted.safety);
          expect(firstPayload.currentNutrition.plan.days).toBeUndefined();
          expect(JSON.stringify(firstPayload).length).toBeLessThan(
            JSON.stringify({
              ...firstPayload,
              trustedContext: trusted,
              currentNutrition: { ...firstPayload.currentNutrition, plan },
            }).length,
          );
          expect(JSON.stringify(corrected).length).toBeLessThan(
            JSON.stringify(fullCorrection).length,
          );
        },
      );

      it('clarifies conflicting dietary evidence without generating or correcting a recommendation', async () => {
        const personalized = {
          build: jest.fn().mockResolvedValue({
            nutrition: {
              dietaryPattern: { status: 'CONFLICTED', value: 'VEGAN' },
            },
          }),
          answer: jest.fn().mockReturnValue(null),
          validatesAnswer: jest.fn().mockReturnValue(true),
        };
        const s = recovery(
          'Uma opção é arroz.',
          'Outra opção é feijão.',
          personalized as unknown as PersonalizedCoachContextService,
        );
        const result = await s.service.execute(s.request);
        expect(result).toMatchObject({
          status: 'COMPLETED',
          observability: { disposition: 'CLARIFY' },
        });
        expect(s.ai.createJob).not.toHaveBeenCalled();
        expect(s.ai.runTextJob).not.toHaveBeenCalled();
        expect(s.gateway.createTextResponse).not.toHaveBeenCalled();
        expect(personalized.validatesAnswer).toHaveBeenCalled();
      });

      it('does not retry without the remaining provider budget', async () => {
        const s = recovery();
        const baseTime = Date.now();
        let clockTime = baseTime;
        s.ai.runTextJob.mockImplementation(() => {
          clockTime = baseTime + 24_000;
          return Promise.resolve({
            responseId: 'first',
            model: 'model',
            outputText: JSON.stringify(candidate(repeated)),
            promptTokens: 20,
            completionTokens: 10,
            totalTokens: 30,
          });
        });
        const now = jest.spyOn(Date, 'now').mockImplementation(() => clockTime);
        try {
          expect(await s.service.execute(s.request)).toMatchObject({
            status: 'COMPLETED',
            observability: {
              nutritionAdviceInitialViolation:
                'NUTRITION_ADVICE_REPEATS_CURRENT_MEAL',
              nutritionAdviceRetryAttempted: false,
              disposition: 'CLARIFY',
              fallbackReason: 'INSUFFICIENT_RUNTIME_BUDGET',
              totalTokens: 30,
            },
          });
          expect(s.ai.runTextJob).toHaveBeenCalledTimes(1);
          expect(s.gateway.createTextResponse).not.toHaveBeenCalled();
          expect(s.stored.status).toBe(AIJobStatus.FAILED);
          expect(s.usage.recordInTransaction).toHaveBeenCalledTimes(1);
        } finally {
          now.mockRestore();
        }
      });
      it('clarifies a rejected preference without retry when the original deadline is exhausted', async () => {
        const s = recovery('Experimente frango grelhado.');
        s.request.humanContext = {
          ...human('Me dê uma dica alternativa de jantar para hoje?'),
          nutrition: {
            ...human('').nutrition,
            rejectedFoods: { value: ['frango'], sources: [] },
          },
        };
        const baseTime = Date.now();
        let clockTime = baseTime;
        s.ai.runTextJob.mockImplementation(() => {
          clockTime = baseTime + 24_000;
          return Promise.resolve({
            responseId: 'first',
            model: 'model',
            outputText: JSON.stringify(
              candidate('Experimente frango grelhado.'),
            ),
            promptTokens: 20,
            completionTokens: 10,
            totalTokens: 30,
          });
        });
        const clock = jest
          .spyOn(Date, 'now')
          .mockImplementation(() => clockTime);
        try {
          expect(await s.service.execute(s.request)).toMatchObject({
            status: 'COMPLETED',
            observability: {
              disposition: 'CLARIFY',
              nutritionAdviceInitialViolation: 'NUTRITION_ADVICE_REJECTED_FOOD',
              nutritionAdviceRetryAttempted: false,
              fallbackReason: 'INSUFFICIENT_RUNTIME_BUDGET',
              totalTokens: 30,
            },
          });
          expect(s.gateway.createTextResponse).not.toHaveBeenCalled();
          expect(s.usage.recordInTransaction).toHaveBeenCalledTimes(1);
        } finally {
          clock.mockRestore();
        }
      });
      it('does not retry provider failures', async () => {
        const s = recovery();
        s.ai.runTextJob.mockRejectedValue(new Error('Provider unavailable'));
        expect(await s.service.execute(s.request)).toMatchObject({
          status: 'FAILED',
          reason: 'PROVIDER_EXECUTION_FAILED',
        });
        expect(s.gateway.createTextResponse).not.toHaveBeenCalled();
      });
      it('revalidates food safety on the corrective candidate', async () => {
        const s = recovery(repeated, 'Uma opção é pasta de amendoim.');
        s.request.humanContext = {
          ...s.request.humanContext,
          restrictions: { value: ['amendoim'], sources: [] },
        };
        expect(await s.service.execute(s.request)).toMatchObject({
          status: 'COMPLETED',
          content: 'Que alimentos você tem disponíveis para uma alternativa?',
          observability: {
            nutritionAdviceRetryAttempted: true,
            nutritionAdviceRetryOutcome: 'FAILED',
            disposition: 'CLARIFY',
            fallbackReason: 'NUTRITION_ADVICE_UNSAFE_FOOD',
            totalTokens: 70,
          },
        });
        expect(s.gateway.createTextResponse).toHaveBeenCalledTimes(1);
        expect(s.ai.completeJobInTransaction).not.toHaveBeenCalled();
        expect(s.stored).toMatchObject({
          status: AIJobStatus.FAILED,
          result: null,
          error: 'NUTRITION_ADVICE_UNSAFE_FOOD',
        });
        expect(s.usage.recordInTransaction).toHaveBeenCalledTimes(1);
      });
      it.each(['ownership', 'database', 'stored', 'joining'])(
        'does not start corrective recovery for %s',
        async (mode) => {
          const s = recovery();
          if (mode === 'ownership')
            s.ai.createJob.mockResolvedValue({
              id: 'job-id',
              userId: 'foreign',
              status: AIJobStatus.PENDING,
            });
          if (mode === 'database')
            s.ai.createJob.mockRejectedValue(new Error('Database unavailable'));
          if (mode === 'stored')
            s.ai.createJob.mockResolvedValue({
              id: 'job-id',
              userId: 'user-id',
              status: AIJobStatus.COMPLETED,
              result: candidate(repeated),
            });
          if (mode === 'joining') {
            s.ai.createJob.mockResolvedValue({
              id: 'job-id',
              userId: 'user-id',
              status: AIJobStatus.PROCESSING,
            });
            s.ai.getJob.mockResolvedValue({
              id: 'job-id',
              userId: 'user-id',
              status: AIJobStatus.COMPLETED,
              result: candidate(repeated),
            });
          }
          expect(await s.service.execute(s.request)).toMatchObject({
            status: 'FAILED',
          });
          expect(s.ai.runTextJob).not.toHaveBeenCalled();
          expect(s.gateway.createTextResponse).not.toHaveBeenCalled();
        },
      );
    });
    const snackPlan: PublicNutritionResponse = Object.freeze({
      ...publicPlan,
      days: Object.freeze([
        {
          meals: Object.freeze([
            {
              name: 'Lanche da tarde',
              time: '16:00',
              items: Object.freeze([
                { name: 'Macarrão cozido', quantity: '2 pratos pequenos' },
                { name: 'Peito de frango grelhado', quantity: '100 g' },
                { name: 'Feijão cozido', quantity: '1 concha pequena' },
              ]),
            },
          ]),
        },
      ]),
    });
    const option = (answer: string) => ({
      disposition: 'ANSWER',
      domain: 'NUTRITION',
      answer,
      followUpQuestion: null,
      grounding: 'MIXED',
      confidence: 'HIGH',
    });
    const input = (message: string) => ({
      userId: 'user-id',
      conversationId: 'conversation-id',
      messageId: 'message-id',
      route: route('NUTRITION_GUIDANCE'),
      humanContext: human(message),
      referenceDate: new Date('2026-10-05T18:00:00Z'),
    });

    it('keeps an explicit snack lookup faithful to the canonical meal', async () => {
      const subject = createSubject({}, AIJobStatus.PENDING, true);
      subject.currentNutrition.read.mockResolvedValue({
        status: 'AVAILABLE',
        plan: snackPlan,
      });
      const result = await subject.service.execute(
        input('Qual meu lanche da tarde?'),
      );
      expect(result).toMatchObject({
        status: 'COMPLETED',
        observability: { answerSource: 'DETERMINISTIC_FALLBACK' },
      });
      if (result.status !== 'COMPLETED')
        throw new Error('Expected plan lookup');
      for (const item of snackPlan.days[0].meals[0].items)
        expect(result.content).toContain(item.name);
      expect(subject.ai.runTextJob).not.toHaveBeenCalled();
    });

    it.each([
      ['Me dê uma dica para lanche da tarde', 'NUTRITION_ADVICE', []],
      [
        'O que posso comer no lugar do meu lanche da tarde?',
        'MEAL_SUBSTITUTION',
        [],
      ],
      [
        'Quero um lanche rápido e proteico',
        'CONSTRAINED_RECOMMENDATION',
        ['QUICK', 'HIGH_PROTEIN'],
      ],
      ['Me sugira algo sem lactose', 'CONSTRAINED_RECOMMENDATION', ['LACTOSE']],
    ] as const)(
      'sends %s to the existing QA with meal context and no plan mutation',
      async (message, intent, constraints) => {
        const before = JSON.stringify(snackPlan);
        const subject = createSubject(
          option(
            intent === 'MEAL_SUBSTITUTION'
              ? 'Como orientação aproximada fora do plano, uma opção prática é pão integral com ovos e uma fruta.'
              : 'Uma opção prática é pão integral com ovos e uma fruta.',
          ),
          AIJobStatus.PENDING,
          true,
        );
        subject.currentNutrition.read.mockResolvedValue({
          status: 'AVAILABLE',
          plan: snackPlan,
        });
        const result = await subject.service.execute(input(message));
        expect(result).toMatchObject({
          status: 'COMPLETED',
          observability: {
            answerSource:
              intent === 'MEAL_SUBSTITUTION' &&
              nutritionRequest(message)?.substitutionPurpose !==
                'OFF_PLAN_ADVICE'
                ? 'DETERMINISTIC_FALLBACK'
                : 'AI',
          },
        });
        const payload: unknown = JSON.parse(
          subject.ai.runTextJob.mock.calls[0][1].input as string,
        );
        expect(payload).toMatchObject({
          nutritionGuidance: {
            intent,
            immediateConstraints: constraints,
            safetyConstraints: constraints.filter((code) => code === 'LACTOSE'),
            originalMeals: [
              {
                name: 'Lanche da tarde',
                items: snackPlan.days[0].meals[0].items,
              },
            ],
            policy: {
              readOnly: true,
              currentPlanRole:
                intent === 'MEAL_SUBSTITUTION' &&
                nutritionRequest(message)?.substitutionPurpose !==
                  'OFF_PLAN_ADVICE'
                  ? 'SUBSTITUTION_EVIDENCE'
                  : 'CONTEXT_NOT_ANSWER',
              preserveApproximateNutritionalFunction:
                intent === 'MEAL_SUBSTITUTION',
            },
          },
        });
        expect(subject.ai.completeJobInTransaction).toHaveBeenCalledTimes(1);
        // The executor receives no plan repository or generator; its only write is AI completion.
        expect(Object.keys(subject.prisma)).toEqual(['$transaction']);
        expect(JSON.stringify(snackPlan)).toBe(before);
      },
    );

    it.each([
      AIJobStatus.PENDING,
      AIJobStatus.COMPLETED,
      AIJobStatus.PROCESSING,
    ])(
      'rejects mechanical canonical meal copies on fresh, stored and joined answers: %s',
      async (status) => {
        const subject = createSubject(
          option('Macarrão cozido com frango grelhado e feijão cozido.'),
          status,
          true,
        );
        subject.currentNutrition.read.mockResolvedValue({
          status: 'AVAILABLE',
          plan: snackPlan,
        });
        await expect(
          subject.service.execute(input('Me dê uma dica para lanche da tarde')),
        ).resolves.toMatchObject({
          status: 'FAILED',
          reason: 'NUTRITION_ADVICE_REPEATS_CURRENT_MEAL',
        });
        expect(subject.ai.completeJobInTransaction).not.toHaveBeenCalled();
      },
    );

    it('allows a canonical ingredient in a different combination', async () => {
      const subject = createSubject(
        option('Você pode preparar um sanduíche de frango com tomate.'),
        AIJobStatus.PENDING,
        true,
      );
      subject.currentNutrition.read.mockResolvedValue({
        status: 'AVAILABLE',
        plan: snackPlan,
      });
      await expect(
        subject.service.execute(input('Me dê uma dica para lanche da tarde')),
      ).resolves.toMatchObject({ status: 'COMPLETED' });
    });

    it.each([
      AIJobStatus.PENDING,
      AIJobStatus.COMPLETED,
      AIJobStatus.PROCESSING,
    ])(
      'blocks explicit lactose-incompatible advice before exposing any answer: %s',
      async (status) => {
        const subject = createSubject(
          option('Experimente iogurte natural com fruta.'),
          status,
          true,
        );
        await expect(
          subject.service.execute(input('Me sugira algo sem lactose')),
        ).resolves.toMatchObject({
          status: 'FAILED',
          reason: 'NUTRITION_ADVICE_UNSAFE_FOOD',
        });
        expect(subject.ai.completeJobInTransaction).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['amendoim', 'Experimente uma fruta com pasta de amendoim.'],
      ['leite', 'Experimente iogurte sem lactose.'],
      ['kiwi', 'Experimente kiwi com aveia.'],
    ])(
      'honors the existing personalized allergy projection: %s',
      async (allergy, answer) => {
        const context = {
          safety: {
            allergies: { status: 'KNOWN', value: [{ description: allergy }] },
          },
          nutrition: {},
        };
        const personalized = {
          build: jest.fn().mockResolvedValue(context),
          answer: jest.fn().mockReturnValue(null),
          validatesAnswer: jest.fn().mockReturnValue(true),
        };
        const subject = createSubject(
          option(answer),
          AIJobStatus.PENDING,
          true,
          personalized as unknown as PersonalizedCoachContextService,
        );
        await expect(
          subject.service.execute(input('Me dê uma dica para lanche da tarde')),
        ).resolves.toMatchObject({
          status: 'FAILED',
          reason: 'NUTRITION_ADVICE_UNSAFE_FOOD',
        });
        const payload: unknown = JSON.parse(
          subject.ai.runTextJob.mock.calls[0][1].input as string,
        );
        expect(payload).toMatchObject({
          nutritionGuidance: { safetyConstraints: [allergy] },
          trustedContext: context,
        });
        expect(subject.ai.completeJobInTransaction).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['vegano', 'Uma opção é frango com tomate.'],
      ['VEGAN', 'Uma opção é ovos com tomate.'],
      ['vegetariano', 'Uma opção é peixe com tomate.'],
      ['sem glúten', 'Uma opção é pão integral com ovos.'],
    ])(
      'blocks advice incompatible with an existing dietary restriction: %s',
      async (restriction, answer) => {
        const personalized = {
          build: jest.fn().mockResolvedValue({
            safety: {
              foodRestrictions: {
                status: 'KNOWN',
                value: [{ description: restriction }],
              },
            },
          }),
          answer: jest.fn().mockReturnValue(null),
          validatesAnswer: jest.fn().mockReturnValue(true),
        };
        const subject = createSubject(
          option(answer),
          AIJobStatus.PENDING,
          true,
          personalized as unknown as PersonalizedCoachContextService,
        );
        await expect(
          subject.service.execute(input('Me dê uma dica para lanche da tarde')),
        ).resolves.toMatchObject({
          status: 'FAILED',
          reason: 'NUTRITION_ADVICE_UNSAFE_FOOD',
        });
        expect(subject.ai.completeJobInTransaction).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['ovo', 'Uma nova opção é fruta com aveia.', 'COMPLETED'],
      ['ovo', 'Uma opção é ovos mexidos.', 'FAILED'],
      [
        'pasta de amendoim',
        'Uma opção é PASTA DE AMENDOIM com fruta.',
        'FAILED',
      ],
      ['maçã', 'Uma opção é MACAS com aveia.', 'FAILED'],
      ['ovo', 'Uma opção é um novelo de conversa sobre frutas.', 'COMPLETED'],
    ] as const)(
      'matches rejected food %s using normalized whole terms: %s',
      async (food, answer, status) => {
        const personalized = {
          build: jest.fn().mockResolvedValue({
            nutrition: {
              declaredFoodRejections: { status: 'KNOWN', value: [food] },
            },
          }),
          answer: jest.fn().mockReturnValue(null),
          validatesAnswer: jest.fn().mockReturnValue(true),
        };
        const subject = createSubject(
          option(answer),
          AIJobStatus.PENDING,
          true,
          personalized as unknown as PersonalizedCoachContextService,
        );
        const request = input('Me dê uma dica para lanche da tarde');
        expect(
          nutritionAdviceViolation(
            nutritionAdviceContext(
              request.humanContext,
              await personalized.build(),
              null,
              null,
              new Date('2026-10-08T12:00:00Z'),
            ),
            {
              disposition: 'ANSWER',
              domain: 'NUTRITION',
              answer,
              followUpQuestion: null,
              grounding: 'MIXED',
              confidence: 'HIGH',
            },
          ),
        ).toBe(status === 'FAILED' ? 'NUTRITION_ADVICE_REJECTED_FOOD' : null);
        // Rejected content remains vetoed; the new public outcome is a validated
        // clarification, not the rejected candidate disguised as a success.
        const result = await subject.service.execute(request);
        expect(result).toMatchObject({ status: 'COMPLETED' });
        if (status === 'FAILED') {
          expect(result).toMatchObject({
            content: 'Que alimentos você tem disponíveis para uma alternativa?',
            observability: {
              disposition: 'CLARIFY',
              fallbackReason: 'NUTRITION_ADVICE_REJECTED_FOOD',
            },
          });
          expect(subject.ai.failJob).toHaveBeenCalledTimes(1);
          expect(subject.ai.completeJobInTransaction).not.toHaveBeenCalled();
        } else {
          expect(result).toMatchObject({ content: answer });
        }
      },
    );

    it.each([
      [
        'uva',
        'Uma nova opção para um dia de chuva é fruta com aveia.',
        'COMPLETED',
      ],
      ['uva', 'Uma opção é uvas com aveia.', 'FAILED'],
      ['fruta do conde', 'Uma opção é FRUTA DO CONDE.', 'FAILED'],
      ['fruta do conde', 'Uma opção é fruta com aveia.', 'COMPLETED'],
    ] as const)(
      'matches custom restriction %s using normalized whole terms: %s',
      async (food, answer, status) => {
        const personalized = {
          build: jest.fn().mockResolvedValue({
            safety: {
              allergies: { status: 'KNOWN', value: [{ description: food }] },
            },
          }),
          answer: jest.fn().mockReturnValue(null),
          validatesAnswer: jest.fn().mockReturnValue(true),
        };
        const subject = createSubject(
          option(answer),
          AIJobStatus.PENDING,
          true,
          personalized as unknown as PersonalizedCoachContextService,
        );
        await expect(
          subject.service.execute(input('Me dê uma dica para lanche da tarde')),
        ).resolves.toMatchObject({ status });
      },
    );

    it('accepts compatible advice with goal, preferences and allergy context intact', async () => {
      const context = {
        goals: { nutrition: { status: 'KNOWN', value: 'WEIGHT_LOSS' } },
        safety: {
          allergies: { status: 'KNOWN', value: [{ description: 'amendoim' }] },
        },
        nutrition: {
          declaredFoodRejections: { status: 'KNOWN', value: ['frango'] },
          cookingAvailability: { status: 'KNOWN', value: 'LIMITED' },
        },
        preferences: {
          foodPreferences: {
            status: 'KNOWN',
            value: [{ kind: 'ACCEPTED', foodName: 'aveia' }],
          },
        },
      };
      const personalized = {
        build: jest.fn().mockResolvedValue(context),
        answer: jest.fn().mockReturnValue(null),
        validatesAnswer: jest.fn().mockReturnValue(true),
      };
      const subject = createSubject(
        option('Uma opção rápida é fruta com aveia e bebida vegetal.'),
        AIJobStatus.PENDING,
        true,
        personalized as unknown as PersonalizedCoachContextService,
      );
      await expect(
        subject.service.execute(input('Me dê uma dica para lanche da tarde')),
      ).resolves.toMatchObject({ status: 'COMPLETED' });
      const payload: unknown = JSON.parse(
        subject.ai.runTextJob.mock.calls[0][1].input as string,
      );
      expect(payload).toMatchObject({
        trustedContext: context,
        nutritionGuidance: {
          excludedFoods: ['frango'],
          safetyConstraints: ['amendoim'],
        },
      });
    });

    it('asks one useful question for conflicting allergies before model execution', async () => {
      const personalized = {
        build: jest.fn().mockResolvedValue({
          safety: {
            allergies: {
              status: 'REQUIRES_CONFIRMATION',
              value: [{ description: 'amendoim' }],
            },
          },
          profileFields: [
            { field: 'ALLERGIES', status: 'CONFLICTED', value: null },
          ],
        }),
        answer: jest.fn().mockReturnValue(null),
        validatesAnswer: jest.fn().mockReturnValue(true),
      };
      const subject = createSubject(
        {},
        AIJobStatus.PENDING,
        true,
        personalized as unknown as PersonalizedCoachContextService,
      );
      const result = await subject.service.execute(
        input('Me dê uma dica para lanche da tarde'),
      );
      expect(result).toMatchObject({
        status: 'COMPLETED',
        observability: { disposition: 'CLARIFY' },
      });
      if (result.status !== 'COMPLETED')
        throw new Error('Expected clarification');
      expect(result.content.match(/\?/gu)).toHaveLength(1);
      expect(subject.ai.createJob).not.toHaveBeenCalled();
    });

    it('asks about an unknown original meal before confirming a plan substitution', async () => {
      const subject = createSubject({}, AIJobStatus.PENDING, true);
      subject.currentNutrition.read.mockResolvedValue({
        status: 'ABSENT',
        plan: null,
      });
      await expect(
        subject.service.execute(
          input(
            'Posso substituir o meu lanche da tarde? Essa troca está cadastrada?',
          ),
        ),
      ).resolves.toMatchObject({
        status: 'COMPLETED',
        observability: { disposition: 'CLARIFY' },
      });
      expect(subject.ai.createJob).not.toHaveBeenCalled();
    });

    it('allows an approximate off-plan snack without an active meal registry', async () => {
      const answer =
        'Uma ideia aproximada para o lanche é fruta com aveia; não é uma equivalência confirmada do plano.';
      const subject = createSubject(option(answer), AIJobStatus.PENDING, true);
      subject.currentNutrition.read.mockResolvedValue({
        status: 'ABSENT',
        plan: null,
      });
      await expect(
        subject.service.execute(
          input('O que posso comer no lugar do meu lanche da tarde?'),
        ),
      ).resolves.toMatchObject({
        status: 'COMPLETED',
        content: answer,
        observability: { answerSource: 'AI' },
      });
      expect(subject.ai.createJob).toHaveBeenCalledTimes(1);
    });

    it('does not let a clarification conceal an incompatible suggestion', async () => {
      const subject = createSubject(
        {
          ...option('Experimente iogurte natural.'),
          disposition: 'CLARIFY',
          followUpQuestion: 'Você tem fruta em casa?',
        },
        AIJobStatus.PENDING,
        true,
      );
      await expect(
        subject.service.execute(input('Me sugira algo sem lactose')),
      ).resolves.toMatchObject({
        status: 'FAILED',
        reason: 'NUTRITION_ADVICE_UNSAFE_FOOD',
      });
    });

    it('allows explicitly lactose-free dairy when no milk allergy is present', async () => {
      const subject = createSubject(
        option('Uma opção é iogurte sem lactose com fruta.'),
        AIJobStatus.PENDING,
        true,
      );
      await expect(
        subject.service.execute(input('Me sugira algo sem lactose')),
      ).resolves.toMatchObject({ status: 'COMPLETED' });
    });

    it('uses recent suggestions to support variety on consecutive requests', async () => {
      const first = 'Uma opção é um sanduíche de ovos com tomate.';
      const second = 'Outra ideia é uma fruta com aveia e bebida vegetal.';
      const subject = createSubject(option(first), AIJobStatus.PENDING, true);
      subject.currentNutrition.read.mockResolvedValue({
        status: 'AVAILABLE',
        plan: snackPlan,
      });
      await expect(
        subject.service.execute(input('Me dê uma dica para lanche da tarde')),
      ).resolves.toMatchObject({ status: 'COMPLETED' });
      subject.ai.runTextJob.mockResolvedValue({
        responseId: 'second',
        model: 'model',
        outputText: JSON.stringify(option(second)),
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
      });
      await expect(
        subject.service.execute({
          ...input('Me sugira algo diferente para comer agora'),
          messageId: 'second-message',
          humanContext: human('Me sugira algo diferente para comer agora', [
            { direction: 'COACH', text: first },
          ]),
        }),
      ).resolves.toMatchObject({ status: 'COMPLETED' });
      const payload: unknown = JSON.parse(
        subject.ai.runTextJob.mock.calls[1][1].input as string,
      );
      expect(payload).toMatchObject({
        nutritionGuidance: { recentSuggestions: [first] },
      });
      expect(subject.ai.runTextJob).toHaveBeenCalledTimes(2);
    });
  });

  const cases = [
    {
      message: 'Quanto é a medida de uma colher de sopa?',
      answer:
        'Uma colher de sopa padrão tem aproximadamente 15 mL. Em gramas, o valor varia conforme o alimento e o preparo.',
      grounding: 'GENERAL_KNOWLEDGE',
    },
    {
      message: 'Qual o volume aproximado de uma colher grande de cozinha?',
      answer:
        'Como referência geral, uma colher de sopa tem cerca de 15 mL; o peso depende da densidade do ingrediente.',
      grounding: 'GENERAL_KNOWLEDGE',
    },
    {
      message: 'Quantos litros de água preciso tomar por dia?',
      answer:
        'A necessidade de água varia com corpo, clima e atividade. Use sede e cor da urina como referências gerais e procure orientação profissional se houver condição de saúde.',
      grounding: 'MIXED',
    },
    {
      message:
        'Na dieta que você montou, quanto seriam 5 colheres de arroz em gramas?',
      answer:
        'Seu plano registra 5 colheres de arroz. A conversão para gramas é aproximada porque depende do tamanho da colher e do preparo.',
      grounding: 'CURRENT_PLAN',
    },
    {
      message: 'Qual é minha meta de proteína?',
      answer: 'Sua meta atual no plano é 118 g de proteína por dia.',
      grounding: 'CURRENT_PLAN',
    },
    {
      message: 'Qual era mesmo meu jantar?',
      answer: 'Seu jantar atual está previsto para 20:00 e inclui arroz.',
      grounding: 'CURRENT_PLAN',
    },
    {
      message: 'Posso trocar arroz por macarrão?',
      answer:
        'Sim. Seu plano atual registra macarrão como troca possível para o arroz.',
      grounding: 'CURRENT_PLAN',
    },
    {
      message: 'Não gostei do atum. Posso trocar por quê?',
      answer:
        'Não encontrei atum no seu plano atual. Posso dar opções gerais, mas preciso saber em qual refeição você pretende usá-lo.',
      grounding: 'MIXED',
    },
    {
      message: 'Por que você colocou 4 refeições?',
      answer:
        'A distribuição das refeições segue o contexto usado no plano atual e pode ajudar a organizar sua rotina.',
      grounding: 'MIXED',
    },
    {
      message: 'Posso inverter almoço e jantar?',
      answer:
        'Como orientação pontual, a inversão pode ser considerada se quantidades e restrições forem respeitadas; isso não altera seu plano salvo.',
      grounding: 'CURRENT_PLAN',
    },
  ] as const;

  it.each(cases)(
    'answers read-only category with one provider execution: $message',
    async ({ message, answer, grounding }) => {
      const subject = createSubject({
        disposition: 'ANSWER',
        domain: 'NUTRITION',
        answer,
        followUpQuestion: null,
        grounding,
        confidence: 'HIGH',
      });

      await expect(
        subject.service.execute({
          userId: 'user-id',
          conversationId: 'conversation-id',
          messageId: 'message-id',
          route: route('NUTRITION_GUIDANCE'),
          humanContext: human(message),
        }),
      ).resolves.toMatchObject({
        status: 'COMPLETED',
        content:
          message === 'Posso trocar arroz por macarrão?'
            ? expect.stringContaining(
                'o plano registra a troca de Arroz por Macarrão',
              )
            : answer,
      });

      expect(subject.ai.runTextJob).toHaveBeenCalledTimes(1);
      expect(subject.ai.completeJobInTransaction).toHaveBeenCalledTimes(1);
      const providerInput = subject.ai.runTextJob.mock.calls[0][1].input;
      const providerTimeout = subject.ai.runTextJob.mock.calls[0][1].timeoutMs;
      expect(providerInput).toContain('118');
      expect(providerInput).toContain('Macarrão');
      expect(providerInput).not.toMatch(
        /job-id|provider-response|operationKey|correlationId|NUTRITION_V2/iu,
      );
      expect(providerTimeout).toBeGreaterThanOrEqual(1_000);
      expect(providerTimeout).toBeLessThan(25_000);
    },
  );

  it.each([
    [
      'Na minha dieta, quanto dão 5 colheres desse arroz em gramas?',
      'E se fossem 3?',
    ],
    ['Posso trocar arroz por macarrão?', 'Essa troca muda muito as calorias?'],
    [
      'A quantidade foi definida pelo seu plano atual.',
      'Por que você colocou isso?',
    ],
  ])(
    'sends bounded public recent context for reference resolution',
    async (previous, current) => {
      const subject = createSubject({
        disposition: 'ANSWER',
        domain: 'NUTRITION',
        answer: 'Resposta contextual.',
        followUpQuestion: null,
        grounding: 'RECENT_CONTEXT',
        confidence: 'HIGH',
      });

      await subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human(
          current,
          Object.freeze([{ direction: 'USER', text: previous }]),
        ),
      });

      const providerInput = subject.ai.runTextJob.mock.calls[0][1].input;
      expect(providerInput).toContain(previous);
      expect(providerInput).toContain(current);
      expect(providerInput).toContain('recentConversation');
      expect(providerInput).not.toMatch(/user-id|conversation-id|message-id/u);
    },
  );

  it('keeps a short hydration answer public while retaining internal grounding', async () => {
    const answer =
      'A necessidade varia com seu corpo, clima e atividade. Sede e cor da urina ajudam como referências gerais.';
    const subject = createSubject({
      disposition: 'ANSWER',
      domain: 'NUTRITION',
      answer,
      followUpQuestion: null,
      grounding: 'MIXED',
      confidence: 'HIGH',
    });

    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human('Quantos litros de água por dia?'),
      }),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      content: answer,
      observability: { grounding: 'MIXED' },
    });
    expect(answer.length).toBeLessThanOrEqual(350);
    expect(answer).not.toMatch(/can[oô]nic|\*\*|runtime|pipeline/iu);
  });

  it('preserves the requested rice quantity without repeating unrelated foods', async () => {
    const answer =
      '🍚 No almoço, seu plano tem *arroz branco cozido: 3 xícaras cozidas*.';
    const subject = createSubject({
      disposition: 'ANSWER',
      domain: 'NUTRITION',
      answer,
      followUpQuestion: 'Quer que eu converta isso para gramas?',
      grounding: 'CURRENT_PLAN',
      confidence: 'HIGH',
    });
    subject.currentNutrition.read.mockResolvedValueOnce({
      status: 'AVAILABLE',
      plan: {
        ...publicPlan,
        days: Object.freeze([
          Object.freeze({
            meals: Object.freeze([
              Object.freeze({
                name: 'Almoço',
                items: Object.freeze([
                  Object.freeze({
                    name: 'Arroz branco cozido',
                    quantity: '3 xícaras cozidas',
                  }),
                ]),
              }),
            ]),
          }),
        ]),
      },
    });

    const result = await subject.service.execute({
      userId: 'user-id',
      conversationId: 'conversation-id',
      messageId: 'message-id',
      route: route('NUTRITION_GUIDANCE'),
      humanContext: human('Quanto de arroz eu tenho no almoço?'),
    });

    expect(result).toMatchObject({
      status: 'COMPLETED',
      content: `${answer}\n\nQuer que eu converta isso para gramas?`,
    });
    expect(result.status === 'COMPLETED' && result.content).toContain(
      '3 xícaras cozidas',
    );
    const providerInput = subject.ai.runTextJob.mock.calls[0][1].input;
    expect(providerInput).toContain('3 xícaras cozidas');
    expect(result.status === 'COMPLETED' && result.content).not.toContain(
      'Feijão',
    );
  });

  it('persists the production candidate with its trailing offer structured and unchanged publicly', async () => {
    const publicContent =
      'No almoço, você tem *3 xícaras de arroz branco cozido* 🍚\n\nSe quiser, eu também posso te passar isso em gramas aproximadas.';
    const subject = createSubject({
      disposition: 'ANSWER',
      domain: 'NUTRITION',
      answer: publicContent,
      followUpQuestion: null,
      grounding: 'CURRENT_PLAN',
      confidence: 'HIGH',
    });

    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human('Quanto arroz eu tenho no almoço?'),
      }),
    ).resolves.toMatchObject({ status: 'COMPLETED', content: publicContent });

    expect(subject.ai.runTextJob).toHaveBeenCalledTimes(1);
    expect(subject.ai.completeJobInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        result: expect.objectContaining({
          answer: 'No almoço, você tem *3 xícaras de arroz branco cozido* 🍚',
          followUpQuestion:
            'Se quiser, eu também posso te passar isso em gramas aproximadas.',
        }),
      }),
    );
  });

  it('uses a previous coach follow-up for one read-only provider continuation', async () => {
    const subject = createSubject({
      disposition: 'ANSWER',
      domain: 'NUTRITION',
      answer: 'As 3 xícaras equivalem aproximadamente a 480 g de arroz cozido.',
      followUpQuestion: null,
      grounding: 'RECENT_CONTEXT',
      confidence: 'HIGH',
    });

    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('ANSWER_MESSAGE'),
        humanContext: human(
          'Sim',
          Object.freeze([
            {
              direction: 'COACH',
              text: 'Quer que eu converta isso para gramas?',
            },
          ]),
        ),
        previousAnswer:
          '🍚 No almoço, seu plano tem *arroz branco cozido: 3 xícaras cozidas*.',
        previousFollowUpQuestion: 'Quer que eu converta isso para gramas?',
      }),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      content:
        'As 3 xícaras equivalem aproximadamente a 480 g de arroz cozido.',
    });
    expect(subject.ai.createJob).toHaveBeenCalledWith(
      expect.objectContaining({ type: AIJobType.TEXT }),
    );
    expect(subject.ai.createJob).toHaveBeenCalledTimes(1);
    expect(subject.ai.runTextJob).toHaveBeenCalledTimes(1);
    const providerInput = subject.ai.runTextJob.mock.calls[0][1].input;
    expect(providerInput).toContain(
      '"previousFollowUpQuestion":"Quer que eu converta isso para gramas?"',
    );
    expect(providerInput).toContain(
      '"previousAnswer":"🍚 No almoço, seu plano tem *arroz branco cozido: 3 xícaras cozidas*."',
    );
    expect(providerInput).toContain('"request":"Sim"');
  });

  it('answers only the requested approximate referent', async () => {
    const answer =
      'As 3 xícaras de arroz cozido equivalem aproximadamente a 480 g.';
    const subject = createSubject({
      disposition: 'ANSWER',
      domain: 'NUTRITION',
      answer,
      followUpQuestion: null,
      grounding: 'RECENT_CONTEXT',
      confidence: 'HIGH',
    });

    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human('E em gramas, aproximadamente quanto seria isso?'),
      }),
    ).resolves.toMatchObject({ status: 'COMPLETED', content: answer });
    expect(answer).not.toMatch(/feij[aã]o|frango/iu);
  });

  it('keeps a lighter-lunch suggestion concise, read-only and bounded to three bullets', async () => {
    const answer =
      'Para deixar o almoço mais leve hoje:\n- reduza um pouco o arroz;\n- mantenha a proteína;\n- aumente salada ou legumes.';
    const subject = createSubject({
      disposition: 'ANSWER',
      domain: 'NUTRITION',
      answer,
      followUpQuestion: null,
      grounding: 'MIXED',
      confidence: 'HIGH',
    });

    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human(
          'O que posso ajustar no almoço hoje para ficar mais leve?',
        ),
      }),
    ).resolves.toMatchObject({ status: 'COMPLETED', content: answer });
    expect(answer.length).toBeLessThanOrEqual(650);
    expect(answer.match(/^[-•]\s+/gmu)).toHaveLength(3);
    expect(subject.ai.createJob).toHaveBeenCalledWith(
      expect.objectContaining({ type: AIJobType.TEXT }),
    );
    expect(subject.ai.runTextJob).toHaveBeenCalledTimes(1);
  });

  it('reuses a completed answer without another provider execution', async () => {
    const candidate = {
      disposition: 'ANSWER',
      domain: 'GENERAL',
      answer: 'Resposta persistida.',
      followUpQuestion: null,
      grounding: 'GENERAL_KNOWLEDGE',
      confidence: 'HIGH',
    };
    const subject = createSubject(candidate, AIJobStatus.COMPLETED);

    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('ANSWER_MESSAGE'),
        humanContext: human('Pergunta repetida?'),
      }),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      content: 'Resposta persistida.',
      observability: { answerSource: 'AI_REUSED' },
    });
    expect(subject.ai.runTextJob).not.toHaveBeenCalled();
  });

  it('normalizes a legacy completed candidate without another provider execution', async () => {
    const publicContent =
      'Resposta persistida.\n\nQuer que eu converta isso para gramas?';
    const subject = createSubject(
      {
        disposition: 'ANSWER',
        domain: 'GENERAL',
        answer: publicContent,
        followUpQuestion: null,
        grounding: 'GENERAL_KNOWLEDGE',
        confidence: 'HIGH',
      },
      AIJobStatus.COMPLETED,
    );

    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('ANSWER_MESSAGE'),
        humanContext: human('Pergunta repetida?'),
      }),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      content: publicContent,
      observability: { answerSource: 'AI_REUSED' },
    });
    expect(subject.ai.runTextJob).not.toHaveBeenCalled();
  });

  it('joins and reuses the answer from the concurrent executor that won the claim', async () => {
    const candidate = {
      disposition: 'ANSWER',
      domain: 'GENERAL',
      answer: 'Resposta oficial do vencedor.',
      followUpQuestion: null,
      grounding: 'GENERAL_KNOWLEDGE',
      confidence: 'HIGH',
    };
    const subject = createSubject(candidate);
    subject.ai.runTextJob.mockRejectedValueOnce(
      new ConflictException('Job de IA já processado ou em andamento'),
    );

    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('ANSWER_MESSAGE'),
        humanContext: human('Pergunta duplicada?'),
      }),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      content: 'Resposta oficial do vencedor.',
      observability: { answerSource: 'AI_REUSED' },
    });
    expect(subject.ai.failJob).not.toHaveBeenCalled();
    expect(subject.ai.getJob).toHaveBeenCalledWith('job-id');
  });

  it('executes one provider call and gives concurrent duplicates the winner content', async () => {
    const candidate = {
      disposition: 'ANSWER',
      domain: 'GENERAL',
      answer: 'Resposta oficial bem-sucedida.',
      followUpQuestion: null,
      grounding: 'GENERAL_KNOWLEDGE',
      confidence: 'HIGH',
    };
    const response = {
      responseId: 'provider-response',
      model: 'model',
      outputText: JSON.stringify(candidate),
      promptTokens: 20,
      completionTokens: 10,
      totalTokens: 30,
    };
    let jobStatus: AIJobStatus = AIJobStatus.PENDING;
    let storedResult: object | null = null;
    let providerCalls = 0;
    let releaseProvider: (() => void) | undefined;
    let announceProviderStart: (() => void) | undefined;
    const providerStarted = new Promise<void>((resolve) => {
      announceProviderStart = resolve;
    });
    const providerRelease = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const ai = {
      createJob: jest.fn().mockImplementation(() =>
        Promise.resolve({
          id: 'job-id',
          status: AIJobStatus.PENDING,
          result: null,
        }),
      ),
      runTextJob: jest.fn().mockImplementation(async () => {
        if (jobStatus === AIJobStatus.PROCESSING) {
          throw new ConflictException('Job em andamento');
        }
        jobStatus = AIJobStatus.PROCESSING;
        providerCalls += 1;
        announceProviderStart?.();
        await providerRelease;
        return response;
      }),
      completeJobInTransaction: jest.fn().mockImplementation(() => {
        storedResult = candidate;
        jobStatus = AIJobStatus.COMPLETED;
        return Promise.resolve();
      }),
      failJob: jest.fn().mockResolvedValue(undefined),
      failPendingJob: jest.fn().mockResolvedValue(undefined),
      getJob: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve({ status: jobStatus, result: storedResult }),
        ),
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation((callback: (transaction: object) => unknown) =>
          callback({}),
        ),
    };
    const currentNutrition = {
      read: jest.fn().mockResolvedValue({ status: 'ABSENT', plan: null }),
    };
    const service = new ConversationQAExecutorService(
      ai as never,
      prisma as never,
      currentNutrition as never,
      new ConversationPublicAnswerBoundaryService(),
    );
    const input = {
      userId: 'user-id',
      conversationId: 'conversation-id',
      messageId: 'message-id',
      route: route('ANSWER_MESSAGE'),
      humanContext: human('Quanto é uma colher de sopa?'),
      deadlineAtMs: Date.now() + 10_000,
    };

    const winner = service.execute(input);
    await providerStarted;
    const duplicate = service.execute(input);
    releaseProvider?.();
    const results = await Promise.all([winner, duplicate]);
    const officialResponses = new Map<string, string>();
    for (const result of results) {
      if (result.status === 'COMPLETED') {
        officialResponses.set(input.messageId, result.content);
      }
    }

    expect(providerCalls).toBe(1);
    expect(results).toEqual([
      expect.objectContaining({
        status: 'COMPLETED',
        content: 'Resposta oficial bem-sucedida.',
      }),
      expect.objectContaining({
        status: 'COMPLETED',
        content: 'Resposta oficial bem-sucedida.',
      }),
    ]);
    expect(officialResponses).toEqual(
      new Map([['message-id', 'Resposta oficial bem-sucedida.']]),
    );
    expect(ai.failJob).not.toHaveBeenCalled();
  });

  it('contains completion failures and records the provider usage on failure', async () => {
    const subject = createSubject({
      disposition: 'ANSWER',
      domain: 'GENERAL',
      answer: 'Resposta segura.',
      followUpQuestion: null,
      grounding: 'GENERAL_KNOWLEDGE',
      confidence: 'HIGH',
    });
    subject.ai.completeJobInTransaction.mockRejectedValueOnce(
      new Error('transaction failed'),
    );

    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('ANSWER_MESSAGE'),
        humanContext: human('Pergunta'),
      }),
    ).resolves.toMatchObject({
      status: 'FAILED',
      reason: 'AI_JOB_COMPLETION_FAILED',
    });
    const failure = subject.ai.failJob.mock.calls[0];
    expect(failure[0]).toBe('job-id');
    expect(failure[1]).toBeInstanceOf(Error);
    expect(failure[2]).toEqual(expect.objectContaining({ totalTokens: 30 }));
  });

  it('fails closed before creating a job when the runtime budget is too small', async () => {
    const subject = createSubject({});

    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('ANSWER_MESSAGE'),
        humanContext: human('Pergunta'),
        deadlineAtMs: Date.now() + 3_000,
      }),
    ).resolves.toMatchObject({
      status: 'FAILED',
      reason: 'INSUFFICIENT_RUNTIME_BUDGET',
    });
    expect(subject.ai.createJob).not.toHaveBeenCalled();
    expect(subject.ai.runTextJob).not.toHaveBeenCalled();
  });

  it('finishes provider timeout through the normal failed-job path before runtime deadline', async () => {
    const subject = createSubject({});
    subject.ai.runTextJob.mockRejectedValueOnce(new Error('provider timeout'));
    const runtimeBudgetMs = 6_000;

    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('ANSWER_MESSAGE'),
        humanContext: human('Pergunta'),
        deadlineAtMs: Date.now() + runtimeBudgetMs,
      }),
    ).resolves.toMatchObject({
      status: 'FAILED',
      reason: 'PROVIDER_EXECUTION_FAILED',
    });
    const request = subject.ai.runTextJob.mock.calls[0][1];
    expect(request.timeoutMs).toBeLessThanOrEqual(runtimeBudgetMs - 2_500);
    expect(subject.ai.failJob).toHaveBeenCalledTimes(1);
    expect(subject.ai.completeJobInTransaction).not.toHaveBeenCalled();
  });

  it('defers a persistent modification without producing public content', async () => {
    const subject = createSubject({
      disposition: 'DEFER_TO_SIDE_EFFECT_PIPELINE',
      domain: 'NUTRITION',
      answer: null,
      followUpQuestion: null,
      grounding: 'CURRENT_PLAN',
      confidence: 'HIGH',
    });

    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human(
          'Troque meu almoço com meu jantar no meu plano daqui para frente.',
        ),
      }),
    ).resolves.toMatchObject({ status: 'DEFERRED' });
    expect(subject.ai.runTextJob).toHaveBeenCalledTimes(1);
  });

  it('rejects internal output instead of exposing a corrupted line', async () => {
    const subject = createSubject({
      disposition: 'ANSWER',
      domain: 'GENERAL',
      answer: 'operationKey 123 não deve aparecer.',
      followUpQuestion: null,
      grounding: 'GENERAL_KNOWLEDGE',
      confidence: 'HIGH',
    });

    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('ANSWER_MESSAGE'),
        humanContext: human('Pergunta'),
      }),
    ).resolves.toMatchObject({
      status: 'FAILED',
      reason: 'PUBLIC_BOUNDARY_REJECTED',
    });
  });
  it.each([AIJobStatus.COMPLETED, AIJobStatus.PROCESSING])(
    'rejects a foreign job returned by a mock: %s',
    async (status) => {
      const subject = createSubject(
        {
          disposition: 'ANSWER',
          domain: 'GENERAL',
          answer: 'Foreign answer',
          followUpQuestion: null,
          grounding: 'PROFILE',
          confidence: 'HIGH',
        },
        status,
      );
      if (status === AIJobStatus.COMPLETED)
        subject.ai.createJob.mockResolvedValue({
          id: 'job-id',
          status,
          userId: 'other',
          result: {},
        });
      else
        subject.ai.getJob.mockResolvedValue({
          id: 'job-id',
          status: AIJobStatus.COMPLETED,
          userId: 'other',
          result: {},
        });
      await expect(
        subject.service.execute({
          userId: 'user-id',
          conversationId: 'conversation-id',
          messageId: 'message-id',
          route: route('ANSWER_MESSAGE'),
          humanContext: human('Qual meu objetivo?'),
        }),
      ).resolves.toMatchObject({
        status: 'FAILED',
        reason: 'AI_JOB_OWNERSHIP_MISMATCH',
      });
      expect(subject.ai.runTextJob).not.toHaveBeenCalled();
      expect(subject.ai.completeJobInTransaction).not.toHaveBeenCalled();
    },
  );
});
