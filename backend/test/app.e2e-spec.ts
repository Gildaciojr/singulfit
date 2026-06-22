import { createHash, randomInt, randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, UnauthorizedException } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  ActivityLevel,
  ActivationRiskLevel,
  ActivationStage,
  AIJobStatus,
  AIJobType,
  AIResponseEvaluationType,
  AIResponseRiskLevel,
  AIReviewStatus,
  DietPlanStatus,
  EnergyLevel,
  FitnessGoal,
  Gender,
  InvoiceStatus,
  MealAnalysisStatus,
  MealCategory,
  MealSource,
  MemoryType,
  MessageDirection,
  MessageType,
  OutboundMessageStatus,
  OutboxStatus,
  PaymentProvider,
  PaymentStatus,
  PilotCohortStatus,
  PilotParticipantStatus,
  PlanType,
  Prisma,
  ResponseType,
  RecommendationCategory,
  RecommendationPriority,
  RecommendationStatus,
  ScheduledMessageStatus,
  SubscriptionStatus,
  UserRole,
  WorkoutStatus,
} from '@prisma/client';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { PAGBANK_PAYMENT_GATEWAY } from './../src/payments/gateways/payment-gateway.constants';
import { AIService } from './../src/ai/ai.service';
import { OpenAIGateway } from './../src/ai/openai.gateway';
import { PromptService } from './../src/ai/prompt.service';
import { EvolutionGateway } from './../src/evolution/evolution.gateway';
import { OutboxDispatcherService } from './../src/event-bus/outbox-dispatcher.service';
import { UsageLimitExceededException } from './../src/entitlements/usage-limit.exception';
import { AutomationService } from './../src/automation/automation.service';
import { AUTOMATION_RULE_CODES } from './../src/automation/automation.constants';
import { EventBusService } from './../src/event-bus/event-bus.service';
import { OutboxService } from './../src/event-bus/outbox.service';
import { RetentionService } from './../src/operations/retention.service';
import { BehavioralIntelligenceService } from './../src/behavior/behavioral-intelligence.service';
import { AIResponseEvaluationService } from './../src/ai-quality/ai-response-evaluation.service';
import { SubscriptionAccessService } from './../src/subscriptions/subscription-access.service';
import { ActivationJourneyService } from './../src/activation/activation-journey.service';
import { ActivationService } from './../src/activation/activation.service';
import { PilotService } from './../src/pilot/pilot.service';
import { PilotMetricsService } from './../src/pilot/pilot-metrics.service';
import { AnalyticsSnapshotService } from './../src/analytics/analytics-snapshot.service';
import { CoachIntelligenceService } from './../src/automation/coach-intelligence.service';

interface AuthResponse {
  user: {
    id: string;
    email: string;
  };
  tokens: {
    accessToken: string;
    refreshToken: string;
  };
}

