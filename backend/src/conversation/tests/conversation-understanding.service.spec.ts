import { performance } from 'node:perf_hooks';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConversationModule } from '../conversation.module';
import { ConversationUnderstandingService } from '../understanding/conversation-understanding.service';
import {
  historyEntry,
  understandingInput,
} from './conversation-understanding.fixtures';

describe('ConversationUnderstandingService', () => {
  let module: TestingModule;
  let service: ConversationUnderstandingService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ConversationModule],
    }).compile();
    service = module.get(ConversationUnderstandingService);
  });

  afterAll(async () => module.close());

  it.each([
    ['Olá 👋', 'COMMON_MESSAGE', 'ANSWER', 'GENERAL'],
    ['Muito obrigado!', 'COMMON_MESSAGE', 'ANSWER', 'GENERAL'],
    ['Até mais', 'COMMON_MESSAGE', 'ANSWER', 'GENERAL'],
    [
      'Posso tomar creatina?',
      'NUTRITION_QUESTION',
      'PROVIDE_GUIDANCE',
      'NUTRITION',
    ],
    [
      'Posso trocar arroz por macarrão?',
      'NUTRITION_QUESTION',
      'PROVIDE_GUIDANCE',
      'NUTRITION',
    ],
    [
      'Não gostei do atum. Posso trocar por quê?',
      'GENERAL_GUIDANCE_REQUEST',
      'PROVIDE_GUIDANCE',
      'GENERAL',
    ],
    [
      'Monte um plano alimentar semanal',
      'DIET_PLAN_REQUEST',
      'GENERATE_PLAN',
      'NUTRITION',
    ],
    [
      'Quero um plano diário de dieta',
      'DIET_PLAN_REQUEST',
      'GENERATE_PLAN',
      'NUTRITION',
    ],
    [
      'MONTE MEU TREINO DE CROSSFIT',
      'WORKOUT_PLAN_REQUEST',
      'GENERATE_PLAN',
      'WORKOUT',
    ],
    [
      'Quero dieta e treino',
      'COMBINED_PLAN_REQUEST',
      'GENERATE_PLAN',
      'COMBINED',
    ],
    [
      'Atualize minha dieta',
      'DIET_PLAN_UPDATE_REQUEST',
      'UPDATE_PLAN',
      'NUTRITION',
    ],
    [
      'Troque o frango dessa dieta',
      'DIET_PLAN_UPDATE_REQUEST',
      'SUBSTITUTE_ITEM',
      'NUTRITION',
    ],
    [
      'Atualize meu treino',
      'WORKOUT_PLAN_UPDATE_REQUEST',
      'UPDATE_PLAN',
      'WORKOUT',
    ],
    [
      'Troque esse exercício do meu treino',
      'WORKOUT_PLAN_UPDATE_REQUEST',
      'SUBSTITUTE_ITEM',
      'WORKOUT',
    ],
    [
      'Revise meu progresso',
      'PROGRESS_REVIEW_REQUEST',
      'REVIEW_PROGRESS',
      'GENERAL',
    ],
    [
      'Compare minha evolução',
      'PROGRESS_REVIEW_REQUEST',
      'REVIEW_PROGRESS',
      'GENERAL',
    ],
    [
      'Qual o status da minha dieta?',
      'PLAN_STATUS_REQUEST',
      'PRESENT_PLAN_STATUS',
      'NUTRITION',
    ],
    [
      'Mostre meu treino atual',
      'CURRENT_PLAN_REQUEST',
      'PRESENT_CURRENT_PLAN',
      'WORKOUT',
    ],
    [
      'Explique como funciona musculação',
      'GENERAL_GUIDANCE_REQUEST',
      'PROVIDE_GUIDANCE',
      'WORKOUT',
    ],
  ] as const)('recognizes %s', async (text, intent, operation, domain) => {
    await expect(
      service.understand(understandingInput(text)),
    ).resolves.toMatchObject({
      status: 'UNDERSTOOD',
      intent,
      operation,
      domain,
      ambiguity: { present: false },
    });
  });

  it.each([
    'Quanto é a medida de uma colher de sopa?',
    'Qual o volume aproximado de uma colher grande de cozinha?',
    'Quantos litros de água preciso tomar por dia?',
    'Qual seria uma referência diária de hidratação?',
  ])('routes open-ended question as read-only guidance: %s', async (text) => {
    await expect(
      service.understand(understandingInput(text)),
    ).resolves.toMatchObject({
      status: 'UNDERSTOOD',
      operation: 'PROVIDE_GUIDANCE',
    });
  });

  it('keeps an imperative persistent substitution on the update operation', async () => {
    await expect(
      service.understand(
        understandingInput(
          'Troque meu almoço com meu jantar no meu plano daqui para frente.',
          { dietAvailable: true },
        ),
      ),
    ).resolves.toMatchObject({
      operation: 'UPDATE_PLAN',
      intent: 'DIET_PLAN_UPDATE_REQUEST',
      domain: 'NUTRITION',
    });
  });

  it.each([
    'É tranquilo trocar arroz por macarrão?',
    'Seria uma boa trocar o arroz pelo macarrão?',
    'Eu conseguiria usar macarrão no lugar do arroz?',
  ])(
    'keeps advisory substitution semantic equivalents read-only: %s',
    async (text) => {
      await expect(
        service.understand(understandingInput(text)),
      ).resolves.toMatchObject({
        status: 'UNDERSTOOD',
        operation: 'PROVIDE_GUIDANCE',
      });
    },
  );

  it('keeps an explicit persistent request on the official update path', async () => {
    await expect(
      service.understand(
        understandingInput(
          'Quero que você troque arroz por macarrão no meu plano daqui para frente.',
          { dietAvailable: true },
        ),
      ),
    ).resolves.toMatchObject({
      status: 'UNDERSTOOD',
      operation: 'SUBSTITUTE_ITEM',
      intent: 'DIET_PLAN_UPDATE_REQUEST',
      domain: 'NUTRITION',
    });
  });

  it.each([
    'Como posso ajustar meu almoço hoje?',
    'O que posso melhorar no jantar?',
    'Seria melhor mudar alguma coisa no café da manhã?',
    'Preciso melhorar meu jantar.',
  ])('keeps advisory update wording read-only: %s', async (text) => {
    await expect(
      service.understand(understandingInput(text, { dietAvailable: true })),
    ).resolves.toMatchObject({
      status: 'UNDERSTOOD',
      operation: 'PROVIDE_GUIDANCE',
    });
  });

  it.each([
    'Ajuste meu almoço no meu plano daqui para frente.',
    'Altere permanentemente meu jantar.',
    'Ajuste meu almoço.',
  ])(
    'keeps explicit persistent update wording on the update path: %s',
    async (text) => {
      await expect(
        service.understand(understandingInput(text, { dietAvailable: true })),
      ).resolves.toMatchObject({
        status: 'UNDERSTOOD',
        operation: 'UPDATE_PLAN',
        intent: 'DIET_PLAN_UPDATE_REQUEST',
        domain: 'NUTRITION',
      });
    },
  );

  it.each(['sim', 'não', 'continue', 'cancela'])(
    'recognizes confirmation continuity for %s',
    async (text) => {
      await expect(
        service.understand(
          understandingInput(text, {
            pendingConfirmation: true,
            targetPlan: 'DIET',
          }),
        ),
      ).resolves.toMatchObject({
        intent: 'CONFIRMATION_REQUIRED',
        operation: 'REQUEST_CONFIRMATION',
        metadata: {
          contextUsed: expect.arrayContaining(['CONTINUITY']),
          rationaleCodes: expect.arrayContaining(['PENDING_CONFIRMATION']),
        },
      });
    },
  );

  it('resolves a deictic follow-up from continuity', async () => {
    const result = await service.understand(
      understandingInput('troca isso', { targetPlan: 'DIET' }),
    );
    expect(result).toMatchObject({
      status: 'UNDERSTOOD',
      intent: 'DIET_PLAN_UPDATE_REQUEST',
      operation: 'UPDATE_PLAN',
      domain: 'NUTRITION',
      references: expect.arrayContaining([
        expect.objectContaining({ kind: 'PLAN', resolution: 'RESOLVED' }),
      ]),
    });
  });

  it('resolves a follow-up from recent textual history', async () => {
    const result = await service.understand(
      understandingInput('troque isso', {
        recentHistory: [historyEntry('Seu treino atual está pronto')],
      }),
    );
    expect(result).toMatchObject({
      intent: 'WORKOUT_PLAN_UPDATE_REQUEST',
      domain: 'WORKOUT',
      metadata: { contextUsed: expect.arrayContaining(['RECENT_HISTORY']) },
    });
  });

  it('uses the active Profile Acquisition field as context without inventing an intent', async () => {
    const result = await service.understand(
      understandingInput('82 quilos', { activeProfileField: 'CURRENT_WEIGHT' }),
    );
    expect(result).toMatchObject({
      intent: 'COMMON_MESSAGE',
      operation: 'ANSWER',
      domain: 'PROFILE',
      metadata: {
        contextUsed: expect.arrayContaining(['CONTINUITY']),
        rationaleCodes: expect.arrayContaining(['ACTIVE_PROFILE_QUESTION']),
      },
    });
  });

  it('resolves an unqualified current plan only from an available profile plan', async () => {
    const result = await service.understand(
      understandingInput('mostre meu plano', { dietAvailable: true }),
    );
    expect(result).toMatchObject({
      intent: 'CURRENT_PLAN_REQUEST',
      domain: 'NUTRITION',
      references: expect.arrayContaining([
        expect.objectContaining({
          domain: 'NUTRITION',
          resolution: 'RESOLVED',
        }),
      ]),
    });
  });

  it('rejects conflicting operations rather than choosing one', async () => {
    await expect(
      service.understand(understandingInput('mostre e atualize minha dieta')),
    ).resolves.toMatchObject({
      status: 'FAILED',
      failure: 'AMBIGUOUS',
      ambiguity: { codes: expect.arrayContaining(['MULTIPLE_OPERATIONS']) },
    });
  });

  it('returns INVALID_RESULT for an invalid input contract', async () => {
    const invalid = { ...understandingInput('olá'), userId: '' };
    await expect(service.understand(invalid)).resolves.toMatchObject({
      status: 'FAILED',
      failure: 'INVALID_RESULT',
    });
  });

  it.each([
    'quero mudar',
    'troca isso',
    'faz outro',
    'melhora',
    'quero diferente',
  ])('does not guess ambiguous input: %s', async (text) => {
    const result = await service.understand(understandingInput(text));
    expect(result).toMatchObject({
      status: 'FAILED',
      failure: 'AMBIGUOUS',
      intent: 'UNKNOWN',
      operation: 'NONE',
      domain: 'UNKNOWN',
      ambiguity: { present: true, clarificationRequired: true },
    });
  });

  it.each([
    ['', 'EMPTY_MESSAGE'],
    ['   ', 'EMPTY_MESSAGE'],
    ['🔥💪😊', 'UNSUPPORTED_CONTENT'],
  ] as const)(
    'returns a typed failure for non-lexical input',
    async (text, failure) => {
      await expect(
        service.understand(understandingInput(text)),
      ).resolves.toMatchObject({
        status: 'FAILED',
        failure,
        intent: 'UNKNOWN',
      });
    },
  );

  it.each([
    ['Estou com dor no peito', 'PAIN', 'HIGH'],
    ['Desmaiei durante o treino', 'INCAPACITY', 'HIGH'],
    ['Acho que tive uma fratura', 'INJURY', 'HIGH'],
    ['Estou com lesão no joelho', 'INJURY', 'MEDIUM'],
    ['Tenho pressão alta', 'MEDICAL', 'MEDIUM'],
    ['Tive hipoglicemia', 'MEDICAL', 'MEDIUM'],
    ['Estou grávida', 'MEDICAL', 'MEDIUM'],
    ['Uso medicamentos', 'MEDICAL', 'MEDIUM'],
    ['Tenho desidratação grave', 'MEDICAL', 'HIGH'],
  ] as const)(
    'detects safety without producing advice: %s',
    async (text, category, severity) => {
      const result = await service.understand(understandingInput(text));
      expect(result).toMatchObject({
        status: 'UNDERSTOOD',
        intent: 'GENERAL_GUIDANCE_REQUEST',
        operation: 'PROVIDE_GUIDANCE',
        domain: 'SAFETY',
        safety: {
          requiresSafeResponse: true,
          requiresProfessionalGuidance: true,
          medicalAdviceProhibited: true,
          signals: expect.arrayContaining([
            expect.objectContaining({ category, severity }),
          ]),
        },
      });
    },
  );

  it('normalizes accents, case, plural and Unicode deterministically', async () => {
    const variants = [
      'ATUALIZE MINHAS REFEIÇÕES DA DIETA',
      'atualize minhas refeições da dieta',
      'Atualize minhas refeições da dieta 😊',
    ];
    const results = await Promise.all(
      variants.map((text, index) =>
        service.understand(
          understandingInput(text, { messageId: `message-${index}` }),
        ),
      ),
    );
    for (const result of results) {
      expect(result).toMatchObject({
        intent: 'DIET_PLAN_UPDATE_REQUEST',
        operation: 'UPDATE_PLAN',
        domain: 'NUTRITION',
      });
    }
  });

  it('returns the same semantic result for the same text and context', async () => {
    const input = understandingInput('Monte meu plano alimentar semanal');
    const first = await service.understand(input);
    const second = await service.understand(input);
    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('keeps average deterministic processing below 5 ms', async () => {
    const input = understandingInput('Troque o frango dessa dieta');
    const startedAt = performance.now();
    for (let index = 0; index < 500; index += 1) {
      await service.understand(input);
    }
    expect((performance.now() - startedAt) / 500).toBeLessThan(5);
  });
});