interface RefreshResponse {
  tokens: {
    accessToken: string;
    refreshToken: string;
  };
}

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let createdUserId: string | undefined;
  let createdWebhookRequestId: string | undefined;
  let createdPromptVersionId: string | undefined;
  let createdPilotCohortId: string | undefined;
  let createdAnalyticsSnapshotDate: Date | undefined;
  let testStartedAt: Date;
  const webhookSecret = 'e2e-pagbank-webhook-secret';
  const evolutionWebhookSecret = 'e2e-evolution-webhook-secret';
  const mediaUploadPath = resolve('.tmp', 'media-storage-e2e');
  const gatewayExpiration = new Date(Date.now() + 30 * 60 * 1000);
  const paymentGateway = {
    provider: PaymentProvider.PAGBANK,
    createPixPayment: jest.fn().mockResolvedValue({
      providerOrderId: 'ORDE_E2E_TEST',
      providerPaymentId: 'QRCO_E2E_TEST',
      qrCode: '00020101021226860014br.gov.bcb.pix',
      qrCodeImageUrl: 'https://api.pagseguro.com/e2e-qrcode.png',
      expiresAt: gatewayExpiration,
    }),
    getPayment: jest.fn(),
  };
  const openAIGateway = {
    createTextResponse: jest.fn(),
    createVisionResponse: jest.fn(),
  };
  const evolutionGateway = {
    getInstanceName: jest.fn().mockReturnValue('singulfit'),
    getConnectionState: jest.fn(),
    validateWebhookSecret: jest.fn(),
    sendText: jest.fn(),
  };

  beforeAll(async () => {
    await rm(mediaUploadPath, {
      recursive: true,
      force: true,
    });
    process.env.PAGBANK_WEBHOOK_SECRET = webhookSecret;
    process.env.SUBSCRIPTION_GRACE_PERIOD_DAYS = '3';
    process.env.EVOLUTION_BASE_URL = 'https://evolution.example.com';
    process.env.EVOLUTION_API_KEY = 'e2e-evolution-api-key';
    process.env.EVOLUTION_INSTANCE_NAME = 'singulfit';
    process.env.EVOLUTION_WEBHOOK_SECRET = evolutionWebhookSecret;
    process.env.OPENAI_API_KEY = 'e2e-openai-api-key';
    process.env.OPENAI_MODEL_TEXT = 'e2e-text-model';
    process.env.OPENAI_MODEL_VISION = 'e2e-vision-model';
    process.env.OPENAI_TEXT_INPUT_COST_PER_1M_USD = '0.15';
    process.env.OPENAI_TEXT_OUTPUT_COST_PER_1M_USD = '0.60';
    process.env.OPENAI_VISION_INPUT_COST_PER_1M_USD = '2.50';
    process.env.OPENAI_VISION_OUTPUT_COST_PER_1M_USD = '10.00';
    process.env.UPLOAD_PATH = mediaUploadPath;
    process.env.MAX_IMAGE_SIZE_MB = '10';
    process.env.MAX_AUDIO_SIZE_MB = '25';
    process.env.MAX_DOCUMENT_SIZE_MB = '25';
    process.env.OUTBOX_RETENTION_DAYS = '3650';
    process.env.WEBHOOK_RETENTION_DAYS = '3650';
    process.env.SYSTEM_EVENT_RETENTION_DAYS = '3650';
    process.env.AUDIT_RETENTION_DAYS = '3650';
  });

  beforeEach(async () => {
    testStartedAt = new Date();
    paymentGateway.createPixPayment.mockClear();
    paymentGateway.getPayment.mockReset();
    openAIGateway.createTextResponse.mockReset().mockResolvedValue({
      responseId: 'resp_e2e_ai',
      model: 'e2e-text-model',
      outputText: 'Resposta interna de teste',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
    openAIGateway.createVisionResponse.mockReset();
    evolutionGateway.getInstanceName.mockReturnValue('singulfit');
    evolutionGateway.validateWebhookSecret
      .mockReset()
      .mockImplementation((secret: string | undefined) => {
        if (secret !== evolutionWebhookSecret) {
          throw new UnauthorizedException('Webhook Evolution não autorizado');
        }
      });
    evolutionGateway.sendText.mockReset().mockResolvedValue({
      externalMessageId: 'wamid-outbound-e2e',
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PAGBANK_PAYMENT_GATEWAY)
      .useValue(paymentGateway)
      .overrideProvider(OpenAIGateway)
      .useValue(openAIGateway)
      .overrideProvider(EvolutionGateway)
      .useValue(evolutionGateway)
      .compile();

    app = moduleFixture.createNestApplication({
      rawBody: true,
    });
    await app.init();
    prisma = app.get(PrismaService);
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.objectContaining({
            message: 'Backend funcionando',
            plans: expect.any(Array),
          }),
        );
      });
  });

  it('/api/v1/auth/me (GET) requires an access token', () => {
    return request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
  });

  it('blocks public access to internal user routes', async () => {
    await request(app.getHttpServer())
      .post('/users/find-or-create')
      .send({})
      .expect(401);

    await request(app.getHttpServer()).post('/users/use').send({}).expect(401);
  });

  it('claims outbox events atomically and recovers an expired lease', async () => {
    const eventBus = app.get(EventBusService);
    const outboxService = app.get(OutboxService);
    const aggregateId = randomUUID();
    const published = await eventBus.publish({
      eventType: 'E2E_ATOMIC_CLAIM',
      aggregateType: 'E2E',
      aggregateId,
      payload: {
        aggregateId,
      },
    });
    const now = new Date();
    const [firstClaim, secondClaim] = await Promise.all([
      outboxService.claimBatch(now),
      outboxService.claimBatch(now),
    ]);
    const claimed = [...firstClaim, ...secondClaim].filter(
      (event) => event.id === published.id,
    );

    expect(claimed).toHaveLength(1);
    await expect(outboxService.markProcessed(claimed[0])).resolves.toBe(true);

    const stale = await prisma.outboxEvent.create({
      data: {
        eventType: 'E2E_STALE_LEASE',
        aggregateType: 'E2E',
        aggregateId: randomUUID(),
        payload: {
          stale: true,
        },
        status: OutboxStatus.PROCESSING,
        attempts: 1,
        claimedAt: new Date(now.getTime() - 10 * 60 * 1000),
      },
    });
    const recovered = await outboxService.claimBatch(now);

    expect(recovered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: stale.id,
          previousStatus: OutboxStatus.PROCESSING,
        }),
      ]),
    );
    await expect(
      prisma.systemEvent.findFirst({
        where: {
          source: 'OUTBOX',
          eventType: 'LEASE_EXPIRED',
          metadata: {
            path: ['outboxEventId'],
            equals: stale.id,
          },
        },
      }),
    ).resolves.toEqual(expect.objectContaining({ severity: 'WARNING' }));

    const retryable = await prisma.outboxEvent.create({
      data: {
        eventType: 'E2E_RETRY_EXECUTED',
        aggregateType: 'E2E',
        aggregateId: randomUUID(),
        payload: {
          retry: true,
        },
        status: OutboxStatus.FAILED,
        attempts: 1,
        availableAt: now,
        failedAt: new Date(now.getTime() - 1_000),
      },
    });

    await outboxService.claimBatch(now, [retryable.eventType]);
    await expect(
      prisma.systemEvent.findFirst({
        where: {
          source: 'OUTBOX',
          eventType: 'RETRY_EXECUTED',
          metadata: {
            path: ['outboxEventId'],
            equals: retryable.id,
          },
        },
      }),
    ).resolves.toEqual(expect.objectContaining({ severity: 'INFO' }));
  });

  it('isolates concurrent claims by dedicated worker responsibility', async () => {
    const eventBus = app.get(EventBusService);
    const outboxService = app.get(OutboxService);
    const published = await Promise.all([
      eventBus.publish({
        eventType: 'MEDIA_RECEIVED',
        aggregateType: 'MEDIA_FILE',
        aggregateId: randomUUID(),
        payload: { mediaFileId: randomUUID() },
      }),
      eventBus.publish({
        eventType: 'AUTOMATION_TRIGGERED',
        aggregateType: 'SCHEDULED_MESSAGE',
        aggregateId: randomUUID(),
        payload: { scheduledMessageId: randomUUID() },
      }),
      eventBus.publish({
        eventType: 'PAYMENT_APPROVED',
        aggregateType: 'PAYMENT',
        aggregateId: randomUUID(),
        payload: { paymentId: randomUUID() },
      }),
    ]);
    const now = new Date();
    const [ai, automation, outbox] = await Promise.all([
      outboxService.claimBatch(now, ['MEDIA_RECEIVED']),
      outboxService.claimBatch(now, ['AUTOMATION_TRIGGERED']),
      outboxService.claimBatch(now, ['PAYMENT_APPROVED']),
    ]);
    const claimedIds = [...ai, ...automation, ...outbox]
      .filter((event) => published.some(({ id }) => id === event.id))
      .map(({ id }) => id);

    expect(new Set(claimedIds)).toEqual(new Set(published.map(({ id }) => id)));
    expect(claimedIds).toHaveLength(3);
  });

  it('claims a loaded queue across multiple workers without duplicates', async () => {
    const outboxService = app.get(OutboxService);
    const eventType = 'E2E_LOAD_CLAIM';
    const aggregateIds = Array.from({ length: 80 }, () => randomUUID());

    await prisma.outboxEvent.createMany({
      data: aggregateIds.map((aggregateId) => ({
        eventType,
        aggregateType: 'E2E',
        aggregateId,
        payload: {
          aggregateId,
        },
      })),
    });
    const claims = await Promise.all(
      Array.from({ length: 8 }, () =>
        outboxService.claimBatch(new Date(), [eventType]),
      ),
    );
    const claimed = claims.flat();

    expect(claimed).toHaveLength(80);
    expect(new Set(claimed.map(({ id }) => id)).size).toBe(80);
    expect(claimed.every((event) => event.eventType === eventType)).toBe(true);
  });

  it('deletes only finalized records after their retention window', async () => {
    const retentionService = app.get(RetentionService);
    const old = new Date(Date.now() - 3_651 * 86_400_000);

    await prisma.systemEvent.deleteMany({
      where: {
        source: 'OPERATIONS',
        eventType: 'CLEANUP_EXECUTED',
      },
    });
    const [processedOutbox, failedOutbox, deadOutbox] = await Promise.all([
      prisma.outboxEvent.create({
        data: {
          eventType: 'E2E_RETENTION_PROCESSED',
          aggregateType: 'E2E',
          aggregateId: randomUUID(),
          payload: {},
          status: OutboxStatus.PROCESSED,
          processedAt: old,
          createdAt: old,
        },
      }),
      prisma.outboxEvent.create({
        data: {
          eventType: 'E2E_RETENTION_FAILED',
          aggregateType: 'E2E',
          aggregateId: randomUUID(),
          payload: {},
          status: OutboxStatus.FAILED,
          failedAt: old,
          createdAt: old,
        },
      }),
      prisma.outboxEvent.create({
        data: {
          eventType: 'E2E_RETENTION_DEAD',
          aggregateType: 'E2E',
          aggregateId: randomUUID(),
          payload: {},
          status: OutboxStatus.DEAD_LETTER,
          failedAt: old,
          createdAt: old,
        },
      }),
    ]);
    const [processedWebhook, failedWebhook] = await Promise.all([
      prisma.webhookEvent.create({
        data: {
          provider: PaymentProvider.PAGBANK,
          eventKey: `retention-processed-${randomUUID()}`,
          signatureValid: true,
          payload: {},
          status: 'PROCESSED',
          processedAt: old,
          receivedAt: old,
          createdAt: old,
        },
      }),
      prisma.webhookEvent.create({
        data: {
          provider: PaymentProvider.PAGBANK,
          eventKey: `retention-failed-${randomUUID()}`,
          signatureValid: true,
          payload: {},
          status: 'FAILED',
          receivedAt: old,
          createdAt: old,
        },
      }),
    ]);
    const oldSystemEvent = await prisma.systemEvent.create({
      data: {
        source: 'E2E',
        severity: 'INFO',
        eventType: 'RETENTION_OLD',
        message: 'Evento antigo',
        createdAt: old,
      },
    });
    const oldAuditLog = await prisma.auditLog.create({
      data: {
        action: 'RETENTION_OLD',
        entityType: 'E2E',
        entityId: randomUUID(),
        createdAt: old,
      },
    });

    const result = await retentionService.runIfDue();

    expect(result).toEqual(
      expect.objectContaining({
        outbox: expect.any(Number),
        webhooks: expect.any(Number),
        systemEvents: expect.any(Number),
        auditLogs: expect.any(Number),
      }),
    );
    await expect(
      prisma.systemEvent.findFirst({
        where: {
          source: 'OPERATIONS',
          eventType: 'CLEANUP_EXECUTED',
        },
      }),
    ).resolves.toEqual(expect.objectContaining({ severity: 'INFO' }));
    await expect(
      prisma.outboxEvent.findUnique({ where: { id: processedOutbox.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.webhookEvent.findUnique({ where: { id: processedWebhook.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.systemEvent.findUnique({ where: { id: oldSystemEvent.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.auditLog.findUnique({ where: { id: oldAuditLog.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.outboxEvent.findUnique({ where: { id: failedOutbox.id } }),
    ).resolves.toEqual(
      expect.objectContaining({ status: OutboxStatus.FAILED }),
    );
    await expect(
      prisma.outboxEvent.findUnique({ where: { id: deadOutbox.id } }),
    ).resolves.toEqual(
      expect.objectContaining({ status: OutboxStatus.DEAD_LETTER }),
    );
    await expect(
      prisma.webhookEvent.findUnique({ where: { id: failedWebhook.id } }),
    ).resolves.toEqual(expect.objectContaining({ status: 'FAILED' }));

    await prisma.outboxEvent.deleteMany({
      where: { id: { in: [failedOutbox.id, deadOutbox.id] } },
    });
    await prisma.webhookEvent.delete({ where: { id: failedWebhook.id } });
    await prisma.systemEvent.deleteMany({
      where: {
        source: 'OPERATIONS',
        eventType: 'CLEANUP_EXECUTED',
      },
    });
  });

  it('protects and serves operational metrics and health to admins', async () => {
    const uniqueId = randomUUID().replaceAll('-', '');
    const email = `operations-${uniqueId}@singulfit.test`;
    const phone = `119${randomInt(10_000_000, 100_000_000)}`;
    const registrationResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'Operations Admin',
        phone,
        email,
        password: 'SingulFit#Secure123',
        planType: PlanType.BASIC,
      })
      .expect(201);
    const registration = registrationResponse.body as AuthResponse;
    createdUserId = registration.user.id;

    await request(app.getHttpServer()).get('/api/v1/admin/metrics').expect(401);
    await prisma.user.update({
      where: {
        id: createdUserId,
      },
      data: {
        role: UserRole.ADMIN,
      },
    });
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email,
        password: 'SingulFit#Secure123',
      })
      .expect(201);
    const admin = loginResponse.body as AuthResponse;
    const authorization = `Bearer ${admin.tokens.accessToken}`;

    await request(app.getHttpServer())
      .get('/api/v1/admin/metrics')
      .set('Authorization', authorization)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.objectContaining({
            outbox: expect.any(Object),
            webhooks: expect.any(Object),
            ai: expect.any(Object),
            automation: expect.any(Object),
            evolution: expect.any(Object),
          }),
        );
      });
    await request(app.getHttpServer())
      .get('/api/v1/admin/outbox/stats')
      .set('Authorization', authorization)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.objectContaining({
            pending: expect.any(Number),
            deadLetter: expect.any(Number),
          }),
        );
      });
    await request(app.getHttpServer())
      .get('/api/v1/admin/webhooks/stats')
      .set('Authorization', authorization)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/admin/system-events/stats')
      .set('Authorization', authorization)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/admin/health')
      .set('Authorization', authorization)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.objectContaining({
            database: expect.any(Object),
            outbox: expect.any(Object),
            workers: expect.any(Object),
            webhooks: expect.any(Object),
            evolution: expect.any(Object),
            ai: expect.any(Object),
          }),
        );
      });
  });

  it('manages fitness onboarding, profile and measurements for eligible subscriptions', async () => {
    const uniqueId = randomUUID().replaceAll('-', '');
    const email = `profile-${uniqueId}@singulfit.test`;
    const phone = `119${randomInt(10_000_000, 100_000_000)}`;
    const registrationResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'Perfil Fitness',
        phone,
        email,
        password: 'SingulFit#Secure123',
        planType: PlanType.BASIC,
      })
      .expect(201);
    const registration = registrationResponse.body as AuthResponse;
    createdUserId = registration.user.id;
    const accessToken = registration.tokens.accessToken;
    const subscription = await prisma.subscription.findFirstOrThrow({
      where: {
        userId: createdUserId,
      },
    });
    const now = new Date();

    await prisma.subscription.update({
      where: {
        id: subscription.id,
      },
      data: {
        status: SubscriptionStatus.ACTIVE,
        startedAt: now,
        billingPeriodStart: now,
        billingPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    await request(app.getHttpServer()).get('/api/v1/profile').expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/profile/onboarding')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual({
          status: 'PROFILE_INCOMPLETE',
          completed: false,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
        });
      });

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        gender: Gender.FEMALE,
        birthDate: '1994-03-12',
        heightCm: 168,
        currentWeightKg: 72.4,
        targetWeightKg: 64,
        activityLevel: ActivityLevel.MODERATE,
        goal: FitnessGoal.WEIGHT_LOSS,
        foodRestrictions: [
          {
            type: 'INTOLERANCE',
            description: 'Lactose',
          },
        ],
        injuryRestrictions: [
          {
            description: 'Sensibilidade no joelho direito',
          },
        ],
      })
      .expect(201);

    expect(createResponse.body).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        userId: createdUserId,
        gender: Gender.FEMALE,
        heightCm: 168,
        activityLevel: ActivityLevel.MODERATE,
        goal: FitnessGoal.WEIGHT_LOSS,
        foodRestrictions: [
          expect.objectContaining({
            type: 'INTOLERANCE',
            description: 'Lactose',
          }),
        ],
        injuryRestrictions: [
          expect.objectContaining({
            description: 'Sensibilidade no joelho direito',
          }),
        ],
      }),
    );

    await request(app.getHttpServer())
      .post('/api/v1/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        gender: Gender.FEMALE,
        birthDate: '1994-03-12',
        heightCm: 168,
        currentWeightKg: 72.4,
        targetWeightKg: 64,
        activityLevel: ActivityLevel.MODERATE,
        goal: FitnessGoal.WEIGHT_LOSS,
      })
      .expect(409);

    await request(app.getHttpServer())
      .get('/api/v1/profile/onboarding')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.status).toBe('PROFILE_COMPLETE');
        expect(response.body.completed).toBe(true);
      });
    expect(
      await prisma.user.findUniqueOrThrow({
        where: {
          id: createdUserId,
        },
        select: {
          onboardingCompleted: true,
        },
      }),
    ).toEqual({
      onboardingCompleted: true,
    });

    await prisma.subscription.update({
      where: {
        id: subscription.id,
      },
      data: {
        status: SubscriptionStatus.PAST_DUE,
      },
    });

    await request(app.getHttpServer())
      .patch('/api/v1/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        targetWeightKg: 62.5,
        activityLevel: ActivityLevel.HIGH,
        foodRestrictions: [],
      })
      .expect(200)
      .expect((response) => {
        expect(response.body.activityLevel).toBe(ActivityLevel.HIGH);
        expect(response.body.foodRestrictions).toEqual([]);
      });

    const measuredAt = '2026-06-09T12:00:00.000Z';
    openAIGateway.createTextResponse.mockResolvedValueOnce({
      responseId: 'resp-progress-baseline',
      model: 'e2e-text-model',
      outputText: JSON.stringify({
        insight: 'Esta medição inicia sua linha de base de progresso.',
      }),
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
    });
    const measurementResponse = await request(app.getHttpServer())
      .post('/api/v1/profile/measurements')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        weightKg: 70.8,
        bodyFatPercent: 24.5,
        muscleMassKg: 28.2,
        measuredAt,
      })
      .expect(201);

    expect(measurementResponse.body).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        profileId: createResponse.body.id,
        measuredAt,
      }),
    );

    await request(app.getHttpServer())
      .get('/api/v1/profile/measurements')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toHaveLength(1);
        expect(response.body[0].id).toBe(measurementResponse.body.id);
      });
    const persistedProfile = await prisma.fitnessProfile.findUniqueOrThrow({
      where: {
        userId: createdUserId,
      },
    });

    expect(persistedProfile.currentWeightKg.toNumber()).toBe(70.8);
    const persistedSnapshot = await prisma.progressSnapshot.findFirstOrThrow({
      where: {
        userId: createdUserId,
      },
      include: {
        insights: true,
      },
    });

    expect(persistedSnapshot).toEqual(
      expect.objectContaining({
        profileId: createResponse.body.id,
        createdAt: new Date(measuredAt),
      }),
    );
    expect(persistedSnapshot.weightKg.toNumber()).toBe(70.8);
    expect(persistedSnapshot.bodyFatPercent?.toNumber()).toBe(24.5);
    expect(persistedSnapshot.muscleMassKg?.toNumber()).toBe(28.2);
    expect(persistedSnapshot.bmi.toNumber()).toBe(25.09);
    expect(persistedSnapshot.insights).toEqual([
      expect.objectContaining({
        userId: createdUserId,
        insight: 'Esta medição inicia sua linha de base de progresso.',
      }),
    ]);
    expect(openAIGateway.createTextResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        jsonSchema: expect.objectContaining({
          name: 'progress_insight',
        }),
      }),
    );

    await request(app.getHttpServer())
      .post('/api/v1/progress/check-ins')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        mood: 'Motivada',
        energyLevel: EnergyLevel.HIGH,
        adherenceScore: 88,
        notes: 'Mantive a rotina durante a semana',
      })
      .expect(201)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.objectContaining({
            userId: createdUserId,
            profileId: createResponse.body.id,
            mood: 'Motivada',
            energyLevel: EnergyLevel.HIGH,
            adherenceScore: 88,
          }),
        );
      });

    await request(app.getHttpServer())
      .get('/api/v1/progress/check-ins')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toHaveLength(1);
        expect(response.body[0].mood).toBe('Motivada');
      });

    await request(app.getHttpServer())
      .get('/api/v1/progress')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toHaveLength(1);
        expect(response.body[0]).toEqual(
          expect.objectContaining({
            id: persistedSnapshot.id,
            insights: [
              expect.objectContaining({
                insight: 'Esta medição inicia sua linha de base de progresso.',
              }),
            ],
          }),
        );
      });

    await request(app.getHttpServer())
      .get('/api/v1/progress/insights')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toHaveLength(1);
        expect(response.body[0].snapshot.id).toBe(persistedSnapshot.id);
      });

    await prisma.subscription.update({
      where: {
        id: subscription.id,
      },
      data: {
        status: SubscriptionStatus.CANCELED,
      },
    });

    await request(app.getHttpServer())
      .get('/api/v1/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/progress')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
  });

  it('generates and persists structured workout history from the fitness profile', async () => {
    const uniqueId = randomUUID().replaceAll('-', '');
    const email = `workout-${uniqueId}@singulfit.test`;
    const phone = `119${randomInt(10_000_000, 100_000_000)}`;
    const registrationResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'Workout Engine',
        phone,
        email,
        password: 'SingulFit#Secure123',
        planType: PlanType.PREMIUM,
      })
      .expect(201);
    const registration = registrationResponse.body as AuthResponse;
    createdUserId = registration.user.id;
    const accessToken = registration.tokens.accessToken;
    const subscription = await prisma.subscription.findFirstOrThrow({
      where: {
        userId: createdUserId,
      },
    });
    const now = new Date();

    await prisma.subscription.update({
      where: {
        id: subscription.id,
      },
      data: {
        status: SubscriptionStatus.ACTIVE,
        startedAt: now,
        billingPeriodStart: now,
        billingPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    const profile = await prisma.fitnessProfile.create({
      data: {
        userId: createdUserId,
        gender: Gender.MALE,
        birthDate: new Date('1990-08-15T00:00:00.000Z'),
        heightCm: 178,
        currentWeightKg: new Prisma.Decimal('82.00'),
        targetWeightKg: new Prisma.Decimal('88.00'),
        activityLevel: ActivityLevel.HIGH,
        goal: FitnessGoal.MUSCLE_GAIN,
        injuryRestrictions: {
          create: {
            description: 'Evitar impacto excessivo no ombro esquerdo',
          },
        },
        bodyMeasurements: {
          create: {
            weightKg: new Prisma.Decimal('82.00'),
            bodyFatPercent: new Prisma.Decimal('16.50'),
            muscleMassKg: new Prisma.Decimal('39.00'),
            measuredAt: new Date('2026-06-09T10:00:00.000Z'),
          },
        },
      },
    });
    const workoutResponse = (title: string, exerciseName: string) => ({
      responseId: `response-${title}`,
      model: 'e2e-text-model',
      outputText: JSON.stringify({
        title,
        days: [
          {
            dayNumber: 1,
            title: 'Peito e tríceps',
            exercises: [
              {
                exerciseName,
                sets: 4,
                reps: '8-12',
                restSeconds: 90,
                notes: 'Interromper se houver dor no ombro',
              },
            ],
          },
          {
            dayNumber: 2,
            title: 'Pernas',
            exercises: [
              {
                exerciseName: 'Leg press',
                sets: 4,
                reps: '10-12',
                restSeconds: 120,
                notes: null,
              },
            ],
          },
        ],
      }),
      promptTokens: 400,
      completionTokens: 250,
      totalTokens: 650,
    });

    openAIGateway.createTextResponse
      .mockResolvedValueOnce(workoutResponse('Hipertrofia inicial', 'Supino'))
      .mockResolvedValueOnce(
        workoutResponse('Hipertrofia atualizada', 'Supino com halteres'),
      );

    await request(app.getHttpServer())
      .post('/api/v1/workouts/generate')
      .expect(401);

    const firstGeneration = await request(app.getHttpServer())
      .post('/api/v1/workouts/generate')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    expect(firstGeneration.body).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        userId: createdUserId,
        profileId: profile.id,
        title: 'Hipertrofia inicial',
        objective: FitnessGoal.MUSCLE_GAIN,
        status: WorkoutStatus.ACTIVE,
        days: [
          expect.objectContaining({
            dayNumber: 1,
            exercises: [
              expect.objectContaining({
                exerciseName: 'Supino',
                sets: 4,
                reps: '8-12',
                restSeconds: 90,
              }),
            ],
          }),
          expect.objectContaining({
            dayNumber: 2,
          }),
        ],
      }),
    );
    expect(openAIGateway.createTextResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining('hipertrofia'),
        jsonSchema: expect.objectContaining({
          name: 'personalized_workout_plan',
        }),
      }),
    );
    const firstOpenAIRequest = openAIGateway.createTextResponse.mock
      .calls[0][0] as {
      input: string;
    };

    expect(JSON.parse(firstOpenAIRequest.input)).toEqual(
      expect.objectContaining({
        profile: expect.objectContaining({
          goal: FitnessGoal.MUSCLE_GAIN,
          activityLevel: ActivityLevel.HIGH,
        }),
        restrictions: expect.objectContaining({
          injuries: ['Evitar impacto excessivo no ombro esquerdo'],
        }),
        measurements: [
          expect.objectContaining({
            weightKg: 82,
            bodyFatPercent: 16.5,
            muscleMassKg: 39,
          }),
        ],
      }),
    );

    await prisma.subscription.update({
      where: {
        id: subscription.id,
      },
      data: {
        status: SubscriptionStatus.PAST_DUE,
      },
    });

    const secondGeneration = await request(app.getHttpServer())
      .post('/api/v1/workouts/generate')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    expect(secondGeneration.body).toEqual(
      expect.objectContaining({
        title: 'Hipertrofia atualizada',
        status: WorkoutStatus.ACTIVE,
      }),
    );

    await request(app.getHttpServer())
      .get(`/api/v1/workouts/${secondGeneration.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.id).toBe(secondGeneration.body.id);
        expect(response.body.days).toHaveLength(2);
      });

    await request(app.getHttpServer())
      .get('/api/v1/workouts/current')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.id).toBe(secondGeneration.body.id);
      });

    await request(app.getHttpServer())
      .get('/api/v1/workouts/history')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toHaveLength(2);
        expect(response.body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: firstGeneration.body.id,
              status: WorkoutStatus.ARCHIVED,
            }),
            expect.objectContaining({
              id: secondGeneration.body.id,
              status: WorkoutStatus.ACTIVE,
            }),
          ]),
        );
      });
    expect(
      await prisma.workoutPlan.count({
        where: {
          userId: createdUserId,
          status: WorkoutStatus.ACTIVE,
        },
      }),
    ).toBe(1);

    await prisma.subscription.update({
      where: {
        id: subscription.id,
      },
      data: {
        status: SubscriptionStatus.CANCELED,
      },
    });

    await request(app.getHttpServer())
      .post('/api/v1/workouts/generate')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    expect(openAIGateway.createTextResponse).toHaveBeenCalledTimes(2);
  });

  it('generates a personalized diet with history, restrictions and AI usage', async () => {
    const uniqueId = randomUUID().replaceAll('-', '');
    const email = `diet-${uniqueId}@singulfit.test`;
    const phone = `119${randomInt(10_000_000, 100_000_000)}`;
    const registrationResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'Diet Engine',
        phone,
        email,
        password: 'SingulFit#Secure123',
        planType: PlanType.PREMIUM,
      })
      .expect(201);
    const registration = registrationResponse.body as AuthResponse;
    createdUserId = registration.user.id;
    const accessToken = registration.tokens.accessToken;
    const subscription = await prisma.subscription.findFirstOrThrow({
      where: {
        userId: createdUserId,
      },
    });
    const now = new Date();

    await prisma.subscription.update({
      where: {
        id: subscription.id,
      },
      data: {
        status: SubscriptionStatus.ACTIVE,
        startedAt: now,
        billingPeriodStart: now,
        billingPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    const profile = await prisma.fitnessProfile.create({
      data: {
        userId: createdUserId,
        gender: Gender.FEMALE,
        birthDate: new Date('1993-06-15T00:00:00.000Z'),
        heightCm: 165,
        currentWeightKg: new Prisma.Decimal('70.00'),
        targetWeightKg: new Prisma.Decimal('62.00'),
        activityLevel: ActivityLevel.MODERATE,
        goal: FitnessGoal.WEIGHT_LOSS,
        foodRestrictions: {
          create: {
            type: 'INTOLERANCE',
            description: 'Lactose',
          },
        },
        bodyMeasurements: {
          create: {
            weightKg: new Prisma.Decimal('70.00'),
            bodyFatPercent: new Prisma.Decimal('25.00'),
            muscleMassKg: new Prisma.Decimal('27.00'),
            measuredAt: new Date('2026-06-08T10:00:00.000Z'),
          },
        },
        progressSnapshots: {
          create: {
            userId: createdUserId,
            weightKg: new Prisma.Decimal('70.00'),
            bodyFatPercent: new Prisma.Decimal('25.00'),
            muscleMassKg: new Prisma.Decimal('27.00'),
            bmi: new Prisma.Decimal('25.71'),
            createdAt: new Date('2026-06-08T10:00:00.000Z'),
            insights: {
              create: {
                userId: createdUserId,
                insight: 'Você perdeu 2 kg nos últimos 30 dias.',
              },
            },
          },
        },
      },
    });

    await prisma.meal.create({
      data: {
        userId: createdUserId,
        source: MealSource.UPLOAD,
        analysis: {
          create: {
            status: MealAnalysisStatus.COMPLETED,
            confidence: new Prisma.Decimal('0.9000'),
            totalCalories: new Prisma.Decimal('610.00'),
            totalProtein: new Prisma.Decimal('42.00'),
            totalCarbs: new Prisma.Decimal('72.00'),
            totalFat: new Prisma.Decimal('17.00'),
            rawResponse: {
              source: 'e2e-diet-history',
            },
            items: {
              create: {
                foodName: 'Arroz, feijão e frango',
                estimatedGrams: new Prisma.Decimal('350.00'),
                calories: new Prisma.Decimal('610.00'),
                protein: new Prisma.Decimal('42.00'),
                carbs: new Prisma.Decimal('72.00'),
                fat: new Prisma.Decimal('17.00'),
              },
            },
          },
        },
      },
    });
    await prisma.workoutPlan.create({
      data: {
        userId: createdUserId,
        profileId: profile.id,
        title: 'Treino ativo para emagrecimento',
        objective: FitnessGoal.WEIGHT_LOSS,
        status: WorkoutStatus.ACTIVE,
        days: {
          create: {
            dayNumber: 1,
            title: 'Força geral',
            exercises: {
              create: {
                exerciseName: 'Agachamento',
                sets: 3,
                reps: '10-12',
                restSeconds: 60,
              },
            },
          },
        },
      },
    });
    const dietResponse = (title: string, breakfast: string) => ({
      responseId: `response-${title}`,
      model: 'e2e-text-model',
      outputText: JSON.stringify({
        title,
        dailyCaloriesTarget: 1850,
        proteinTarget: 130,
        carbsTarget: 205,
        fatTarget: 55,
        meals: [
          {
            name: 'Café da manhã',
            order: 1,
            caloriesTarget: 430,
            notes: 'Sem ingredientes com lactose',
            items: [
              {
                foodName: breakfast,
                quantity: '1 porção',
                calories: 360,
                protein: 22,
                carbs: 42,
                fat: 12,
                substitutionGroup:
                  'Substituir por cuscuz com ovos na mesma porção',
              },
            ],
          },
          {
            name: 'Almoço',
            order: 2,
            caloriesTarget: 620,
            notes: null,
            items: [
              {
                foodName: 'Arroz, feijão, frango e salada',
                quantity: '1 prato médio',
                calories: 590,
                protein: 46,
                carbs: 68,
                fat: 15,
                substitutionGroup: null,
              },
            ],
          },
        ],
      }),
      promptTokens: 500,
      completionTokens: 300,
      totalTokens: 800,
    });

    openAIGateway.createTextResponse
      .mockResolvedValueOnce(
        dietResponse('Dieta brasileira inicial', 'Tapioca com ovos'),
      )
      .mockResolvedValueOnce(
        dietResponse('Dieta brasileira atualizada', 'Cuscuz com ovos'),
      );

    await request(app.getHttpServer())
      .post('/api/v1/diets/generate')
      .expect(401);

    const firstGeneration = await request(app.getHttpServer())
      .post('/api/v1/diets/generate')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    expect(firstGeneration.body).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        userId: createdUserId,
        profileId: profile.id,
        title: 'Dieta brasileira inicial',
        objective: FitnessGoal.WEIGHT_LOSS,
        status: DietPlanStatus.ACTIVE,
        meals: [
          expect.objectContaining({
            name: 'Café da manhã',
            order: 1,
            items: [
              expect.objectContaining({
                foodName: 'Tapioca com ovos',
                substitutionGroup:
                  'Substituir por cuscuz com ovos na mesma porção',
              }),
            ],
          }),
          expect.objectContaining({
            name: 'Almoço',
            order: 2,
          }),
        ],
        aiJob: expect.objectContaining({
          type: AIJobType.DIET,
          status: AIJobStatus.COMPLETED,
          usage: [
            expect.objectContaining({
              model: 'e2e-text-model',
              promptTokens: 500,
              completionTokens: 300,
              totalTokens: 800,
              costCurrency: 'USD',
            }),
          ],
        }),
      }),
    );
    const firstDietRequest = openAIGateway.createTextResponse.mock
      .calls[0][0] as {
      input: string;
    };
    const firstDietContext = JSON.parse(firstDietRequest.input) as {
      foodRestrictions: Array<{ description: string }>;
      nutritionHistory: Array<{ totalCalories: number }>;
      progress: Array<{ insights: string[] }>;
      currentWorkout: { title: string };
    };

    expect(firstDietContext.foodRestrictions).toEqual([
      expect.objectContaining({
        description: 'Lactose',
      }),
    ]);
    expect(firstDietContext.nutritionHistory[0].totalCalories).toBe(610);
    expect(firstDietContext.progress[0].insights).toEqual([
      'Você perdeu 2 kg nos últimos 30 dias.',
    ]);
    expect(firstDietContext.currentWorkout.title).toBe(
      'Treino ativo para emagrecimento',
    );

    await prisma.subscription.update({
      where: {
        id: subscription.id,
      },
      data: {
        status: SubscriptionStatus.PAST_DUE,
      },
    });

    const secondGeneration = await request(app.getHttpServer())
      .post('/api/v1/diets/generate')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .get('/api/v1/diets/current')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.id).toBe(secondGeneration.body.id);
      });

    await request(app.getHttpServer())
      .get(`/api/v1/diets/${secondGeneration.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.meals).toHaveLength(2);
        expect(response.body.aiJob.usage).toHaveLength(1);
      });

    await request(app.getHttpServer())
      .get('/api/v1/diets/history')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toHaveLength(2);
        expect(response.body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: firstGeneration.body.id,
              status: DietPlanStatus.ARCHIVED,
            }),
            expect.objectContaining({
              id: secondGeneration.body.id,
              status: DietPlanStatus.ACTIVE,
            }),
          ]),
        );
      });
    expect(
      await prisma.dietPlan.count({
        where: {
          userId: createdUserId,
          status: DietPlanStatus.ACTIVE,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.aIUsage.count({
        where: {
          userId: createdUserId,
          aiJob: {
            type: AIJobType.DIET,
          },
        },
      }),
    ).toBe(2);

    await prisma.subscription.update({
      where: {
        id: subscription.id,
      },
      data: {
        status: SubscriptionStatus.EXPIRED,
      },
    });

    await request(app.getHttpServer())
      .post('/api/v1/diets/generate')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    expect(openAIGateway.createTextResponse).toHaveBeenCalledTimes(2);
  });

  it('manages automation preferences, personalized schedules and Evolution dispatch', async () => {
    const uniqueId = randomUUID().replaceAll('-', '');
    const email = `automation-${uniqueId}@singulfit.test`;
    const phone = `119${randomInt(10_000_000, 100_000_000)}`;
    const registrationResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'Coach Automation',
        phone,
        email,
        password: 'SingulFit#Secure123',
        planType: PlanType.BASIC,
      })
      .expect(201);
    const registration = registrationResponse.body as AuthResponse;
    createdUserId = registration.user.id;
    const accessToken = registration.tokens.accessToken;
    const subscription = await prisma.subscription.findFirstOrThrow({
      where: {
        userId: createdUserId,
      },
    });
    const now = new Date();

    await prisma.subscription.update({
      where: {
        id: subscription.id,
      },
      data: {
        status: SubscriptionStatus.ACTIVE,
        startedAt: now,
        billingPeriodStart: now,
        billingPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    const profile = await prisma.fitnessProfile.create({
      data: {
        userId: createdUserId,
        gender: Gender.FEMALE,
        birthDate: new Date('1992-04-12T00:00:00.000Z'),
        heightCm: 165,
        currentWeightKg: new Prisma.Decimal('70.00'),
        targetWeightKg: new Prisma.Decimal('62.00'),
        activityLevel: ActivityLevel.MODERATE,
        goal: FitnessGoal.WEIGHT_LOSS,
      },
    });

    await prisma.workoutPlan.create({
      data: {
        userId: createdUserId,
        profileId: profile.id,
        title: 'Treino ativo do coach',
        objective: FitnessGoal.WEIGHT_LOSS,
        status: WorkoutStatus.ACTIVE,
        days: {
          create: {
            dayNumber: now.getUTCDay() || 7,
            title: 'Treino de força',
            exercises: {
              create: {
                exerciseName: 'Agachamento',
                sets: 3,
                reps: '10-12',
                restSeconds: 60,
              },
            },
          },
        },
      },
    });

    await request(app.getHttpServer())
      .get('/api/v1/automations/preferences')
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/automations/preferences')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.objectContaining({
            userId: createdUserId,
            remindersEnabled: true,
            workoutReminderEnabled: true,
            mealReminderEnabled: true,
            hydrationReminderEnabled: true,
            progressReminderEnabled: true,
          }),
        );
      });

    await request(app.getHttpServer())
      .patch('/api/v1/automations/preferences')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        mealReminderEnabled: false,
      })
      .expect(200)
      .expect((response) => {
        expect(response.body.mealReminderEnabled).toBe(false);
      });

    const automationService = app.get(AutomationService);
    const goodMorningAt = new Date(now.getTime() - 2 * 60 * 1000);
    const workoutAt = new Date(now.getTime() - 60 * 1000);
    const firstGoodMorning = await automationService.scheduleMessage(
      createdUserId,
      AUTOMATION_RULE_CODES.GOOD_MORNING,
      goodMorningAt,
    );
    const repeatedGoodMorning = await automationService.scheduleMessage(
      createdUserId,
      AUTOMATION_RULE_CODES.GOOD_MORNING,
      goodMorningAt,
    );
    const workoutMessage = await automationService.scheduleMessage(
      createdUserId,
      AUTOMATION_RULE_CODES.DAILY_WORKOUT,
      workoutAt,
    );

    expect(repeatedGoodMorning.id).toBe(firstGoodMorning.id);
    expect(firstGoodMorning.content).toContain('Coach');
    expect(firstGoodMorning.content).toContain('emagrecimento');
    expect(workoutMessage.content).toContain('Treino de força');
    expect(workoutMessage.content).toContain('Agachamento');

    await request(app.getHttpServer())
      .get('/api/v1/automations')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.rules).toHaveLength(10);
        expect(response.body.rules).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: AUTOMATION_RULE_CODES.MEAL_REMINDER,
              enabledForUser: false,
            }),
            expect.objectContaining({
              code: AUTOMATION_RULE_CODES.DAILY_WORKOUT,
              enabledForUser: true,
            }),
            expect.objectContaining({
              code: AUTOMATION_RULE_CODES.DAILY_COACH,
              enabledForUser: true,
            }),
            expect.objectContaining({
              code: AUTOMATION_RULE_CODES.WEEKLY_REVIEW,
              enabledForUser: true,
            }),
            expect.objectContaining({
              code: AUTOMATION_RULE_CODES.MONTHLY_REVIEW,
              enabledForUser: true,
            }),
            expect.objectContaining({
              code: AUTOMATION_RULE_CODES.REENGAGEMENT,
              enabledForUser: true,
            }),
          ]),
        );
        expect(response.body.scheduledMessages).toHaveLength(2);
      });

    const dispatched = await automationService.dispatchDue(now);

    expect(dispatched).toHaveLength(2);
    expect(
      dispatched.every(
        (message) => message.status === ScheduledMessageStatus.SENT,
      ),
    ).toBe(true);
    expect(evolutionGateway.sendText).toHaveBeenCalledTimes(2);

    const futureWorkout = await automationService.scheduleMessage(
      createdUserId,
      AUTOMATION_RULE_CODES.DAILY_WORKOUT,
      new Date(now.getTime() + 24 * 60 * 60 * 1000),
    );

    await request(app.getHttpServer())
      .patch('/api/v1/automations/preferences')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        workoutReminderEnabled: false,
      })
      .expect(200);
    expect(
      await prisma.scheduledMessage.findUniqueOrThrow({
        where: {
          id: futureWorkout.id,
        },
      }),
    ).toEqual(
      expect.objectContaining({
        status: ScheduledMessageStatus.CANCELED,
      }),
    );

    await prisma.subscription.update({
      where: {
        id: subscription.id,
      },
      data: {
        status: SubscriptionStatus.CANCELED,
      },
    });

    await request(app.getHttpServer())
      .get('/api/v1/automations/preferences')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
  });

  it('serializes concurrent image reservations at the plan limit', async () => {
    const plan = await prisma.plan.findUniqueOrThrow({
      where: {
        type: PlanType.BASIC,
      },
      include: {
        entitlements: {
          include: {
            entitlement: true,
          },
        },
      },
    });
    const originalValues = new Map(
      plan.entitlements.map((item) => [item.id, item.value]),
    );
    const uniqueId = randomUUID().replaceAll('-', '');
    const user = await prisma.user.create({
      data: {
        phone: `119${randomInt(10_000_000, 100_000_000)}`,
        email: `concurrency-${uniqueId}@singulfit.test`,
      },
    });

    try {
      await prisma.planEntitlement.updateMany({
        where: {
          planId: plan.id,
        },
        data: {
          value: 1,
        },
      });
      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          planId: plan.id,
          status: SubscriptionStatus.ACTIVE,
          amount: plan.price,
          startedAt: new Date(),
          billingPeriodStart: new Date(),
          billingPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      const conversation = await prisma.conversation.create({
        data: {
          userId: user.id,
          subscriptionId: subscription.id,
          phoneNumber: `+55${user.phone}`,
        },
      });
      const messages = await Promise.all([
        prisma.message.create({
          data: {
            conversationId: conversation.id,
            direction: MessageDirection.INBOUND,
            type: MessageType.IMAGE,
            content: '[Imagem 1]',
          },
        }),
        prisma.message.create({
          data: {
            conversationId: conversation.id,
            direction: MessageDirection.INBOUND,
            type: MessageType.IMAGE,
            content: '[Imagem 2]',
          },
        }),
      ]);
      const aiService = app.get(AIService);
      const results = await Promise.allSettled(
        messages.map((message) =>
          aiService.createJob({
            userId: user.id,
            conversationId: conversation.id,
            messageId: message.id,
            type: AIJobType.IMAGE,
            promptName: 'nutrition_vision_brazilian_meal',
          }),
        ),
      );

      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(rejected).toEqual(
        expect.objectContaining({
          reason: expect.any(UsageLimitExceededException),
        }),
      );
      expect(
        await prisma.aIJob.count({
          where: {
            userId: user.id,
          },
        }),
      ).toBe(1);
      expect(
        await prisma.usageEvent.count({
          where: {
            userId: user.id,
            status: 'RESERVED',
          },
        }),
      ).toBe(2);
    } finally {
      await prisma.user.delete({
        where: {
          id: user.id,
        },
      });
      await Promise.all(
        [...originalValues].map(([id, value]) =>
          prisma.planEntitlement.update({
            where: {
              id,
            },
            data: {
              value,
            },
          }),
        ),
      );
    }
  });

  it('persists conversations and internal WhatsApp messages for admins', async () => {
    const uniqueId = randomUUID().replaceAll('-', '');
    const email = `whatsapp-${uniqueId}@singulfit.test`;
    const phone = `119${randomInt(10_000_000, 100_000_000)}`;
    const password = 'SingulFit#Secure123';
    const registrationResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'Administrador WhatsApp',
        phone,
        email,
        password,
        planType: PlanType.BASIC,
      })
      .expect(201);
    const registration = registrationResponse.body as AuthResponse;
    createdUserId = registration.user.id;

    await request(app.getHttpServer())
      .post('/api/v1/internal/whatsapp/messages')
      .set('Authorization', `Bearer ${registration.tokens.accessToken}`)
      .send({
        userId: createdUserId,
        direction: MessageDirection.OUTBOUND,
        type: MessageType.SYSTEM,
        content: 'Mensagem interna de teste.',
      })
      .expect(403);

    await prisma.user.update({
      where: {
        id: createdUserId,
      },
      data: {
        role: UserRole.ADMIN,
      },
    });
    const adminLoginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email,
        password,
      })
      .expect(201);
    const adminLogin = adminLoginResponse.body as AuthResponse;
    const externalMessageId = `internal-${uniqueId}`;
    const messageResponse = await request(app.getHttpServer())
      .post('/api/v1/internal/whatsapp/messages')
      .set('Authorization', `Bearer ${adminLogin.tokens.accessToken}`)
      .send({
        userId: createdUserId,
        direction: MessageDirection.OUTBOUND,
        type: MessageType.SYSTEM,
        content: 'Mensagem interna de teste.',
        externalMessageId,
      })
      .expect(201);

    const repeatedMessageResponse = await request(app.getHttpServer())
      .post('/api/v1/internal/whatsapp/messages')
      .set('Authorization', `Bearer ${adminLogin.tokens.accessToken}`)
      .send({
        userId: createdUserId,
        direction: MessageDirection.OUTBOUND,
        type: MessageType.SYSTEM,
        content: 'Mensagem interna de teste.',
        externalMessageId,
      })
      .expect(201);

    expect(repeatedMessageResponse.body.id).toBe(messageResponse.body.id);

    const conversationResponse = await request(app.getHttpServer())
      .get(`/api/v1/internal/whatsapp/conversations/users/${createdUserId}`)
      .set('Authorization', `Bearer ${adminLogin.tokens.accessToken}`)
      .expect(200);
    const conversationId = conversationResponse.body.id as string;

    await request(app.getHttpServer())
      .get('/api/v1/internal/whatsapp/conversations/search')
      .query({
        phoneNumber: `+55${phone}`,
      })
      .set('Authorization', `Bearer ${adminLogin.tokens.accessToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.id).toBe(conversationId);
      });

    await request(app.getHttpServer())
      .get(`/api/v1/internal/whatsapp/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${adminLogin.tokens.accessToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.items).toEqual([
          expect.objectContaining({
            id: messageResponse.body.id,
            direction: MessageDirection.OUTBOUND,
            type: MessageType.SYSTEM,
            content: 'Mensagem interna de teste.',
            externalMessageId,
          }),
        ]);
      });

    const persistedConversation = await prisma.conversation.findUniqueOrThrow({
      where: {
        id: conversationId,
      },
      include: {
        messages: true,
      },
    });

    expect(persistedConversation.phoneNumber).toBe(`+55${phone}`);
    expect(persistedConversation.lastMessageAt).not.toBeNull();
    expect(persistedConversation.messages).toHaveLength(1);
    expect(
      await prisma.conversation.count({
        where: {
          userId: createdUserId,
        },
      }),
    ).toBe(1);
  });

  it('validates the complete controlled-pilot journey from registration to first value', async () => {
    const uniqueId = randomUUID().replaceAll('-', '');
    const email = `evolution-${uniqueId}@singulfit.test`;
    const phone = `119${randomInt(10_000_000, 100_000_000)}`;
    const registrationResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'Usuário Evolution',
        phone,
        email,
        password: 'SingulFit#Secure123',
        planType: PlanType.BASIC,
        cpf: '12345678901',
      })
      .expect(201);
    const registration = registrationResponse.body as AuthResponse;
    createdUserId = registration.user.id;
    const subscription = await prisma.subscription.findFirstOrThrow({
      where: {
        userId: createdUserId,
      },
    });
    const access = app.get(SubscriptionAccessService);

    await expect(access.requireAccess(createdUserId)).rejects.toThrow(
      'Usuário sem assinatura com acesso',
    );

    const pilot = app.get(PilotService);
    const cohort = await pilot.create({
      name: `E2E controlled pilot ${uniqueId}`,
      description: 'Jornada ponta a ponta com providers mockados.',
      status: PilotCohortStatus.ACTIVE,
      startsAt: new Date(testStartedAt.getTime() - 60_000).toISOString(),
      endsAt: new Date(testStartedAt.getTime() + 86_400_000).toISOString(),
    });
    createdPilotCohortId = cohort.id;
    await pilot.addParticipants(cohort.id, {
      userIds: [createdUserId],
      notes: 'Participante criado pelo E2E controlado.',
    });

    const pixIdempotencyKey = `journey-pix-${uniqueId}`;
    const pixResponse = await request(app.getHttpServer())
      .post('/api/v1/payments/pix')
      .set('Authorization', `Bearer ${registration.tokens.accessToken}`)
      .send({
        idempotencyKey: pixIdempotencyKey,
      })
      .expect(201);
    const approvedAt = new Date();

    paymentGateway.getPayment.mockResolvedValue({
      providerOrderId: 'ORDE_E2E_TEST',
      providerPaymentId: `CHAR_JOURNEY_${uniqueId}`,
      externalReference: pixResponse.body.externalReference,
      status: 'APPROVED',
      amountInCents: 1990,
      currency: 'BRL',
      approvedAt,
    });
    const pagBankPayload = {
      id: `CHAR_JOURNEY_${uniqueId}`,
      reference_id: pixResponse.body.externalReference,
      status: 'PAID',
    };
    const rawPagBankPayload = JSON.stringify(pagBankPayload);
    const pagBankSignature = createHash('sha256')
      .update(webhookSecret)
      .update(rawPagBankPayload)
      .digest('hex');
    createdWebhookRequestId = `journey-webhook-${uniqueId}`;

    const firstPagBankWebhook = await request(app.getHttpServer())
      .post('/api/v1/webhooks/pagbank')
      .set('Content-Type', 'application/json')
      .set('x-authenticity-token', pagBankSignature)
      .set('x-request-id', createdWebhookRequestId)
      .send(rawPagBankPayload)
      .expect(200);
    const repeatedPagBankWebhook = await request(app.getHttpServer())
      .post('/api/v1/webhooks/pagbank')
      .set('Content-Type', 'application/json')
      .set('x-authenticity-token', pagBankSignature)
      .set('x-request-id', createdWebhookRequestId)
      .send(rawPagBankPayload)
      .expect(200);

    expect(firstPagBankWebhook.body.duplicated).toBe(false);
    expect(repeatedPagBankWebhook.body.duplicated).toBe(true);
    await drainOutbox(2);

    const settledPayment = await prisma.payment.findUniqueOrThrow({
      where: {
        id: pixResponse.body.paymentId,
      },
      include: {
        invoice: {
          include: {
            subscription: true,
          },
        },
      },
    });

    expect(settledPayment.status).toBe(PaymentStatus.APPROVED);
    expect(settledPayment.invoice.status).toBe(InvoiceStatus.PAID);
    expect(settledPayment.invoice.subscription.status).toBe(
      SubscriptionStatus.ACTIVE,
    );
    await expect(access.requireAccess(createdUserId)).resolves.toEqual(
      expect.objectContaining({
        id: subscription.id,
        status: SubscriptionStatus.ACTIVE,
      }),
    );

    const activationJourney = app.get(ActivationJourneyService);
    await activationJourney.processUser(createdUserId, new Date());

    const externalMessageId = `wamid-${uniqueId}`;
    const jpegContent = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a]);
    const webhookPayload = {
      event: 'messages.upsert',
      instance: 'singulfit',
      data: {
        key: {
          id: externalMessageId,
          remoteJid: `55${phone}@s.whatsapp.net`,
          fromMe: false,
        },
        messageTimestamp: Date.now(),
        message: {
          imageMessage: {
            caption: 'Meu almoço',
            url: 'https://media.example.com/meal.enc',
            base64: jpegContent.toString('base64'),
            mimetype: 'image/jpeg',
            fileLength: jpegContent.length.toString(),
            fileName: 'meal.jpg',
          },
        },
      },
    };
    openAIGateway.createVisionResponse.mockResolvedValue({
      responseId: `resp-nutrition-${uniqueId}`,
      model: 'e2e-vision-model',
      outputText: JSON.stringify({
        foods: [
          {
            foodName: 'Arroz branco',
            estimatedGrams: 120,
            calories: 156,
            protein: 3.2,
            carbs: 33.6,
            fat: 0.4,
            fiber: 1.2,
            sugar: 0.2,
            isUltraProcessed: false,
            isVegetable: false,
          },
          {
            foodName: 'Feijão carioca',
            estimatedGrams: 100,
            calories: 76,
            protein: 4.8,
            carbs: 13.6,
            fat: 0.5,
            fiber: 6.8,
            sugar: 0.5,
            isUltraProcessed: false,
            isVegetable: false,
          },
        ],
        totalCalories: 232,
        protein: 8,
        carbs: 47.2,
        fat: 0.9,
        fiber: 8,
        sugar: 0.7,
        ultraProcessedRatio: 0,
        vegetableGrams: 100,
        hydrationMl: 250,
        mealCategory: MealCategory.LUNCH,
        confidence: 0.87,
      }),
      promptTokens: 200,
      completionTokens: 50,
      totalTokens: 250,
    });

    await request(app.getHttpServer())
      .post('/api/v1/webhooks/evolution')
      .set('x-evolution-webhook-secret', 'invalid-secret')
      .send(webhookPayload)
      .expect(401);

    const firstResponse = await request(app.getHttpServer())
      .post('/api/v1/webhooks/evolution')
      .set('x-evolution-webhook-secret', evolutionWebhookSecret)
      .send(webhookPayload)
      .expect(200);
    const repeatedResponse = await request(app.getHttpServer())
      .post('/api/v1/webhooks/evolution')
      .set('x-evolution-webhook-secret', evolutionWebhookSecret)
      .send(webhookPayload)
      .expect(200);

    expect(firstResponse.body).toEqual(
      expect.objectContaining({
        received: true,
        processed: false,
        duplicated: false,
        reason: 'QUEUED',
      }),
    );
    expect(repeatedResponse.body).toEqual(
      expect.objectContaining({
        received: true,
        processed: false,
        duplicated: true,
        reason: 'QUEUED',
      }),
    );

    await drainOutbox(5);

    await expect(
      prisma.evolutionInboundEvent.findUniqueOrThrow({
        where: {
          instanceName_externalMessageId: {
            instanceName: 'singulfit',
            externalMessageId,
          },
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'PROCESSED',
        attempts: 1,
        processedAt: expect.any(Date),
      }),
    );
    expect(openAIGateway.createVisionResponse).toHaveBeenCalledTimes(1);
    expect(evolutionGateway.sendText).toHaveBeenCalledTimes(2);

    const conversation = await prisma.conversation.findFirstOrThrow({
      where: {
        userId: createdUserId,
      },
      include: {
        messages: {
          include: {
            mediaFile: true,
          },
        },
      },
    });
    const persistedMessage = conversation.messages[0];

    expect(conversation.subscriptionId).toBe(subscription.id);
    expect(conversation.phoneNumber).toBe(`+55${phone}`);
    expect(conversation.messages).toHaveLength(1);
    expect(persistedMessage).toEqual(
      expect.objectContaining({
        direction: MessageDirection.INBOUND,
        type: MessageType.IMAGE,
        content: 'Meu almoço',
        instanceName: 'singulfit',
        externalMessageId,
        remoteJid: `55${phone}@s.whatsapp.net`,
        mediaUrl: 'https://media.example.com/meal.enc',
        mimeType: 'image/jpeg',
        fileSize: jpegContent.length,
      }),
    );
    expect(persistedMessage.mediaFile).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        userId: createdUserId,
        conversationId: conversation.id,
        messageId: persistedMessage.id,
        mediaType: 'IMAGE',
        storageProvider: 'LOCAL',
        originalFileName: 'meal.jpg',
        mimeType: 'image/jpeg',
        fileSize: jpegContent.length,
        checksum: createHash('sha256').update(jpegContent).digest('hex'),
        publicUrl: null,
      }),
    );
    expect(
      await readFile(
        resolve(mediaUploadPath, persistedMessage.mediaFile!.storagePath),
      ),
    ).toEqual(jpegContent);
    expect(
      await prisma.mediaFile.count({
        where: {
          messageId: persistedMessage.id,
        },
      }),
    ).toBe(1);

    await request(app.getHttpServer())
      .get(`/api/v1/media/${persistedMessage.mediaFile!.id}/download`)
      .expect(401);

    await request(app.getHttpServer())
      .get(`/api/v1/media/${persistedMessage.mediaFile!.id}/download`)
      .set('Authorization', `Bearer ${registration.tokens.accessToken}`)
      .expect('Content-Type', 'image/jpeg')
      .expect('Cache-Control', 'private, no-store')
      .expect(200);

    const persistedMeal = await prisma.meal.findUniqueOrThrow({
      where: {
        mediaFileId: persistedMessage.mediaFile!.id,
      },
      include: {
        analysis: {
          include: {
            items: {
              orderBy: {
                foodName: 'asc',
              },
            },
            aiJob: {
              include: {
                usage: true,
              },
            },
            outboundMessage: true,
            qualityScore: true,
          },
        },
      },
    });

    expect(openAIGateway.createVisionResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: `data:image/jpeg;base64,${jpegContent.toString('base64')}`,
        jsonSchema: expect.objectContaining({
          name: 'nutrition_analysis',
        }),
      }),
    );
    expect(persistedMeal).toEqual(
      expect.objectContaining({
        userId: createdUserId,
        conversationId: conversation.id,
        messageId: persistedMessage.id,
        mediaFileId: persistedMessage.mediaFile!.id,
        source: MealSource.WHATSAPP,
      }),
    );
    expect(persistedMeal.analysis).toEqual(
      expect.objectContaining({
        status: MealAnalysisStatus.COMPLETED,
        confidence: expect.anything(),
        totalCalories: expect.anything(),
        totalProtein: expect.anything(),
        totalCarbs: expect.anything(),
        totalFat: expect.anything(),
        totalFiber: expect.anything(),
        totalSugar: expect.anything(),
        mealCategory: MealCategory.LUNCH,
        rawResponse: expect.objectContaining({
          foods: expect.any(Array),
        }),
      }),
    );
    expect(persistedMeal.analysis!.items).toHaveLength(2);
    expect(persistedMeal.analysis!.items[0]).toEqual(
      expect.objectContaining({
        foodName: 'Arroz branco',
        fiber: expect.anything(),
        isUltraProcessed: false,
      }),
    );
    expect(persistedMeal.analysis!.qualityScore).toEqual(
      expect.objectContaining({
        score: expect.any(Number),
        proteinScore: expect.any(Number),
        fiberScore: expect.any(Number),
        goalAdherenceScore: expect.any(Number),
      }),
    );
    expect(persistedMeal.analysis!.aiJob).toEqual(
      expect.objectContaining({
        status: AIJobStatus.COMPLETED,
        providerResponseId: `resp-nutrition-${uniqueId}`,
      }),
    );
    expect(persistedMeal.analysis!.aiJob!.usage).toHaveLength(1);
    expect(persistedMeal.analysis!.aiJob!.usage[0]).toEqual(
      expect.objectContaining({
        model: 'e2e-vision-model',
        promptTokens: 200,
        completionTokens: 50,
        totalTokens: 250,
        costCurrency: 'USD',
      }),
    );
    expect(
      persistedMeal.analysis!.aiJob!.usage[0].estimatedCost.toString(),
    ).toBe('0.001');
    expect(persistedMeal.analysis!.outboundMessage).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        userId: createdUserId,
        conversationId: conversation.id,
        sourceMessageId: persistedMessage.id,
        mealAnalysisId: persistedMeal.analysis!.id,
        content: expect.stringContaining('Impacto no seu objetivo:'),
        externalMessageId: 'wamid-outbound-e2e',
        status: OutboundMessageStatus.SENT,
        sentAt: expect.any(Date),
        failedAt: null,
        errorMessage: null,
      }),
    );
    expect(
      await prisma.nutritionInsight.count({
        where: {
          userId: createdUserId,
        },
      }),
    ).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.nutritionTrend.count({
        where: {
          userId: createdUserId,
        },
      }),
    ).toBe(3);
    expect(
      await prisma.nutritionRecommendation.count({
        where: {
          userId: createdUserId,
          active: true,
        },
      }),
    ).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.systemEvent.count({
        where: {
          eventType: {
            in: [
              'NUTRITION_SCORE_RECALCULATED',
              'NUTRITION_INSIGHT_CREATED',
              'NUTRITION_TREND_RECALCULATED',
              'NUTRITION_RECOMMENDATION_GENERATED',
            ],
          },
          createdAt: {
            gte: testStartedAt,
          },
        },
      }),
    ).toBeGreaterThanOrEqual(6);
    expect(
      await prisma.outboundMessage.count({
        where: {
          mealAnalysisId: persistedMeal.analysis!.id,
        },
      }),
    ).toBe(1);
    const responseEvaluation =
      await prisma.aIResponseEvaluation.findUniqueOrThrow({
        where: {
          responseId: persistedMeal.analysis!.outboundMessage!.id,
        },
      });

    expect(responseEvaluation).toEqual(
      expect.objectContaining({
        userId: createdUserId,
        aiJobId: persistedMeal.analysis!.aiJob!.id,
        messageId: persistedMessage.id,
        promptVersionId: persistedMeal.analysis!.aiJob!.promptVersionId,
        evaluationType: AIResponseEvaluationType.NUTRITION_RESPONSE,
        riskLevel: AIResponseRiskLevel.LOW,
        safetyScore: 100,
        fallbackUsed: false,
        blocked: false,
      }),
    );
    expect(responseEvaluation.qualityScore).toBeGreaterThanOrEqual(60);
    expect(await prisma.aIQualityDailySnapshot.count()).toBeGreaterThanOrEqual(
      1,
    );
    expect(
      await prisma.promptQualitySnapshot.count({
        where: {
          promptVersionId: persistedMeal.analysis!.aiJob!.promptVersionId,
        },
      }),
    ).toBeGreaterThanOrEqual(1);

    const coach = app.get(CoachIntelligenceService);
    const coachScheduledFor = new Date();
    const firstCoachMessage = await coach.generateCoachMessage(
      createdUserId,
      AUTOMATION_RULE_CODES.DAILY_COACH,
      coachScheduledFor,
    );
    const repeatedCoachMessage = await coach.generateCoachMessage(
      createdUserId,
      AUTOMATION_RULE_CODES.DAILY_COACH,
      coachScheduledFor,
    );

    expect(repeatedCoachMessage.id).toBe(firstCoachMessage.id);
    expect(firstCoachMessage.context).toEqual(
      expect.objectContaining({
        recommendation: expect.any(String),
        recommendationId: expect.any(String),
      }),
    );
    expect(
      await prisma.coachMessage.count({
        where: {
          userId: createdUserId,
          idempotencyKey: firstCoachMessage.idempotencyKey,
        },
      }),
    ).toBe(1);

    const activation = await app
      .get(ActivationService)
      .reconcile(createdUserId, new Date());

    expect(activation.currentStage).toBe(ActivationStage.ACTIVATED);
    expect(activation.firstValueAt).toEqual(expect.any(Date));
    expect(activation.activatedAt).toEqual(expect.any(Date));
    expect(activation.score).toBeGreaterThanOrEqual(80);
    expect(
      await prisma.activationEvent.count({
        where: {
          userId: createdUserId,
          eventCode: 'USER_FIRST_VALUE_REACHED',
        },
      }),
    ).toBe(1);

    const pilotMetrics = await app
      .get(PilotMetricsService)
      .calculate(cohort.id);
    const participant = await prisma.pilotParticipant.findUniqueOrThrow({
      where: {
        cohortId_userId: {
          cohortId: cohort.id,
          userId: createdUserId,
        },
      },
    });

    expect(participant.status).toBe(PilotParticipantStatus.ACTIVATED);
    expect(pilotMetrics).toEqual(
      expect.objectContaining({
        invitedUsers: 1,
        registeredUsers: 1,
        paidUsers: 1,
        activatedUsers: 1,
        firstMealUsers: 1,
        firstAnalysisUsers: 1,
        firstRecommendationUsers: 1,
        firstCoachUsers: 1,
        receivedMessages: 1,
      }),
    );

    createdAnalyticsSnapshotDate = new Date(
      Date.UTC(
        testStartedAt.getUTCFullYear(),
        testStartedAt.getUTCMonth(),
        testStartedAt.getUTCDate() + 1,
      ),
    );
    await deleteAnalyticsSnapshots(createdAnalyticsSnapshotDate);
    const analytics = app.get(AnalyticsSnapshotService);
    const generatedSnapshot = await analytics.ensureDaily(
      createdAnalyticsSnapshotDate,
    );
    const repeatedSnapshot = await analytics.ensureDaily(
      createdAnalyticsSnapshotDate,
    );
    const [revenueSnapshot, costSnapshot, profitabilitySnapshot] =
      await Promise.all([
        prisma.revenueSnapshot.findUniqueOrThrow({
          where: { snapshotDate: createdAnalyticsSnapshotDate },
        }),
        prisma.costSnapshot.findUniqueOrThrow({
          where: { snapshotDate: createdAnalyticsSnapshotDate },
        }),
        prisma.userProfitabilitySnapshot.findFirstOrThrow({
          where: {
            snapshotDate: createdAnalyticsSnapshotDate,
            userId: createdUserId,
          },
        }),
      ]);

    expect(generatedSnapshot.generated).toBe(true);
    expect(repeatedSnapshot.generated).toBe(false);
    expect(revenueSnapshot.currency).toBe('BRL');
    expect(profitabilitySnapshot.currency).toBe('BRL');
    expect(costSnapshot.aiCostUsd.greaterThanOrEqualTo(0)).toBe(true);
    expect(costSnapshot.aiCostBrl.greaterThanOrEqualTo(0)).toBe(true);
    expect(
      persistedMeal.analysis!.aiJob!.usage.every(
        (usage) => usage.costCurrency === 'USD',
      ),
    ).toBe(true);

    await request(app.getHttpServer())
      .get(`/api/v1/internal/responses/${conversation.id}`)
      .set('Authorization', `Bearer ${registration.tokens.accessToken}`)
      .expect(403);

    await prisma.user.update({
      where: {
        id: createdUserId,
      },
      data: {
        role: UserRole.ADMIN,
      },
    });
    const adminLoginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email,
        password: 'SingulFit#Secure123',
      })
      .expect(201);
    const adminLogin = adminLoginResponse.body as AuthResponse;

    await request(app.getHttpServer())
      .get(`/api/v1/internal/responses/${conversation.id}`)
      .set('Authorization', `Bearer ${adminLogin.tokens.accessToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual({
          items: [
            expect.objectContaining({
              id: persistedMeal.analysis!.outboundMessage!.id,
              status: OutboundMessageStatus.SENT,
              externalMessageId: 'wamid-outbound-e2e',
            }),
          ],
          nextCursor: null,
        });
      });
  }, 30_000);

  it('persists prompt versions, idempotent AI jobs and token usage', async () => {
    const uniqueId = randomUUID().replaceAll('-', '');
    const phone = `119${randomInt(10_000_000, 100_000_000)}`;
    const registrationResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'Usuário AI Foundation',
        phone,
        email: `ai-${uniqueId}@singulfit.test`,
        password: 'SingulFit#Secure123',
        planType: PlanType.BASIC,
      })
      .expect(201);
    const registration = registrationResponse.body as AuthResponse;
    createdUserId = registration.user.id;
    const promptService = app.get(PromptService);
    const aiService = app.get(AIService);
    const promptVersion = await promptService.createVersion({
      name: `foundation-${uniqueId}`,
      version: 1,
      prompt: 'Responda somente para validar a infraestrutura.',
      isActive: true,
    });
    createdPromptVersionId = promptVersion.id;
    const conversation = await prisma.conversation.create({
      data: {
        userId: createdUserId,
        phoneNumber: `+55${phone}`,
      },
    });
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        content: 'Mensagem para o job de infraestrutura.',
        instanceName: 'E2E',
        externalMessageId: `ai-message-${uniqueId}`,
        timestamp: new Date(),
      },
    });
    const jobInput = {
      userId: createdUserId,
      conversationId: conversation.id,
      messageId: message.id,
      type: AIJobType.TEXT,
      promptName: promptVersion.name,
    };
    const firstJob = await aiService.createJob(jobInput);
    const repeatedJob = await aiService.createJob(jobInput);

    expect(repeatedJob.id).toBe(firstJob.id);

    const execution = await aiService.executeTextJob(firstJob.id);
    const persistedJob = await prisma.aIJob.findUniqueOrThrow({
      where: {
        id: firstJob.id,
      },
      include: {
        promptVersion: true,
        usage: true,
      },
    });

    expect(execution.outputText).toBe('Resposta interna de teste');
    expect(openAIGateway.createTextResponse).toHaveBeenCalledTimes(1);
    expect(persistedJob.status).toBe(AIJobStatus.COMPLETED);
    expect(persistedJob.providerResponseId).toBe('resp_e2e_ai');
    expect(persistedJob.promptVersion).toEqual(
      expect.objectContaining({
        id: promptVersion.id,
        isActive: true,
      }),
    );
    expect(persistedJob.usage).toHaveLength(1);
    expect(persistedJob.usage[0]).toEqual(
      expect.objectContaining({
        userId: createdUserId,
        model: 'e2e-text-model',
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        costCurrency: 'USD',
      }),
    );
    expect(persistedJob.usage[0].estimatedCost.toString()).toBe('0.000045');
  });

  it('completes registration, login, refresh rotation, me and logout', async () => {
    const uniqueId = randomUUID().replaceAll('-', '');
    const email = `auth-${uniqueId}@singulfit.test`;
    const phone = `119${randomInt(10_000_000, 100_000_000)}`;
    const password = 'SingulFit#Secure123';

    const registerResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'Usuário de Teste',
        phone,
        email,
        password,
        planType: PlanType.BASIC,
        cpf: '12345678901',
      })
      .expect(201);
    const registration = registerResponse.body as AuthResponse;
    createdUserId = registration.user.id;

    expect(registration.user.email).toBe(email);
    expect(registration.tokens.accessToken).toEqual(expect.any(String));
    expect(registration.tokens.refreshToken).toEqual(expect.any(String));

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email,
        password,
      })
      .expect(201);
    const login = loginResponse.body as AuthResponse;

    const pixIdempotencyKey = `pix-${uniqueId}`;
    const pixResponse = await request(app.getHttpServer())
      .post('/api/v1/payments/pix')
      .set('Authorization', `Bearer ${login.tokens.accessToken}`)
      .send({
        idempotencyKey: pixIdempotencyKey,
      });

    if (pixResponse.status !== 201) {
      throw new Error(
        `PIX retornou ${pixResponse.status}: ${JSON.stringify(pixResponse.body)}`,
      );
    }

    expect(pixResponse.body).toEqual(
      expect.objectContaining({
        provider: PaymentProvider.PAGBANK,
        status: PaymentStatus.PENDING,
        providerPaymentId: 'QRCO_E2E_TEST',
        qrCode: expect.any(String),
        qrCodeImageUrl: expect.any(String),
      }),
    );

    const repeatedPixResponse = await request(app.getHttpServer())
      .post('/api/v1/payments/pix')
      .set('Authorization', `Bearer ${login.tokens.accessToken}`)
      .send({
        idempotencyKey: pixIdempotencyKey,
      })
      .expect(201);

    expect(repeatedPixResponse.body.paymentId).toBe(pixResponse.body.paymentId);
    expect(paymentGateway.createPixPayment).toHaveBeenCalledTimes(1);

    const approvedAt = new Date('2026-06-06T18:30:00.000Z');
    paymentGateway.getPayment.mockResolvedValue({
      providerOrderId: 'ORDE_E2E_TEST',
      providerPaymentId: 'CHAR_E2E_TEST',
      externalReference: pixResponse.body.externalReference,
      status: 'APPROVED',
      amountInCents: 1990,
      currency: 'BRL',
      approvedAt,
    });
    const webhookPayload = {
      id: 'CHAR_E2E_TEST',
      reference_id: pixResponse.body.externalReference,
      status: 'PAID',
    };
    const rawWebhookPayload = JSON.stringify(webhookPayload);
    const webhookSignature = createHash('sha256')
      .update(webhookSecret)
      .update(rawWebhookPayload)
      .digest('hex');
    const webhookRequestId = `webhook-${uniqueId}`;
    createdWebhookRequestId = webhookRequestId;

    const sendWebhook = () =>
      request(app.getHttpServer())
        .post('/api/v1/webhooks/pagbank')
        .set('Content-Type', 'application/json')
        .set('x-authenticity-token', webhookSignature)
        .set('x-request-id', webhookRequestId)
        .send(rawWebhookPayload);
    const concurrentResponses = await Promise.all([
      sendWebhook(),
      sendWebhook(),
    ]);

    expect(concurrentResponses.map((response) => response.status)).toEqual([
      200, 200,
    ]);
    expect(
      concurrentResponses.every((response) => response.body.queued === true),
    ).toBe(true);
    expect(
      concurrentResponses.some((response) => response.body.duplicated === true),
    ).toBe(true);

    await drainOutbox(2);

    expect(paymentGateway.getPayment).toHaveBeenCalledTimes(1);

    const settledPayment = await prisma.payment.findUniqueOrThrow({
      where: {
        id: pixResponse.body.paymentId,
      },
      include: {
        invoice: {
          include: {
            subscription: true,
          },
        },
      },
    });
    const firstPeriodEnd = settledPayment.invoice.subscription.currentPeriodEnd;

    expect(settledPayment.status).toBe(PaymentStatus.APPROVED);
    expect(settledPayment.invoice.status).toBe(InvoiceStatus.PAID);
    expect(settledPayment.invoice.subscription.status).toBe(
      SubscriptionStatus.ACTIVE,
    );
    expect(settledPayment.invoice.subscription.activationInvoiceId).toBe(
      settledPayment.invoice.id,
    );
    expect(settledPayment.invoice.subscription.currentPeriodStart).toEqual(
      approvedAt,
    );
    expect(firstPeriodEnd).toEqual(new Date('2026-07-06T18:30:00.000Z'));
    expect(settledPayment.invoice.subscription.gracePeriodEnd).toEqual(
      new Date('2026-07-09T18:30:00.000Z'),
    );

    await request(app.getHttpServer())
      .post('/api/v1/webhooks/pagbank')
      .set('Content-Type', 'application/json')
      .set('x-authenticity-token', webhookSignature)
      .set('x-request-id', createdWebhookRequestId)
      .send(rawWebhookPayload)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual({
          received: true,
          queued: true,
          duplicated: true,
        });
      });

    const repeatedSubscription = await prisma.subscription.findUniqueOrThrow({
      where: {
        id: settledPayment.invoice.subscriptionId,
      },
    });

    expect(repeatedSubscription.currentPeriodEnd).toEqual(firstPeriodEnd);
    expect(paymentGateway.getPayment).toHaveBeenCalledTimes(1);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.tokens.accessToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.objectContaining({
            id: createdUserId,
            email,
          }),
        );
        expect(response.body).not.toHaveProperty('passwordHash');
      });

    const refreshResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({
        refreshToken: login.tokens.refreshToken,
      })
      .expect(201);
    const refresh = refreshResponse.body as RefreshResponse;

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({
        refreshToken: login.tokens.refreshToken,
      })
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.tokens.accessToken}`)
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${refresh.tokens.accessToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .send({
        refreshToken: refresh.tokens.refreshToken,
      })
      .expect(201);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${refresh.tokens.accessToken}`)
      .expect(401);
  });

  it('refreshes persistent user context idempotently and exposes it only to admins', async () => {
    const uniqueId = randomUUID().replaceAll('-', '');
    const email = `context-${uniqueId}@singulfit.test`;
    const phone = `119${randomInt(10_000_000, 100_000_000)}`;
    const password = 'SingulFit#Context123';
    const registrationResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'Usuário de Contexto',
        phone,
        email,
        password,
        planType: PlanType.BASIC,
        cpf: '12345678901',
      })
      .expect(201);
    const registration = registrationResponse.body as AuthResponse;
    createdUserId = registration.user.id;
    await prisma.fitnessProfile.create({
      data: {
        userId: createdUserId,
        gender: Gender.FEMALE,
        birthDate: new Date('1992-04-12T00:00:00.000Z'),
        heightCm: 165,
        currentWeightKg: new Prisma.Decimal('70.00'),
        targetWeightKg: new Prisma.Decimal('62.00'),
        activityLevel: ActivityLevel.MODERATE,
        goal: FitnessGoal.WEIGHT_LOSS,
        foodRestrictions: {
          create: {
            type: 'LACTOSE',
            description: 'Intolerância à lactose',
          },
        },
      },
    });
    const conversation = await prisma.conversation.create({
      data: {
        userId: createdUserId,
        phoneNumber: `+55${phone}`,
      },
    });
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        content: 'Quero manter uma rotina alimentar consistente.',
        instanceName: 'E2E_CONTEXT',
        externalMessageId: `context-message-${uniqueId}`,
      },
    });
    await prisma.conversation.update({
      where: {
        id: conversation.id,
      },
      data: {
        lastMessageAt: message.timestamp,
      },
    });
    const eventBus = app.get(EventBusService);
    const refreshEvent = await eventBus.publish({
      eventType: 'USER_CONTEXT_REFRESH_REQUESTED',
      aggregateType: 'MESSAGE',
      aggregateId: message.id,
      payload: {
        userId: createdUserId,
        messageId: message.id,
      },
    });

    await drainOutbox(2);

    const [profile, preferences, memory, snapshot] = await Promise.all([
      prisma.nutritionProfile.findUniqueOrThrow({
        where: {
          userId: createdUserId,
        },
      }),
      prisma.userPreferences.findUniqueOrThrow({
        where: {
          userId: createdUserId,
        },
      }),
      prisma.conversationMemory.findUniqueOrThrow({
        where: {
          userId_memoryType_sourceKey: {
            userId: createdUserId,
            memoryType: MemoryType.LONG_TERM,
            sourceKey: 'CONSOLIDATED',
          },
        },
      }),
      prisma.userContextSnapshot.findUniqueOrThrow({
        where: {
          refreshKey: message.id,
        },
      }),
    ]);

    expect(profile).toEqual(
      expect.objectContaining({
        sex: Gender.FEMALE,
        heightCm: 165,
        activityLevel: ActivityLevel.MODERATE,
        goal: FitnessGoal.WEIGHT_LOSS,
      }),
    );
    expect(profile.currentWeightKg.toString()).toBe('70');
    expect(profile.restrictions).toEqual([
      {
        type: 'LACTOSE',
        description: 'Intolerância à lactose',
      },
    ]);
    expect(preferences).toEqual(
      expect.objectContaining({
        preferredLanguage: 'pt-BR',
        timezone: 'America/Sao_Paulo',
      }),
    );
    expect(memory.summary).toContain('1 mensagens nos últimos 30 dias');
    expect(snapshot).toEqual(
      expect.objectContaining({
        userId: createdUserId,
        refreshKey: message.id,
        messagesLast7Days: 1,
        messagesLast30Days: 1,
        nutritionAnalysesCount: 0,
      }),
    );

    await prisma.outboxEvent.update({
      where: {
        id: refreshEvent.id,
      },
      data: {
        status: OutboxStatus.PENDING,
        availableAt: new Date(),
        claimedAt: null,
        processedAt: null,
      },
    });
    await drainOutbox(2);

    expect(
      await prisma.userContextSnapshot.count({
        where: {
          refreshKey: message.id,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.conversationMemory.count({
        where: {
          userId: createdUserId,
          memoryType: MemoryType.LONG_TERM,
          sourceKey: 'CONSOLIDATED',
        },
      }),
    ).toBe(1);
    expect(
      await prisma.systemEvent.count({
        where: {
          source: 'CONTEXT',
          eventType: 'USER_CONTEXT_REFRESH_COMPLETED',
          metadata: {
            path: ['refreshKey'],
            equals: message.id,
          },
        },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          userId: createdUserId,
          action: 'USER_CONTEXT_REFRESH_COMPLETED',
        },
      }),
    ).toBe(1);

    await request(app.getHttpServer())
      .get(`/api/v1/admin/context/${createdUserId}`)
      .set('Authorization', `Bearer ${registration.tokens.accessToken}`)
      .expect(403);

    await prisma.user.update({
      where: {
        id: createdUserId,
      },
      data: {
        role: UserRole.ADMIN,
      },
    });
    const adminLoginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email,
        password,
      })
      .expect(201);
    const adminLogin = adminLoginResponse.body as AuthResponse;
    const authorization = `Bearer ${adminLogin.tokens.accessToken}`;

    await request(app.getHttpServer())
      .get('/api/v1/admin/context/users')
      .set('Authorization', authorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: createdUserId,
              memoryCount: 1,
              snapshotCount: 1,
            }),
          ]),
        );
      });
    await request(app.getHttpServer())
      .get(`/api/v1/admin/context/${createdUserId}`)
      .set('Authorization', authorization)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.objectContaining({
            userId: createdUserId,
            nutritionProfile: expect.objectContaining({
              goal: FitnessGoal.WEIGHT_LOSS,
            }),
            preferences: expect.objectContaining({
              preferredLanguage: 'pt-BR',
            }),
            latestSnapshot: expect.objectContaining({
              refreshKey: message.id,
            }),
          }),
        );
      });
    await request(app.getHttpServer())
      .get(`/api/v1/admin/context/${createdUserId}/memory`)
      .set('Authorization', authorization)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual({
          userId: createdUserId,
          items: [
            expect.objectContaining({
              memoryType: MemoryType.LONG_TERM,
              sourceKey: 'CONSOLIDATED',
            }),
          ],
        });
      });
  });

  it('protects and serves persisted SaaS analytics to admins', async () => {
    const uniqueId = randomUUID().replaceAll('-', '');
    const email = `analytics-${uniqueId}@singulfit.test`;
    const phone = `119${randomInt(10_000_000, 100_000_000)}`;
    const password = 'SingulFit#Secure123';
    const registrationResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'Analytics Admin',
        phone,
        email,
        password,
        planType: PlanType.PREMIUM,
      })
      .expect(201);
    const registration = registrationResponse.body as AuthResponse;
    createdUserId = registration.user.id;
    const now = new Date();
    const snapshotDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const date = snapshotDate.toISOString().slice(0, 10);
    const subscription = await prisma.subscription.findFirstOrThrow({
      where: {
        userId: createdUserId,
      },
    });

    await Promise.all([
      prisma.revenueSnapshot.deleteMany({ where: { snapshotDate } }),
      prisma.churnSnapshot.deleteMany({ where: { snapshotDate } }),
      prisma.retentionSnapshot.deleteMany({ where: { snapshotDate } }),
      prisma.costSnapshot.deleteMany({ where: { snapshotDate } }),
      prisma.whatsAppCostSnapshot.deleteMany({ where: { snapshotDate } }),
      prisma.storageCostSnapshot.deleteMany({ where: { snapshotDate } }),
      prisma.userProfitabilitySnapshot.deleteMany({
        where: { snapshotDate },
      }),
      prisma.planPerformanceSnapshot.deleteMany({
        where: { snapshotDate },
      }),
      prisma.growthSnapshot.deleteMany({ where: { snapshotDate } }),
      prisma.systemEvent.deleteMany({
        where: {
          source: 'SAAS_ANALYTICS',
          metadata: {
            path: ['snapshotDate'],
            equals: date,
          },
        },
      }),
    ]);
    await prisma.subscription.update({
      where: {
        id: subscription.id,
      },
      data: {
        status: SubscriptionStatus.ACTIVE,
        startedAt: new Date(snapshotDate.getTime() - 40 * 86_400_000),
        currentPeriodStart: snapshotDate,
        currentPeriodEnd: new Date(snapshotDate.getTime() + 30 * 86_400_000),
        billingPeriodStart: snapshotDate,
        billingPeriodEnd: new Date(snapshotDate.getTime() + 30 * 86_400_000),
      },
    });

    await request(app.getHttpServer())
      .get('/api/v1/admin/analytics/revenue')
      .query({ date })
      .set('Authorization', `Bearer ${registration.tokens.accessToken}`)
      .expect(403);

    await prisma.user.update({
      where: {
        id: createdUserId,
      },
      data: {
        role: UserRole.ADMIN,
      },
    });
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email,
        password,
      })
      .expect(201);
    const admin = loginResponse.body as AuthResponse;
    const authorization = `Bearer ${admin.tokens.accessToken}`;
    const endpoints = [
      'revenue',
      'churn',
      'retention',
      'costs',
      'profitability',
      'growth',
      'plans',
    ];

    for (const endpoint of endpoints) {
      await request(app.getHttpServer())
        .get(`/api/v1/admin/analytics/${endpoint}`)
        .query({ date })
        .set('Authorization', authorization)
        .expect(200);
    }

    const revenueResponse = await request(app.getHttpServer())
      .get('/api/v1/admin/analytics/revenue')
      .query({ date })
      .set('Authorization', authorization)
      .expect(200);

    expect(revenueResponse.body.current).toEqual(
      expect.objectContaining({
        payingUsers: expect.any(Number),
        activeSubscriptions: expect.any(Number),
        premiumUsers: expect.any(Number),
        mrr: expect.any(String),
        arr: expect.any(String),
        arpu: expect.any(String),
      }),
    );
    expect(revenueResponse.body.current.payingUsers).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.planPerformanceSnapshot.count({
        where: {
          snapshotDate,
        },
      }),
    ).toBe(2);
    expect(
      await prisma.systemEvent.count({
        where: {
          source: 'SAAS_ANALYTICS',
          createdAt: {
            gte: testStartedAt,
          },
        },
      }),
    ).toBe(5);

    await Promise.all([
      prisma.revenueSnapshot.deleteMany({ where: { snapshotDate } }),
      prisma.churnSnapshot.deleteMany({ where: { snapshotDate } }),
      prisma.retentionSnapshot.deleteMany({ where: { snapshotDate } }),
      prisma.costSnapshot.deleteMany({ where: { snapshotDate } }),
      prisma.whatsAppCostSnapshot.deleteMany({ where: { snapshotDate } }),
      prisma.storageCostSnapshot.deleteMany({ where: { snapshotDate } }),
      prisma.userProfitabilitySnapshot.deleteMany({
        where: { snapshotDate },
      }),
      prisma.planPerformanceSnapshot.deleteMany({
        where: { snapshotDate },
      }),
      prisma.growthSnapshot.deleteMany({ where: { snapshotDate } }),
      prisma.systemEvent.deleteMany({
        where: {
          source: 'SAAS_ANALYTICS',
          createdAt: {
            gte: testStartedAt,
          },
        },
      }),
    ]);
  });

  it('persists behavioral intelligence and protects its admin APIs', async () => {
    const uniqueId = randomUUID().replaceAll('-', '');
    const email = `behavior-${uniqueId}@singulfit.test`;
    const phone = `119${randomInt(10_000_000, 100_000_000)}`;
    const password = 'SingulFit#Secure123';
    const registrationResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'Behavior Admin',
        phone,
        email,
        password,
        planType: PlanType.PREMIUM,
      })
      .expect(201);
    const registration = registrationResponse.body as AuthResponse;
    createdUserId = registration.user.id;
    const behavior = app.get(BehavioralIntelligenceService);

    await behavior.recalculateUser(createdUserId);

    await request(app.getHttpServer())
      .get('/api/v1/admin/behavior/users')
      .set('Authorization', `Bearer ${registration.tokens.accessToken}`)
      .expect(403);

    await prisma.user.update({
      where: {
        id: createdUserId,
      },
      data: {
        role: UserRole.ADMIN,
      },
    });
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email,
        password,
      })
      .expect(201);
    const admin = loginResponse.body as AuthResponse;
    const authorization = `Bearer ${admin.tokens.accessToken}`;
    const endpoints = ['users', 'insights', 'adherence', 'stages'];

    for (const endpoint of endpoints) {
      await request(app.getHttpServer())
        .get(`/api/v1/admin/behavior/${endpoint}`)
        .query({ userId: createdUserId })
        .set('Authorization', authorization)
        .expect(200)
        .expect((response) => {
          expect(response.body).toEqual(
            expect.objectContaining({
              items: expect.any(Array),
              nextCursor: null,
            }),
          );
        });
    }

    expect(
      await prisma.behavioralProfile.count({
        where: {
          userId: createdUserId,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.behavioralSnapshot.count({
        where: {
          userId: createdUserId,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.systemEvent.count({
        where: {
          source: 'BEHAVIORAL_INTELLIGENCE',
          metadata: {
            path: ['userId'],
            equals: createdUserId,
          },
        },
      }),
    ).toBeGreaterThanOrEqual(2);

    await prisma.systemEvent.deleteMany({
      where: {
        source: 'BEHAVIORAL_INTELLIGENCE',
        metadata: {
          path: ['userId'],
          equals: createdUserId,
        },
      },
    });
  });

  it('blocks unsafe AI responses and serves the human review workflow to admins', async () => {
    const uniqueId = randomUUID().replaceAll('-', '');
    const email = `ai-quality-${uniqueId}@singulfit.test`;
    const phone = `119${randomInt(10_000_000, 100_000_000)}`;
    const password = 'SingulFit#Secure123';
    const registrationResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'AI Quality Admin',
        phone,
        email,
        password,
        planType: PlanType.PREMIUM,
      })
      .expect(201);
    const registration = registrationResponse.body as AuthResponse;
    createdUserId = registration.user.id;
    const prompt = await app.get(PromptService).createVersion({
      name: `ai-quality-${uniqueId}`,
      version: 1,
      prompt: 'Prompt controlado para avaliação de qualidade.',
      isActive: true,
    });
    createdPromptVersionId = prompt.id;
    const conversation = await prisma.conversation.create({
      data: {
        userId: createdUserId,
        phoneNumber: `+55${phone}`,
      },
    });
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        content: 'Como devo emagrecer?',
      },
    });
    const completedAt = new Date();
    const aiJob = await prisma.aIJob.create({
      data: {
        userId: createdUserId,
        conversationId: conversation.id,
        messageId: message.id,
        type: AIJobType.TEXT,
        status: AIJobStatus.COMPLETED,
        promptVersionId: prompt.id,
        startedAt: completedAt,
        completedAt,
      },
    });
    const evaluationService = app.get(AIResponseEvaluationService);
    const decision = evaluationService.evaluate(
      'Você tem diabetes. Tome 20 mg deste medicamento para garantir a cura.',
      AIResponseEvaluationType.NUTRITION_RESPONSE,
      {
        goal: FitnessGoal.WEIGHT_LOSS,
        memoryCount: 1,
        recentMealCount: 2,
        insightCount: 1,
        recommendationCount: 1,
        behaviorStage: 'ACTION',
        adherenceScore: 70,
      },
    );
    const outbound = await prisma.outboundMessage.create({
      data: {
        userId: createdUserId,
        conversationId: conversation.id,
        sourceMessageId: message.id,
        responseType: ResponseType.NUTRITION_ANALYSIS,
        content: decision.finalContent,
      },
    });

    await prisma.$transaction((transaction) =>
      evaluationService.persistInTransaction(transaction, {
        userId: createdUserId!,
        aiJobId: aiJob.id,
        messageId: message.id,
        responseId: outbound.id,
        promptVersionId: prompt.id,
        estimatedCost: new Prisma.Decimal('0.0075'),
        decision,
      }),
    );

    expect(decision.safety.riskLevel).toBe(AIResponseRiskLevel.BLOCKED);
    expect(outbound.content).toContain('acompanhamento profissional');
    expect(outbound.content).not.toContain('20 mg');

    await request(app.getHttpServer())
      .get('/api/v1/admin/ai-quality/evaluations')
      .set('Authorization', `Bearer ${registration.tokens.accessToken}`)
      .expect(403);

    await prisma.user.update({
      where: {
        id: createdUserId,
      },
      data: {
        role: UserRole.ADMIN,
      },
    });
    const adminLoginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email,
        password,
      })
      .expect(201);
    const admin = adminLoginResponse.body as AuthResponse;
    const authorization = `Bearer ${admin.tokens.accessToken}`;
    const endpoints = ['evaluations', 'flags', 'prompts', 'review-queue'];

    for (const endpoint of endpoints) {
      await request(app.getHttpServer())
        .get(`/api/v1/admin/ai-quality/${endpoint}`)
        .set('Authorization', authorization)
        .expect(200)
        .expect((response) => {
          expect(response.body.items).toEqual(expect.any(Array));
        });
    }

    const review = await prisma.aIReviewQueue.findFirstOrThrow({
      where: {
        userId: createdUserId,
      },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/admin/ai-quality/review-queue/${review.id}/resolve`)
      .set('Authorization', authorization)
      .send({
        status: AIReviewStatus.REVIEWED,
      })
      .expect(201)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.objectContaining({
            id: review.id,
            status: AIReviewStatus.REVIEWED,
            reviewedAt: expect.any(String),
          }),
        );
      });
    expect(
      await prisma.promptQualitySnapshot.count({
        where: {
          promptVersionId: prompt.id,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.systemEvent.count({
        where: {
          source: 'AI_QUALITY',
          metadata: {
            path: ['userId'],
            equals: createdUserId,
          },
        },
      }),
    ).toBeGreaterThanOrEqual(5);

    await prisma.systemEvent.deleteMany({
      where: {
        source: 'AI_QUALITY',
        metadata: {
          path: ['userId'],
          equals: createdUserId,
        },
      },
    });
  });

  it('protects recommendation admin APIs and persists lifecycle transitions', async () => {
    const uniqueId = randomUUID().replaceAll('-', '');
    const email = `recommendations-${uniqueId}@singulfit.test`;
    const phone = `119${randomInt(10_000_000, 100_000_000)}`;
    const password = 'SingulFit#Secure123';
    const registrationResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'Recommendation Admin',
        phone,
        email,
        password,
        planType: PlanType.PREMIUM,
      })
      .expect(201);
    const registration = registrationResponse.body as AuthResponse;
    createdUserId = registration.user.id;
    const generatedAt = new Date();
    const expiresAt = new Date(generatedAt.getTime() + 7 * 86_400_000);
    const snapshotDate = new Date('2026-01-15T00:00:00.000Z');
    const [acceptedCandidate, dismissedCandidate] = await Promise.all([
      prisma.recommendation.create({
        data: {
          userId: createdUserId,
          category: RecommendationCategory.NUTRITION,
          priority: RecommendationPriority.HIGH,
          signalKey: 'E2E:NUTRITION',
          sourceKey: `E2E:NUTRITION:${uniqueId}`,
          title: 'Inclua uma fonte de proteína',
          description: 'Adicione uma fonte prática na próxima refeição.',
          reason: 'Sinal nutricional recorrente.',
          confidenceScore: 82,
          generatedAt,
          expiresAt,
        },
      }),
      prisma.recommendation.create({
        data: {
          userId: createdUserId,
          category: RecommendationCategory.HABIT,
          priority: RecommendationPriority.MEDIUM,
          signalKey: 'E2E:HABIT',
          sourceKey: `E2E:HABIT:${uniqueId}`,
          title: 'Proteja uma refeição âncora',
          description: 'Repita uma estrutura simples em uma refeição.',
          reason: 'Consistência recente abaixo do esperado.',
          confidenceScore: 74,
          generatedAt,
          expiresAt,
        },
      }),
    ]);

    await prisma.recommendationDailySnapshot.upsert({
      where: { snapshotDate },
      update: {
        generatedCount: 2,
        acceptedCount: 0,
        dismissedCount: 0,
        expiredCount: 0,
        activeCount: 2,
        byCategory: {
          NUTRITION: 1,
          HABIT: 1,
        },
        generatedAt,
      },
      create: {
        snapshotDate,
        generatedCount: 2,
        acceptedCount: 0,
        dismissedCount: 0,
        expiredCount: 0,
        activeCount: 2,
        byCategory: {
          NUTRITION: 1,
          HABIT: 1,
        },
        generatedAt,
      },
    });

    await request(app.getHttpServer())
      .get('/api/v1/admin/recommendations')
      .set('Authorization', `Bearer ${registration.tokens.accessToken}`)
      .expect(403);

    await prisma.user.update({
      where: { id: createdUserId },
      data: { role: UserRole.ADMIN },
    });
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);
    const admin = loginResponse.body as AuthResponse;
    const authorization = `Bearer ${admin.tokens.accessToken}`;

    await request(app.getHttpServer())
      .get('/api/v1/admin/recommendations')
      .query({ userId: createdUserId })
      .set('Authorization', authorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.items).toHaveLength(2);
      });
    await request(app.getHttpServer())
      .get('/api/v1/admin/recommendations/stats')
      .query({
        from: '2026-01-15T00:00:00.000Z',
        to: '2026-01-15T23:59:59.999Z',
      })
      .set('Authorization', authorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.items[0]).toEqual(
          expect.objectContaining({
            generatedCount: 2,
            activeCount: 2,
          }),
        );
      });
    await request(app.getHttpServer())
      .post(`/api/v1/admin/recommendations/${acceptedCandidate.id}/accept`)
      .set('Authorization', authorization)
      .expect(201)
      .expect((response) => {
        expect(response.body.status).toBe(RecommendationStatus.ACCEPTED);
      });
    await request(app.getHttpServer())
      .post(`/api/v1/admin/recommendations/${dismissedCandidate.id}/dismiss`)
      .set('Authorization', authorization)
      .expect(201)
      .expect((response) => {
        expect(response.body.status).toBe(RecommendationStatus.DISMISSED);
      });

    expect(
      await prisma.systemEvent.count({
        where: {
          source: 'RECOMMENDATION_ENGINE',
          metadata: {
            path: ['userId'],
            equals: createdUserId,
          },
        },
      }),
    ).toBe(2);

    await prisma.systemEvent.deleteMany({
      where: {
        source: 'RECOMMENDATION_ENGINE',
        metadata: {
          path: ['userId'],
          equals: createdUserId,
        },
      },
    });
    await prisma.recommendationDailySnapshot.deleteMany({
      where: {
        snapshotDate: {
          in: [
            snapshotDate,
            new Date(
              Date.UTC(
                generatedAt.getUTCFullYear(),
                generatedAt.getUTCMonth(),
                generatedAt.getUTCDate(),
              ),
            ),
          ],
        },
      },
    });
  });

  it('protects activation admin APIs and exposes funnel, risk and snapshots', async () => {
    const uniqueId = randomUUID().replaceAll('-', '');
    const email = `activation-${uniqueId}@singulfit.test`;
    const phone = `119${randomInt(10_000_000, 100_000_000)}`;
    const password = 'SingulFit#Secure123';
    const registrationResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'Activation Admin',
        phone,
        email,
        password,
        planType: PlanType.PREMIUM,
      })
      .expect(201);
    const registration = registrationResponse.body as AuthResponse;
    createdUserId = registration.user.id;
    const registeredAt = new Date();
    const activation = await prisma.userActivation.create({
      data: {
        userId: createdUserId,
        currentStage: ActivationStage.FIRST_MESSAGE_SENT,
        score: 25,
        riskLevel: ActivationRiskLevel.MEDIUM,
        registeredAt,
        paidAt: registeredAt,
        whatsappConnectedAt: registeredAt,
        firstMessageSentAt: registeredAt,
        lastProgressAt: registeredAt,
      },
    });
    await prisma.activationSnapshot.create({
      data: {
        activationId: activation.id,
        userId: createdUserId,
        snapshotDate: new Date(
          Date.UTC(
            registeredAt.getUTCFullYear(),
            registeredAt.getUTCMonth(),
            registeredAt.getUTCDate(),
          ),
        ),
        currentStage: activation.currentStage,
        score: activation.score,
        riskLevel: activation.riskLevel,
        stalledHours: 24,
        stepDurations: {
          registeredToPaid: 0,
        },
        generatedAt: registeredAt,
      },
    });

    await request(app.getHttpServer())
      .get('/api/v1/admin/activation/users')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/activation/users')
      .set('Authorization', `Bearer ${registration.tokens.accessToken}`)
      .expect(403);

    await prisma.user.update({
      where: { id: createdUserId },
      data: { role: UserRole.ADMIN },
    });
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);
    const admin = loginResponse.body as AuthResponse;
    const authorization = `Bearer ${admin.tokens.accessToken}`;

    await request(app.getHttpServer())
      .get('/api/v1/admin/activation/users')
      .query({ userId: createdUserId })
      .set('Authorization', authorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.items[0]).toEqual(
          expect.objectContaining({
            userId: createdUserId,
            currentStage: ActivationStage.FIRST_MESSAGE_SENT,
            score: 25,
          }),
        );
      });
    await request(app.getHttpServer())
      .get('/api/v1/admin/activation/funnel')
      .set('Authorization', authorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.stages).toHaveLength(9);
      });
    await request(app.getHttpServer())
      .get('/api/v1/admin/activation/risk')
      .query({ userId: createdUserId })
      .set('Authorization', authorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.items[0].riskLevel).toBe(
          ActivationRiskLevel.MEDIUM,
        );
      });
    await request(app.getHttpServer())
      .get('/api/v1/admin/activation/snapshots')
      .query({ userId: createdUserId })
      .set('Authorization', authorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.items[0]).toEqual(
          expect.objectContaining({
            userId: createdUserId,
            currentStage: ActivationStage.FIRST_MESSAGE_SENT,
          }),
        );
      });
  });

  afterEach(async () => {
    await prisma.outboxEvent.deleteMany({
      where: {
        createdAt: {
          gte: testStartedAt,
        },
      },
    });
    await prisma.systemEvent.deleteMany({
      where: {
        source: {
          in: ['OUTBOX', 'CONTEXT'],
        },
        createdAt: {
          gte: testStartedAt,
        },
      },
    });
    await prisma.auditLog.deleteMany({
      where: {
        action: {
          in: [
            'USER_CONTEXT_REFRESH_STARTED',
            'USER_CONTEXT_REFRESH_COMPLETED',
            'USER_CONTEXT_REFRESH_FAILED',
          ],
        },
        createdAt: {
          gte: testStartedAt,
        },
      },
    });

    if (createdWebhookRequestId) {
      await prisma.webhookEvent.deleteMany({
        where: {
          requestId: createdWebhookRequestId,
        },
      });
      createdWebhookRequestId = undefined;
    }

    if (createdAnalyticsSnapshotDate) {
      await deleteAnalyticsSnapshots(createdAnalyticsSnapshotDate);
      createdAnalyticsSnapshotDate = undefined;
    }

    if (createdPilotCohortId) {
      await prisma.pilotCohort.deleteMany({
        where: {
          id: createdPilotCohortId,
        },
      });
      createdPilotCohortId = undefined;
    }

    if (createdUserId) {
      await prisma.subscription.updateMany({
        where: {
          userId: createdUserId,
        },
        data: {
          activationInvoiceId: null,
        },
      });
      await prisma.payment.deleteMany({
        where: {
          invoice: {
            subscription: {
              userId: createdUserId,
            },
          },
        },
      });
      await prisma.invoice.deleteMany({
        where: {
          subscription: {
            userId: createdUserId,
          },
        },
      });
      await prisma.user.delete({
        where: {
          id: createdUserId,
        },
      });
      createdUserId = undefined;
    }

    if (createdPromptVersionId) {
      await prisma.promptVersion.delete({
        where: {
          id: createdPromptVersionId,
        },
      });
      createdPromptVersionId = undefined;
    }

    await app.close();
  });

  afterAll(async () => {
    await rm(mediaUploadPath, {
      recursive: true,
      force: true,
    });
  });

  async function drainOutbox(rounds: number): Promise<void> {
    const worker = app.get(OutboxDispatcherService);

    for (let round = 0; round < rounds; round += 1) {
      await worker.drain();
    }
  }

  async function deleteAnalyticsSnapshots(snapshotDate: Date): Promise<void> {
    await Promise.all([
      prisma.revenueSnapshot.deleteMany({ where: { snapshotDate } }),
      prisma.churnSnapshot.deleteMany({ where: { snapshotDate } }),
      prisma.retentionSnapshot.deleteMany({ where: { snapshotDate } }),
      prisma.costSnapshot.deleteMany({ where: { snapshotDate } }),
      prisma.whatsAppCostSnapshot.deleteMany({ where: { snapshotDate } }),
      prisma.storageCostSnapshot.deleteMany({ where: { snapshotDate } }),
      prisma.userProfitabilitySnapshot.deleteMany({ where: { snapshotDate } }),
      prisma.planPerformanceSnapshot.deleteMany({ where: { snapshotDate } }),
      prisma.growthSnapshot.deleteMany({ where: { snapshotDate } }),
    ]);
  }
});
