import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  ActivityLevel,
  FitnessGoal,
  Gender,
  MemoryType,
  MessageDirection,
  MessageType,
  Prisma,
  ResponseType,
  UserGoalType,
} from '@prisma/client';
import { EventBusService } from '../event-bus/event-bus.service';
import { INTERNAL_EVENT } from '../event-bus/event-bus.constants';
import { ActivationDietaryAnswersPolicy } from './activation-dietary-answers.policy';
import { ProfileAnswerRecognizerService } from '../context/profile-acquisition/profile-answer-recognizer.service';
import { CoachProfileFieldRegistryService } from '../context/profile-acquisition/coach-profile-field-registry.service';
import { ConversationSafetyDetectorService } from '../conversation/understanding/conversation-safety-detector.service';
import { ConversationMessageNormalizerService } from '../conversation/understanding/conversation-message-normalizer.service';
import { evaluateConversationSafety } from '../conversation/routing/conversation-safety-routing.policy';
import { ConversationLanguageRealizerService } from '../conversation/runtime/conversation-language-realizer.service';
import { DeliveryPendingError } from '../event-bus/delivery-pending.error';
import { PrismaService } from '../prisma/prisma.service';
import { assertOrderedTurn } from './onboarding-ingress-order';
import {
  ACTIVATION_ONBOARDING_CONTEXT_REFRESH_AGGREGATE,
  ACTIVATION_ONBOARDING_MEMORY_SUMMARY,
  ACTIVATION_ONBOARDING_ACTIVITY_KEYWORDS,
  ACTIVATION_ONBOARDING_GOAL_KEYWORDS,
  ACTIVATION_ONBOARDING_PROFILE_SOURCE_KEY,
  ACTIVATION_ONBOARDING_POSITIVE_REPLIES,
  ACTIVATION_ONBOARDING_RELEVANCE_SCORE,
  ACTIVATION_ONBOARDING_RESTRICTION_TYPE,
  ACTIVATION_ONBOARDING_SOURCE,
  ACTIVATION_ONBOARDING_SOURCE_KEY,
  ACTIVATION_ONBOARDING_START_MODE,
  ACTIVATION_ONBOARDING_STATE,
  ACTIVATION_ONBOARDING_STATUS,
  ACTIVATION_ONBOARDING_TARGET_SOURCE,
  ACTIVATION_ONBOARDING_VERSION,
} from './activation-onboarding.constants';
import {
  ActivationOnboardingAnswers,
  ActivationOnboardingPendingInput,
  ActivationOnboardingSession,
  ActivationOnboardingSessionContent,
  ActivationOnboardingStartMode,
  ActivationOnboardingState,
  CompleteActivationOnboardingInput,
  PersistActivationOnboardingInput,
  ProcessActivationOnboardingTextInput,
  ProcessActivationOnboardingTextResult,
  StartActivationOnboardingInput,
  UpdateActivationOnboardingStateInput,
} from './activation-onboarding.types';

@Injectable()
export class ActivationOnboardingService {
  private readonly dietary = new ActivationDietaryAnswersPolicy();
  private readonly recognizer = new ProfileAnswerRecognizerService(
    new CoachProfileFieldRegistryService(),
  );
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
  ) {}

  async start(
    input: StartActivationOnboardingInput,
  ): Promise<ActivationOnboardingSession> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        WITH advisory_lock AS (
          SELECT pg_advisory_xact_lock(hashtext(${`activation-onboarding:${input.userId}`}))
        )
        SELECT true AS "locked" FROM advisory_lock
      `;
      const existing = await this.get(input.userId, transaction);
      if (existing) return existing;
      const startedAt = input.startedAt ?? new Date();
      return this.persistWithClient(
        transaction,
        {
          userId: input.userId,
          content: this.initialContent(input, startedAt),
          generatedAt: startedAt,
        },
        startedAt,
      );
    });
  }

  async get(
    userId: string,
    client: Pick<Prisma.TransactionClient, 'conversationMemory'> = this.prisma,
  ): Promise<ActivationOnboardingSession | null> {
    const memory = await client.conversationMemory.findUnique({
      where: {
        userId_memoryType_sourceKey: {
          userId,
          memoryType: MemoryType.SHORT_TERM,
          sourceKey: ACTIVATION_ONBOARDING_SOURCE_KEY,
        },
      },
    });

    if (!memory) {
      return null;
    }

    const content = this.normalizeContent(memory.content);

    if (!content) {
      return null;
    }

    return {
      id: memory.id,
      userId: memory.userId,
      sourceKey: ACTIVATION_ONBOARDING_SOURCE_KEY,
      content,
      summary: memory.summary,
      generatedAt: memory.generatedAt,
    };
  }

  async persist(
    input: PersistActivationOnboardingInput,
  ): Promise<ActivationOnboardingSession> {
    const generatedAt = input.generatedAt ?? new Date();

    return this.persistWithClient(this.prisma, input, generatedAt);
  }

  private async persistWithClient(
    client: Pick<Prisma.TransactionClient, 'conversationMemory'>,
    input: PersistActivationOnboardingInput,
    generatedAt: Date,
  ): Promise<ActivationOnboardingSession> {
    const memory = await client.conversationMemory.upsert({
      where: {
        userId_memoryType_sourceKey: {
          userId: input.userId,
          memoryType: MemoryType.SHORT_TERM,
          sourceKey: ACTIVATION_ONBOARDING_SOURCE_KEY,
        },
      },
      update: {
        content: this.toJson(input.content),
        summary: this.summary(input.content),
        relevanceScore: new Prisma.Decimal(
          ACTIVATION_ONBOARDING_RELEVANCE_SCORE,
        ),
        generatedAt,
      },
      create: {
        userId: input.userId,
        memoryType: MemoryType.SHORT_TERM,
        sourceKey: ACTIVATION_ONBOARDING_SOURCE_KEY,
        content: this.toJson(input.content),
        summary: this.summary(input.content),
        relevanceScore: new Prisma.Decimal(
          ACTIVATION_ONBOARDING_RELEVANCE_SCORE,
        ),
        generatedAt,
      },
    });

    return {
      id: memory.id,
      userId: memory.userId,
      sourceKey: ACTIVATION_ONBOARDING_SOURCE_KEY,
      content: input.content,
      summary: memory.summary,
      generatedAt: memory.generatedAt,
    };
  }

  async updateState(
    input: UpdateActivationOnboardingStateInput,
  ): Promise<ActivationOnboardingSession> {
    const current = await this.get(input.userId);

    if (!current) {
      throw new Error('Onboarding premium não iniciado');
    }

    const updatedAt = input.updatedAt ?? new Date();
    const content: ActivationOnboardingSessionContent = {
      ...current.content,
      status:
        input.state === ACTIVATION_ONBOARDING_STATE.PROFILE_COMPLETED
          ? ACTIVATION_ONBOARDING_STATUS.COMPLETED
          : ACTIVATION_ONBOARDING_STATUS.IN_PROGRESS,
      currentState: input.state,
      previousState: input.previousState ?? current.content.currentState,
      expectedNextState:
        input.expectedNextState === undefined
          ? current.content.expectedNextState
          : input.expectedNextState,
      startMode:
        input.startMode === undefined
          ? current.content.startMode
          : input.startMode,
      pendingInput:
        input.pendingInput === undefined
          ? current.content.pendingInput
          : input.pendingInput,
      lastProcessedMessageId:
        input.lastProcessedMessageId === undefined
          ? current.content.lastProcessedMessageId
          : input.lastProcessedMessageId,
      lastPromptState:
        input.lastPromptState === undefined
          ? current.content.lastPromptState
          : input.lastPromptState,
      lastPromptAt:
        input.lastPromptAt === undefined
          ? current.content.lastPromptAt
          : (input.lastPromptAt?.toISOString() ?? null),
      updatedAt: updatedAt.toISOString(),
      completedAt:
        input.state === ACTIVATION_ONBOARDING_STATE.PROFILE_COMPLETED
          ? updatedAt.toISOString()
          : current.content.completedAt,
    };

    return this.persist({
      userId: input.userId,
      content,
      generatedAt: updatedAt,
    });
  }

  async complete(
    input: CompleteActivationOnboardingInput,
  ): Promise<ActivationOnboardingSession> {
    const completedAt = input.completedAt ?? new Date();

    return this.updateState({
      userId: input.userId,
      state: ACTIVATION_ONBOARDING_STATE.PROFILE_COMPLETED,
      previousState: null,
      expectedNextState: null,
      pendingInput: null,
      lastPromptState: ACTIVATION_ONBOARDING_STATE.PROFILE_COMPLETED,
      lastPromptAt: completedAt,
      updatedAt: completedAt,
    });
  }

  private async completeWithProfile(
    userId: string,
    content: ActivationOnboardingSessionContent,
    completedAt: Date,
    transaction: Prisma.TransactionClient,
  ): Promise<ActivationOnboardingSession> {
    const profile = this.profileData(content);
    const user = await transaction.user.findUnique({
      where: { id: userId },
      select: { onboardingCompleted: true },
    });
    const refreshSuffix = user?.onboardingCompleted
      ? `:correction:${content.lastProcessedMessageId ?? completedAt.toISOString()}`
      : '';

    const session = await this.persistWithClient(
      transaction,
      {
        userId,
        content,
        generatedAt: completedAt,
      },
      completedAt,
    );
    const fitnessProfile = await this.upsertFitnessProfile(
      transaction,
      userId,
      profile,
    );

    await this.upsertNutritionProfile(transaction, userId, profile);
    await transaction.userPreferences.upsert({
      where: {
        userId,
      },
      update: {},
      create: {
        userId,
      },
    });
    await transaction.user.update({
      where: {
        id: userId,
      },
      data: {
        onboardingCompleted: true,
      },
    });
    await this.upsertGoalClassification(
      transaction,
      userId,
      content,
      completedAt,
    );
    await this.persistOnboardingLongTermMemory(
      transaction,
      userId,
      content,
      profile,
      completedAt,
    );
    await this.eventBus.publish(
      {
        eventType: INTERNAL_EVENT.USER_CONTEXT_REFRESH_REQUESTED,
        aggregateType: ACTIVATION_ONBOARDING_CONTEXT_REFRESH_AGGREGATE,
        aggregateId: `${ACTIVATION_ONBOARDING_PROFILE_SOURCE_KEY}:${userId}${refreshSuffix}`,
        payload: {
          userId,
          source: ACTIVATION_ONBOARDING_SOURCE,
          version: ACTIVATION_ONBOARDING_VERSION,
          fitnessProfileId: fitnessProfile.id,
        },
      },
      transaction,
    );

    return session;
  }

  async processActiveTextMessage(
    input: ProcessActivationOnboardingTextInput,
  ): Promise<ProcessActivationOnboardingTextResult> {
    return this.processTextMessage(input);
  }

  async processTextMessage(
    input: ProcessActivationOnboardingTextInput,
  ): Promise<ProcessActivationOnboardingTextResult> {
    const session = await this.get(input.userId);

    if (!session) {
      return {
        handled: false,
        duplicated: false,
        state: null,
        reason: 'ONBOARDING_NOT_STARTED',
      };
    }

    const message = await this.prisma.message.findFirst({
      where: {
        id: input.messageId,
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        conversation: {
          userId: input.userId,
        },
      },
      select: {
        id: true,
        content: true,
        timestamp: true,
        conversationId: true,
        replyToExternalMessageId: true,
        instanceName: true,
        externalMessageId: true,
      },
    });

    if (!message) {
      return {
        handled: false,
        duplicated: false,
        state: session.content.currentState,
        reason: 'TEXT_MESSAGE_NOT_FOUND',
      };
    }

    const now = input.receivedAt ?? message.timestamp;
    const safety = new ConversationSafetyDetectorService().detect(
      new ConversationMessageNormalizerService().normalize(message.content),
    );
    const safetyRoute = evaluateConversationSafety(safety.safety);
    const active =
      session.content.status !== ACTIVATION_ONBOARDING_STATUS.COMPLETED;
    const independent = this.recognizer.isIndependentCommand(message.content);
    if (!active && (safety.safety.requiresSafeResponse || independent))
      return {
        handled: false,
        duplicated: false,
        state: session.content.currentState,
        reason: safety.safety.requiresSafeResponse
          ? 'SAFETY_PRECEDENCE'
          : 'INDEPENDENT_COMMAND',
      };
    const interruption =
      active &&
      (independent ||
        /^(?:como funciona\??|tenho uma d[uú]vida[.!?]?|quero corrigir minha idade[.!?]?)$/iu.test(
          message.content.trim(),
        ));
    const safetyReply =
      active && safetyRoute.action !== 'CONTINUE'
        ? new ConversationLanguageRealizerService().realize({
            kind: 'SAFETY_GUIDANCE',
            action: safetyRoute.action,
          }).message
        : null;
    let quotedOnboardingSource: string | null | undefined;
    // A quote of another conversation owner must retain that owner's continuation.
    if (message.replyToExternalMessageId && !safetyReply && !interruption) {
      const quoted = await this.prisma.outboundMessage.findFirst({
        where: {
          userId: input.userId,
          conversationId: message.conversationId,
          externalMessageId: message.replyToExternalMessageId,
        },
        select: { sourceMessageId: true },
      });
      const ownedQuote =
        quoted &&
        (await this.prisma.outboxEvent.findUnique({
          where: {
            eventType_aggregateType_aggregateId: this.responseEventKey(
              quoted.sourceMessageId,
            ),
          },
        }));
      const welcome = await this.prisma.activationEvent.findFirst({
        where: {
          userId: input.userId,
          activationId: session.content.activationId,
          eventCode: 'D0',
          externalMessageId: message.replyToExternalMessageId,
        },
        select: { id: true },
      });
      if (ownedQuote) quotedOnboardingSource = quoted?.sourceMessageId;
      else if (welcome) quotedOnboardingSource = null;
      if (!ownedQuote && !welcome)
        return {
          handled: false,
          duplicated: false,
          state: session.content.currentState,
          reason: 'FOREIGN_QUOTED_PROMPT',
        };
    }
    return this.prisma
      .$transaction(async (transaction) => {
        await transaction.$queryRaw`
          WITH advisory_lock AS (
            SELECT pg_advisory_xact_lock(hashtext(${`activation-onboarding:${input.userId}`}))
          )
          SELECT true AS "locked" FROM advisory_lock
        `;
        const current = await this.get(input.userId, transaction);
        if (!current)
          return {
            handled: false,
            duplicated: false,
            state: null,
            reason: 'ONBOARDING_NOT_STARTED',
          };
        const replay = await transaction.outboxEvent.findUnique({
          where: {
            eventType_aggregateType_aggregateId: this.responseEventKey(
              message.id,
            ),
          },
        });
        if (replay)
          return {
            handled: true,
            duplicated: true,
            state: current.content.currentState,
          };
        const ingress = await assertOrderedTurn(
          transaction,
          input.userId,
          message,
          Boolean(safetyReply),
        );
        if (ingress?.turnProcessedAt)
          return {
            handled: true,
            duplicated: true,
            state: current.content.currentState,
          };
        if (
          current.content.lastProcessedMessageId &&
          !safetyReply &&
          !interruption
        ) {
          const previous = await transaction.outboundMessage.findUnique({
            where: {
              sourceMessageId_responseType: {
                sourceMessageId: current.content.lastProcessedMessageId,
                responseType: ResponseType.PROFILE_ACQUISITION,
              },
            },
            select: { id: true, status: true },
          });
          if (
            previous &&
            previous.status !== 'SENT' &&
            previous.status !== 'DELIVERED'
          ) {
            const dependency = await transaction.outboxEvent.findUnique({
              where: {
                eventType_aggregateType_aggregateId: this.responseEventKey(
                  current.content.lastProcessedMessageId,
                ),
              },
            });
            if (!dependency || dependency.status === 'DEAD_LETTER')
              throw new ServiceUnavailableException(
                `Entrega do onboarding exige recuperação operacional: ${dependency?.id ?? previous.id}`,
              );
            if (dependency.status === 'PROCESSED') {
              // Repair the old false completion without touching SQL or bypassing
              // the sender's subscription gate. User lock serializes this repair.
              await transaction.outboxEvent.updateMany({
                where: { id: dependency.id, status: 'PROCESSED' },
                data: {
                  status: 'PENDING',
                  attempts: 0,
                  availableAt: new Date(),
                  processedAt: null,
                  claimedAt: null,
                },
              });
            }
            // The repair above must commit, so defer outside this transaction.
            return {
              handled: true,
              duplicated: false,
              state: current.content.currentState,
              pendingDeliveryId: dependency.id,
            };
          }
        }
        if (
          current.content.status === ACTIVATION_ONBOARDING_STATUS.COMPLETED &&
          !this.dietary.isCorrection(message.content) &&
          !this.correctPhysicalAnswer(
            current.content.answers,
            message.content,
            now,
          )
        )
          return {
            handled: false,
            duplicated: false,
            state: current.content.currentState,
            reason: 'ONBOARDING_COMPLETED',
          };
        // Historical sessions may already have consumed this input before durable delivery existed.
        const outOfOrder =
          current.content.pendingInput !== null &&
          now.getTime() <
            new Date(current.content.pendingInput.receivedAt).getTime();
        const staleDietaryConfirmation =
          Boolean(message.replyToExternalMessageId) &&
          current.content.dietary?.status === 'CONFIRMATION_PENDING' &&
          ['CONFIRMED', 'REJECTED'].includes(
            this.dietary.confirmation(message.content),
          ) &&
          quotedOnboardingSource !== current.content.lastProcessedMessageId;
        const keepStep = Boolean(
          safetyReply || interruption || outOfOrder || staleDietaryConfirmation,
        );
        const transition =
          keepStep || current.content.lastProcessedMessageId === message.id
            ? { content: current.content }
            : this.transition(current.content, message.content, now);
        const content: ActivationOnboardingSessionContent = {
          ...transition.content,
          lastProcessedMessageId: keepStep
            ? current.content.lastProcessedMessageId
            : message.id,
          pendingInput: keepStep
            ? current.content.pendingInput
            : {
                messageId: message.id,
                text: message.content,
                receivedAt: now.toISOString(),
              },
          updatedAt: now.toISOString(),
        };
        const persisted =
          content.currentState === ACTIVATION_ONBOARDING_STATE.PROFILE_COMPLETED
            ? await this.completeWithProfile(
                input.userId,
                content,
                now,
                transaction,
              )
            : await this.persistWithClient(
                transaction,
                { userId: input.userId, content },
                now,
              );
        const outbound = await transaction.outboundMessage.create({
          data: {
            userId: input.userId,
            conversationId: message.conversationId,
            sourceMessageId: message.id,
            responseType: ResponseType.PROFILE_ACQUISITION,
            content:
              safetyReply ??
              (staleDietaryConfirmation
                ? `Essa confirmação responde a uma pergunta anterior. Confira a lista atual antes de confirmar.\n\n${this.responseText(persisted.content)}`
                : outOfOrder
                  ? `Recebi uma mensagem anterior. Para não registrar um dado no campo errado, vamos manter a pergunta atual.\n\n${this.responseText(persisted.content)}`
                  : interruption
                    ? this.interruptionText(message.content, persisted.content)
                    : this.responseText(persisted.content)),
          },
        });
        await this.eventBus.publish(
          {
            eventType: INTERNAL_EVENT.ACTIVATION_ONBOARDING_RESPONSE_REQUESTED,
            aggregateType: 'ACTIVATION_ONBOARDING_MESSAGE',
            aggregateId: message.id,
            payload: {
              userId: input.userId,
              sourceMessageId: message.id,
              outboundMessageId: outbound.id,
            },
          },
          transaction,
        );
        if (ingress?.admissionSequence)
          await transaction.evolutionInboundEvent.update({
            where: { id: ingress.id },
            data: { turnProcessedAt: new Date() },
          });
        return {
          handled: true,
          duplicated: current.content.lastProcessedMessageId === message.id,
          state: persisted.content.currentState,
        };
      })
      .then((result) => {
        if ('pendingDeliveryId' in result && result.pendingDeliveryId)
          throw new DeliveryPendingError(result.pendingDeliveryId);
        return result;
      });
  }

  private interruptionText(
    text: string,
    content: ActivationOnboardingSessionContent,
  ): string {
    const folded = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const answer = folded.includes('corrigir minha idade')
      ? 'Claro. Envie a idade correta, por exemplo: “Quero corrigir minha idade: 32 anos”.'
      : folded.includes('como funciona')
        ? 'Primeiro completamos seu perfil para personalizar o acompanhamento com segurança. Depois, seguimos com os recursos disponíveis no seu plano.'
        : folded.includes('duvida')
          ? 'Pode me contar sua dúvida. Seu cadastro continua salvo e podemos retomá-lo depois.'
          : 'Para montar ou consultar seu plano com segurança, precisamos completar seu perfil primeiro.';
    return `${answer}\n\n${this.responseText(content)}`;
  }

  private responseEventKey(messageId: string) {
    return {
      eventType: INTERNAL_EVENT.ACTIVATION_ONBOARDING_RESPONSE_REQUESTED,
      aggregateType: 'ACTIVATION_ONBOARDING_MESSAGE',
      aggregateId: messageId,
    };
  }

  private responseText(content: ActivationOnboardingSessionContent): string {
    if (
      content.currentState === ACTIVATION_ONBOARDING_STATE.ASK_RESTRICTIONS &&
      content.dietary &&
      ['DETAILS_REQUIRED', 'CONFIRMATION_PENDING'].includes(
        content.dietary.status,
      )
    )
      return this.dietary.prompt(content.dietary);
    return this.messageForState(content.currentState, content.userFirstName);
  }

  private initialContent(
    input: StartActivationOnboardingInput,
    startedAt: Date,
  ): ActivationOnboardingSessionContent {
    const timestamp = startedAt.toISOString();

    return {
      version: ACTIVATION_ONBOARDING_VERSION,
      source: ACTIVATION_ONBOARDING_SOURCE,
      activationId: input.activationId,
      status: ACTIVATION_ONBOARDING_STATUS.IN_PROGRESS,
      currentState: ACTIVATION_ONBOARDING_STATE.WAITING_START_CONFIRMATION,
      previousState: ACTIVATION_ONBOARDING_STATE.WELCOME,
      expectedNextState: ACTIVATION_ONBOARDING_STATE.ASK_AGE,
      startMode: null,
      userFirstName: this.firstName(input.userFirstName),
      answers: this.emptyAnswers(),
      dietary: this.dietary.empty(),
      pendingInput: null,
      lastProcessedMessageId: null,
      lastPromptState: ACTIVATION_ONBOARDING_STATE.WELCOME,
      lastPromptAt: timestamp,
      startedAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    };
  }

  private profileData(content: ActivationOnboardingSessionContent): {
    gender: Gender;
    birthDate: Date;
    heightCm: number;
    currentWeightKg: Prisma.Decimal;
    targetWeightKg: Prisma.Decimal;
    activityLevel: ActivityLevel;
    goal: FitnessGoal;
    restrictions: string[];
    dietary: NonNullable<ActivationOnboardingSessionContent['dietary']>;
  } {
    const answers = content.answers;

    if (
      !answers.birthDate ||
      answers.heightCm === null ||
      !answers.currentWeightKg ||
      answers.gender === null ||
      answers.fitnessGoal === null ||
      answers.activityLevel === null ||
      !answers.targetWeightKg
    ) {
      throw new Error('Onboarding premium concluído sem perfil completo');
    }

    return {
      gender: answers.gender,
      birthDate: new Date(`${answers.birthDate}T00:00:00.000Z`),
      heightCm: answers.heightCm,
      currentWeightKg: new Prisma.Decimal(answers.currentWeightKg),
      targetWeightKg: new Prisma.Decimal(answers.targetWeightKg),
      activityLevel: answers.activityLevel,
      goal: answers.fitnessGoal,
      restrictions: answers.restrictions,
      dietary: content.dietary ?? this.dietary.empty(),
    };
  }

  private async upsertFitnessProfile(
    transaction: Prisma.TransactionClient,
    userId: string,
    profile: ReturnType<ActivationOnboardingService['profileData']>,
  ): Promise<{ id: string }> {
    const existing = await transaction.fitnessProfile.findUnique({
      where: {
        userId,
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      await transaction.foodRestriction.deleteMany({
        where: {
          profileId: existing.id,
          type: ACTIVATION_ONBOARDING_RESTRICTION_TYPE,
        },
      });

      if (profile.restrictions.length > 0) {
        await transaction.foodRestriction.createMany({
          data: profile.restrictions.map((restriction) => ({
            profileId: existing.id,
            type: ACTIVATION_ONBOARDING_RESTRICTION_TYPE,
            description: restriction,
          })),
        });
      }

      return transaction.fitnessProfile.update({
        where: {
          id: existing.id,
        },
        data: {
          gender: profile.gender,
          birthDate: profile.birthDate,
          heightCm: profile.heightCm,
          currentWeightKg: profile.currentWeightKg,
          targetWeightKg: profile.targetWeightKg,
          activityLevel: profile.activityLevel,
          goal: profile.goal,
        },
        select: {
          id: true,
        },
      });
    }

    return transaction.fitnessProfile.create({
      data: {
        userId,
        gender: profile.gender,
        birthDate: profile.birthDate,
        heightCm: profile.heightCm,
        currentWeightKg: profile.currentWeightKg,
        targetWeightKg: profile.targetWeightKg,
        activityLevel: profile.activityLevel,
        goal: profile.goal,
        foodRestrictions:
          profile.restrictions.length > 0
            ? {
                create: profile.restrictions.map((restriction) => ({
                  type: ACTIVATION_ONBOARDING_RESTRICTION_TYPE,
                  description: restriction,
                })),
              }
            : undefined,
      },
      select: {
        id: true,
      },
    });
  }

  private async upsertNutritionProfile(
    transaction: Prisma.TransactionClient,
    userId: string,
    profile: ReturnType<ActivationOnboardingService['profileData']>,
  ): Promise<void> {
    if (profile.dietary.status !== 'CONFIRMED')
      throw new Error('Restrições pendentes de confirmação explícita');
    const restrictions: Prisma.InputJsonArray = [
      ...profile.dietary.intolerances.map((description) => ({
        type: 'INTOLERANCE',
        description,
      })),
      ...profile.dietary.avoidedFoods.map((description) => ({
        type: 'PREFERENCE',
        description,
      })),
      ...profile.dietary.otherRestrictions.map((description) => ({
        type: 'RESTRICTION',
        description,
      })),
    ];
    const allergies: Prisma.InputJsonArray = profile.dietary.allergies.map(
      (description) => ({ type: 'ALLERGY', description }),
    );

    await transaction.nutritionProfile.upsert({
      where: {
        userId,
      },
      update: {
        sex: profile.gender,
        birthDate: profile.birthDate,
        heightCm: profile.heightCm,
        currentWeightKg: profile.currentWeightKg,
        targetWeightKg: profile.targetWeightKg,
        activityLevel: profile.activityLevel,
        goal: profile.goal,
        restrictions,
        ...(profile.dietary.allergiesExplicit ? { allergies } : {}),
      },
      create: {
        userId,
        sex: profile.gender,
        birthDate: profile.birthDate,
        heightCm: profile.heightCm,
        currentWeightKg: profile.currentWeightKg,
        targetWeightKg: profile.targetWeightKg,
        activityLevel: profile.activityLevel,
        goal: profile.goal,
        restrictions,
        allergies,
        medicalConditions: [],
      },
    });
  }

  private async upsertGoalClassification(
    transaction: Prisma.TransactionClient,
    userId: string,
    content: ActivationOnboardingSessionContent,
    classifiedAt: Date,
  ): Promise<void> {
    await transaction.userGoalClassification.upsert({
      where: {
        userId,
      },
      update: {
        goal: this.userGoalType(content.answers.commercialGoal),
        confidence: new Prisma.Decimal('0.9000'),
        evidence: this.longTermMemoryContent(content),
        classifiedAt,
      },
      create: {
        userId,
        goal: this.userGoalType(content.answers.commercialGoal),
        confidence: new Prisma.Decimal('0.9000'),
        evidence: this.longTermMemoryContent(content),
        classifiedAt,
      },
    });
  }

  private async persistOnboardingLongTermMemory(
    transaction: Prisma.TransactionClient,
    userId: string,
    content: ActivationOnboardingSessionContent,
    profile: ReturnType<ActivationOnboardingService['profileData']>,
    completedAt: Date,
  ): Promise<void> {
    await transaction.conversationMemory.upsert({
      where: {
        userId_memoryType_sourceKey: {
          userId,
          memoryType: MemoryType.LONG_TERM,
          sourceKey: ACTIVATION_ONBOARDING_PROFILE_SOURCE_KEY,
        },
      },
      update: {
        content: this.longTermMemoryContent(content, profile),
        summary: this.longTermMemorySummary(content),
        relevanceScore: new Prisma.Decimal(
          ACTIVATION_ONBOARDING_RELEVANCE_SCORE,
        ),
        generatedAt: completedAt,
      },
      create: {
        userId,
        memoryType: MemoryType.LONG_TERM,
        sourceKey: ACTIVATION_ONBOARDING_PROFILE_SOURCE_KEY,
        content: this.longTermMemoryContent(content, profile),
        summary: this.longTermMemorySummary(content),
        relevanceScore: new Prisma.Decimal(
          ACTIVATION_ONBOARDING_RELEVANCE_SCORE,
        ),
        generatedAt: completedAt,
      },
    });
  }

  private longTermMemoryContent(
    content: ActivationOnboardingSessionContent,
    profile?: ReturnType<ActivationOnboardingService['profileData']>,
  ): Prisma.InputJsonObject {
    return {
      version: content.version,
      source: ACTIVATION_ONBOARDING_SOURCE,
      completedAt: content.completedAt,
      userFirstName: content.userFirstName,
      commercialGoal: content.answers.commercialGoal,
      desiredResultText: content.answers.desiredResultText,
      restrictions: content.answers.restrictions,
      allergies:
        content.dietary?.status === 'CONFIRMED' &&
        content.dietary.allergiesExplicit
          ? content.dietary.allergies
          : null,
      allergiesConfirmed:
        content.dietary?.status === 'CONFIRMED' &&
        content.dietary.allergiesExplicit,
      targetWeightKg: content.answers.targetWeightKg,
      targetWeightSource: content.answers.targetWeightSource,
      profile: profile
        ? {
            gender: profile.gender,
            birthDate: profile.birthDate.toISOString().slice(0, 10),
            heightCm: profile.heightCm,
            currentWeightKg: profile.currentWeightKg.toString(),
            targetWeightKg: profile.targetWeightKg.toString(),
            activityLevel: profile.activityLevel,
            goal: profile.goal,
          }
        : null,
    };
  }

  private longTermMemorySummary(
    content: ActivationOnboardingSessionContent,
  ): string {
    const goal = content.answers.commercialGoal ?? 'objetivo não informado';
    const result =
      content.answers.desiredResultText ?? 'resultado desejado não informado';

    return `Onboarding premium concluído: ${goal}; resultado desejado: ${result}`.slice(
      0,
      2_000,
    );
  }

  private userGoalType(commercialGoal: string | null): UserGoalType {
    switch (commercialGoal) {
      case 'WEIGHT_LOSS':
        return UserGoalType.WEIGHT_LOSS;
      case 'MUSCLE_GAIN':
        return UserGoalType.HYPERTROPHY;
      case 'HEALTH':
        return UserGoalType.HEALTH;
      default:
        return UserGoalType.MAINTENANCE;
    }
  }

  private transition(
    content: ActivationOnboardingSessionContent,
    text: string,
    at: Date,
  ): { content: ActivationOnboardingSessionContent } {
    const normalized = this.normalizeText(text);
    const answers = { ...content.answers };
    let dietary = content.dietary ?? this.dietary.empty();
    let currentState = content.currentState;
    let previousState: ActivationOnboardingState | null = content.currentState;
    let startMode = content.startMode;
    let completedAt = content.completedAt;
    const physicalCorrection = this.correctPhysicalAnswer(answers, text, at);
    if (
      physicalCorrection &&
      content.status === ACTIVATION_ONBOARDING_STATUS.COMPLETED &&
      dietary.status !== 'CONFIRMED'
    )
      return {
        content: {
          ...content,
          answers: physicalCorrection,
          currentState: ACTIVATION_ONBOARDING_STATE.ASK_RESTRICTIONS,
          status: ACTIVATION_ONBOARDING_STATUS.IN_PROGRESS,
          dietary: {
            ...(this.dietary.read(answers.restrictions.join(', ')) ??
              this.dietary.empty()),
            returnState: ACTIVATION_ONBOARDING_STATE.PROFILE_COMPLETED,
          },
        },
      };
    if (physicalCorrection)
      return { content: { ...content, answers: physicalCorrection } };

    if (
      this.dietary.isCorrection(text) &&
      currentState !== ACTIVATION_ONBOARDING_STATE.ASK_RESTRICTIONS
    ) {
      const corrected = this.dietary.read(text);
      if (!corrected) return { content };
      dietary = this.mergeDietary(dietary, corrected, false);
      dietary.returnState = currentState;
      dietary.rawRestrictions = [
        ...dietary.allergies,
        ...dietary.intolerances,
        ...dietary.avoidedFoods,
        ...dietary.otherRestrictions,
      ];
      currentState = ACTIVATION_ONBOARDING_STATE.ASK_RESTRICTIONS;
    } else if (currentState === ACTIVATION_ONBOARDING_STATE.ASK_RESTRICTIONS) {
      if (
        dietary.status === 'CONFIRMATION_PENDING' &&
        this.dietary.confirmation(text) === 'CONFIRMED'
      ) {
        dietary = { ...dietary, status: 'CONFIRMED' };
        answers.restrictions = [...dietary.rawRestrictions];
        currentState =
          dietary.returnState ?? ACTIVATION_ONBOARDING_STATE.ASK_DESIRED_RESULT;
      } else if (
        dietary.status === 'CONFIRMATION_PENDING' &&
        this.dietary.confirmation(text) === 'REJECTED'
      ) {
        dietary = {
          ...dietary,
          status: 'DETAILS_REQUIRED',
          specifiedCategories: [],
          returnState: dietary.returnState,
        };
      } else {
        const parsed = this.dietary.read(text);
        if (!parsed) return { content };
        dietary =
          dietary.status !== 'UNKNOWN'
            ? this.mergeDietary(
                dietary,
                parsed,
                dietary.status === 'CONFIRMATION_PENDING' &&
                  !this.dietary.isCorrection(text),
              )
            : { ...parsed, returnState: dietary.returnState };
      }
    } else if (
      currentState === ACTIVATION_ONBOARDING_STATE.WAITING_START_CONFIRMATION
    ) {
      const age = this.parseAge(text);

      if (age !== null) {
        answers.age = age;
        answers.birthDate = this.birthDateFromAge(age, at);
        currentState = ACTIVATION_ONBOARDING_STATE.ASK_HEIGHT;
        startMode = ACTIVATION_ONBOARDING_START_MODE.DIRECT_FIRST_ANSWER;
      } else {
        currentState = ACTIVATION_ONBOARDING_STATE.ASK_AGE;
        startMode = this.isPositiveReply(normalized)
          ? ACTIVATION_ONBOARDING_START_MODE.POSITIVE_CONFIRMATION
          : ACTIVATION_ONBOARDING_START_MODE.CONTEXTUAL_REPLY;
      }
    } else if (currentState === ACTIVATION_ONBOARDING_STATE.ASK_AGE) {
      const age = this.parseAge(text);

      if (age === null) {
        return { content };
      }

      answers.age = age;
      answers.birthDate = this.birthDateFromAge(age, at);
      currentState = ACTIVATION_ONBOARDING_STATE.ASK_HEIGHT;
    } else if (currentState === ACTIVATION_ONBOARDING_STATE.ASK_HEIGHT) {
      const heightCm = this.parseHeightCm(text);

      if (heightCm === null) {
        return { content };
      }

      answers.heightCm = heightCm;
      currentState = ACTIVATION_ONBOARDING_STATE.ASK_WEIGHT;
    } else if (currentState === ACTIVATION_ONBOARDING_STATE.ASK_WEIGHT) {
      const weightKg = this.parseWeightKg(text);

      if (weightKg === null) {
        return { content };
      }

      answers.currentWeightKg = weightKg;
      currentState = ACTIVATION_ONBOARDING_STATE.ASK_GENDER;
    } else if (currentState === ACTIVATION_ONBOARDING_STATE.ASK_GENDER) {
      const gender = this.parseGender(normalized);

      if (gender === null) {
        return { content };
      }

      answers.gender = gender;
      currentState = ACTIVATION_ONBOARDING_STATE.ASK_GOAL;
    } else if (currentState === ACTIVATION_ONBOARDING_STATE.ASK_GOAL) {
      const goal = this.parseGoal(normalized);

      if (goal === null) {
        return { content };
      }

      answers.commercialGoal = goal.commercialGoal;
      answers.fitnessGoal = goal.fitnessGoal;
      currentState = ACTIVATION_ONBOARDING_STATE.ASK_ACTIVITY_LEVEL;
    } else if (
      currentState === ACTIVATION_ONBOARDING_STATE.ASK_ACTIVITY_LEVEL
    ) {
      const activityLevel = this.parseActivityLevel(normalized);

      if (activityLevel === null) {
        return { content };
      }

      answers.activityLevel = activityLevel;
      currentState = ACTIVATION_ONBOARDING_STATE.ASK_RESTRICTIONS;
    } else if (
      currentState === ACTIVATION_ONBOARDING_STATE.ASK_DESIRED_RESULT
    ) {
      // A dietary acknowledgement belongs to the previous question, not to
      // the desired result. Keep the confirmed profile until a meaningful goal.
      if (!this.isDesiredResult(normalized)) return { content };
      answers.desiredResultText = text.trim();
      const latestExplicitGoal = this.parseGoal(normalized);
      if (latestExplicitGoal) {
        answers.commercialGoal = latestExplicitGoal.commercialGoal;
        answers.fitnessGoal = latestExplicitGoal.fitnessGoal;
      }
      const target = this.parseTargetWeightKg(text, answers);
      answers.targetWeightKg = target.targetWeightKg;
      answers.targetWeightSource = target.source;
      currentState = ACTIVATION_ONBOARDING_STATE.PROFILE_COMPLETED;
      completedAt = at.toISOString();
      if (dietary.status !== 'CONFIRMED') {
        dietary = {
          ...(this.dietary.read(answers.restrictions.join(', ')) ??
            this.dietary.empty()),
          returnState: ACTIVATION_ONBOARDING_STATE.PROFILE_COMPLETED,
        };
        currentState = ACTIVATION_ONBOARDING_STATE.ASK_RESTRICTIONS;
      }
    } else {
      previousState = content.previousState;
    }

    return {
      content: {
        ...content,
        status:
          currentState === ACTIVATION_ONBOARDING_STATE.PROFILE_COMPLETED
            ? ACTIVATION_ONBOARDING_STATUS.COMPLETED
            : ACTIVATION_ONBOARDING_STATUS.IN_PROGRESS,
        currentState,
        previousState,
        expectedNextState: this.nextState(currentState),
        startMode,
        answers,
        dietary,
        lastPromptState: currentState,
        lastPromptAt: at.toISOString(),
        completedAt,
      },
    };
  }

  private messageForState(
    state: ActivationOnboardingState,
    userFirstName: string | null,
  ): string {
    const name = userFirstName ?? 'você';

    switch (state) {
      case ACTIVATION_ONBOARDING_STATE.ASK_AGE:
        return 'Perfeito. Para começar, qual sua idade? Pode responder como "32" ou "tenho 32 anos".';
      case ACTIVATION_ONBOARDING_STATE.ASK_HEIGHT:
        return 'Ótimo. Qual sua altura? Pode responder como 178, 178cm, 1,78 ou 1.78.';
      case ACTIVATION_ONBOARDING_STATE.ASK_WEIGHT:
        return 'Boa. Qual seu peso atual? Pode mandar como 82, 82kg, 82,5 ou 82.5.';
      case ACTIVATION_ONBOARDING_STATE.ASK_GENDER:
        return 'Certo. Qual seu sexo? Masculino ou feminino.';
      case ACTIVATION_ONBOARDING_STATE.ASK_GOAL:
        return 'Qual seu principal objetivo hoje? Emagrecimento, ganho de massa, definição, saúde ou performance.';
      case ACTIVATION_ONBOARDING_STATE.ASK_ACTIVITY_LEVEL:
        return 'Você pratica atividade física atualmente? Pode responder: sedentário, leve, moderado, intenso ou atleta.';
      case ACTIVATION_ONBOARDING_STATE.ASK_RESTRICTIONS:
        return 'Possui alguma restrição alimentar, alergia ou alimento que prefere evitar? Exemplos: lactose, glúten, amendoim ou nenhuma.';
      case ACTIVATION_ONBOARDING_STATE.ASK_DESIRED_RESULT:
        return 'Para fechar seu perfil: qual resultado você gostaria de alcançar? Exemplos: perder 10 kg, chegar aos 80 kg, ganhar massa muscular, melhorar condicionamento ou correr 5 km.';
      case ACTIVATION_ONBOARDING_STATE.PROFILE_COMPLETED:
        return `Excelente, ${name} 👏\n\nAgora já conheço melhor seu perfil e consigo personalizar minhas recomendações para sua realidade.\n\nA partir de agora posso te ajudar com:\n\n🥗 Alimentação\n🏋️ Treinos\n📈 Evolução física\n📸 Análise de refeições por foto\n🎯 Estratégias para seus objetivos\n\nSempre que quiser, basta me enviar uma mensagem ou uma foto da sua refeição.\n\nVamos começar sua evolução.`;
      default:
        return 'Vamos continuar sua jornada no SingulFit.';
    }
  }

  private nextState(
    state: ActivationOnboardingState,
  ): ActivationOnboardingState | null {
    switch (state) {
      case ACTIVATION_ONBOARDING_STATE.WAITING_START_CONFIRMATION:
        return ACTIVATION_ONBOARDING_STATE.ASK_AGE;
      case ACTIVATION_ONBOARDING_STATE.ASK_AGE:
        return ACTIVATION_ONBOARDING_STATE.ASK_HEIGHT;
      case ACTIVATION_ONBOARDING_STATE.ASK_HEIGHT:
        return ACTIVATION_ONBOARDING_STATE.ASK_WEIGHT;
      case ACTIVATION_ONBOARDING_STATE.ASK_WEIGHT:
        return ACTIVATION_ONBOARDING_STATE.ASK_GENDER;
      case ACTIVATION_ONBOARDING_STATE.ASK_GENDER:
        return ACTIVATION_ONBOARDING_STATE.ASK_GOAL;
      case ACTIVATION_ONBOARDING_STATE.ASK_GOAL:
        return ACTIVATION_ONBOARDING_STATE.ASK_ACTIVITY_LEVEL;
      case ACTIVATION_ONBOARDING_STATE.ASK_ACTIVITY_LEVEL:
        return ACTIVATION_ONBOARDING_STATE.ASK_RESTRICTIONS;
      case ACTIVATION_ONBOARDING_STATE.ASK_RESTRICTIONS:
        return ACTIVATION_ONBOARDING_STATE.ASK_DESIRED_RESULT;
      default:
        return null;
    }
  }

  private emptyAnswers(): ActivationOnboardingAnswers {
    return {
      age: null,
      birthDate: null,
      heightCm: null,
      currentWeightKg: null,
      gender: null,
      commercialGoal: null,
      fitnessGoal: null,
      activityLevel: null,
      restrictions: [],
      desiredResultText: null,
      targetWeightKg: null,
      targetWeightSource: null,
    };
  }

  private parseAge(text: string): number | null {
    const match = this.normalizeText(text).match(/\b(\d{1,3})\b/);

    if (!match) {
      return null;
    }

    const age = Number.parseInt(match[1], 10);

    return Number.isInteger(age) && age >= 13 && age <= 100 ? age : null;
  }

  private parseHeightCm(text: string): number | null {
    const normalized = this.normalizeText(text).replace(/\s+/g, '');
    const decimalMatch = normalized.match(/\b([12])[,.](\d{2})\b/);

    if (decimalMatch) {
      const heightCm =
        Number.parseInt(decimalMatch[1], 10) * 100 +
        Number.parseInt(decimalMatch[2], 10);

      return heightCm >= 120 && heightCm <= 230 ? heightCm : null;
    }

    const integerMatch = normalized.match(/\b(\d{2,3})(?:cm)?\b/);

    if (!integerMatch) {
      return null;
    }

    const heightCm = Number.parseInt(integerMatch[1], 10);

    return heightCm >= 120 && heightCm <= 230 ? heightCm : null;
  }

  private parseWeightKg(text: string): string | null {
    const normalized = this.normalizeText(text).replace(/\s+/g, '');
    const match = normalized.match(/\b(\d{2,3}(?:[,.]\d{1,2})?)(?:kg)?\b/);

    if (!match) {
      return null;
    }

    const weight = Number.parseFloat(match[1].replace(',', '.'));

    if (!Number.isFinite(weight) || weight < 30 || weight > 300) {
      return null;
    }

    return weight.toFixed(2);
  }

  private parseGender(text: string): Gender | null {
    if (
      /\b(masculino|homem)\b/.test(text) ||
      /\bsou\s+(um\s+)?homem\b/.test(text) ||
      text === 'm'
    ) {
      return Gender.MALE;
    }

    if (
      /\b(feminino|mulher)\b/.test(text) ||
      /\bsou\s+(uma\s+)?mulher\b/.test(text) ||
      text === 'f'
    ) {
      return Gender.FEMALE;
    }

    return null;
  }

  private isDesiredResult(text: string): boolean {
    const folded = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    if (
      /^(sim|nao|ok|okay|confirmado|confirmada|certo|isso|pode|beleza|entendi)[.!?\s]*$/u.test(
        folded,
      )
    )
      return false;
    return (
      this.parseGoal(text) !== null ||
      /\b(perder|reduzir|eliminar|chegar|atingir|alcancar|pesar)\b.*\b\d+(?:[.,]\d+)?\s*(kg|quilos?|kilos?)\b/u.test(
        folded,
      ) ||
      /\b(condicionamento|resistencia|forca|mobilidade|flexibilidade|disposicao|energia)\b/u.test(
        folded,
      ) ||
      /\b(correr|caminhar|pedalar|nadar)\b.*\d+\s*(km|quilometros?|metros?|minutos?)\b/u.test(
        folded,
      )
    );
  }

  private parseGoal(
    text: string,
  ): { commercialGoal: string; fitnessGoal: FitnessGoal } | null {
    if (
      this.includesKeyword(
        text,
        ACTIVATION_ONBOARDING_GOAL_KEYWORDS.WEIGHT_LOSS,
      )
    ) {
      return {
        commercialGoal: 'WEIGHT_LOSS',
        fitnessGoal: FitnessGoal.WEIGHT_LOSS,
      };
    }

    if (
      this.includesKeyword(
        text,
        ACTIVATION_ONBOARDING_GOAL_KEYWORDS.MUSCLE_GAIN,
      )
    ) {
      return {
        commercialGoal: 'MUSCLE_GAIN',
        fitnessGoal: FitnessGoal.MUSCLE_GAIN,
      };
    }

    if (
      this.includesKeyword(
        text,
        ACTIVATION_ONBOARDING_GOAL_KEYWORDS.BODY_DEFINITION,
      )
    ) {
      return {
        commercialGoal: 'BODY_DEFINITION',
        fitnessGoal: FitnessGoal.MAINTENANCE,
      };
    }

    if (
      this.includesKeyword(text, ACTIVATION_ONBOARDING_GOAL_KEYWORDS.HEALTH)
    ) {
      return {
        commercialGoal: 'HEALTH',
        fitnessGoal: FitnessGoal.MAINTENANCE,
      };
    }

    if (
      this.includesKeyword(
        text,
        ACTIVATION_ONBOARDING_GOAL_KEYWORDS.SPORTS_PERFORMANCE,
      )
    ) {
      return {
        commercialGoal: 'SPORTS_PERFORMANCE',
        fitnessGoal: FitnessGoal.MAINTENANCE,
      };
    }

    return null;
  }

  private parseActivityLevel(text: string): ActivityLevel | null {
    if (
      this.includesKeyword(
        text,
        ACTIVATION_ONBOARDING_ACTIVITY_KEYWORDS.SEDENTARY,
      )
    ) {
      return ActivityLevel.SEDENTARY;
    }

    if (
      this.includesKeyword(text, ACTIVATION_ONBOARDING_ACTIVITY_KEYWORDS.LIGHT)
    ) {
      return ActivityLevel.LIGHT;
    }

    if (
      this.includesKeyword(
        text,
        ACTIVATION_ONBOARDING_ACTIVITY_KEYWORDS.MODERATE,
      )
    ) {
      return ActivityLevel.MODERATE;
    }

    if (
      this.includesKeyword(text, ACTIVATION_ONBOARDING_ACTIVITY_KEYWORDS.HIGH)
    ) {
      return ActivityLevel.HIGH;
    }

    if (
      this.includesKeyword(
        text,
        ACTIVATION_ONBOARDING_ACTIVITY_KEYWORDS.ATHLETE,
      )
    ) {
      return ActivityLevel.ATHLETE;
    }

    const weeklyFrequency = this.parseWeeklyTrainingFrequency(text);

    if (weeklyFrequency !== null) {
      if (weeklyFrequency <= 0) {
        return ActivityLevel.SEDENTARY;
      }

      if (weeklyFrequency <= 2) {
        return ActivityLevel.LIGHT;
      }

      if (weeklyFrequency <= 4) {
        return ActivityLevel.MODERATE;
      }

      return ActivityLevel.HIGH;
    }

    return null;
  }

  private parseTargetWeightKg(
    text: string,
    answers: ActivationOnboardingAnswers,
  ): { targetWeightKg: string | null; source: string | null } {
    const currentWeight = answers.currentWeightKg
      ? Number.parseFloat(answers.currentWeightKg)
      : null;

    if (!currentWeight || !Number.isFinite(currentWeight)) {
      return {
        targetWeightKg: null,
        source: null,
      };
    }

    const normalized = this.normalizeText(text);
    const numericMatch = normalized.match(
      /\b(\d{1,3}(?:[,.]\d{1,2})?)\s*(?:kg|quilo|quilos)?\b/,
    );

    if (numericMatch) {
      const numericValue = Number.parseFloat(numericMatch[1].replace(',', '.'));

      if (Number.isFinite(numericValue) && numericValue > 0) {
        if (/perder|eliminar|reduzir/.test(normalized)) {
          return {
            targetWeightKg: Math.max(30, currentWeight - numericValue).toFixed(
              2,
            ),
            source:
              ACTIVATION_ONBOARDING_TARGET_SOURCE.EXTRACTED_FROM_USER_TEXT,
          };
        }

        if (/ganhar|aumentar|subir/.test(normalized)) {
          return {
            targetWeightKg: Math.min(300, currentWeight + numericValue).toFixed(
              2,
            ),
            source:
              ACTIVATION_ONBOARDING_TARGET_SOURCE.EXTRACTED_FROM_USER_TEXT,
          };
        }

        if (/chegar|atingir|pesar|ficar/.test(normalized)) {
          return {
            targetWeightKg: numericValue.toFixed(2),
            source:
              ACTIVATION_ONBOARDING_TARGET_SOURCE.EXTRACTED_FROM_USER_TEXT,
          };
        }
      }
    }

    if (answers.fitnessGoal === FitnessGoal.WEIGHT_LOSS) {
      return {
        targetWeightKg: Math.max(30, currentWeight * 0.95).toFixed(2),
        source: ACTIVATION_ONBOARDING_TARGET_SOURCE.ESTIMATED_FROM_GOAL,
      };
    }

    if (answers.fitnessGoal === FitnessGoal.MUSCLE_GAIN) {
      return {
        targetWeightKg: Math.min(300, currentWeight * 1.05).toFixed(2),
        source: ACTIVATION_ONBOARDING_TARGET_SOURCE.ESTIMATED_FROM_GOAL,
      };
    }

    return {
      targetWeightKg: currentWeight.toFixed(2),
      source: ACTIVATION_ONBOARDING_TARGET_SOURCE.ESTIMATED_FROM_GOAL,
    };
  }

  private birthDateFromAge(age: number, at: Date): string {
    const birthDate = new Date(
      Date.UTC(at.getUTCFullYear() - age, at.getUTCMonth(), at.getUTCDate()),
    );

    return birthDate.toISOString().slice(0, 10);
  }

  private isPositiveReply(text: string): boolean {
    return ACTIVATION_ONBOARDING_POSITIVE_REPLIES.some(
      (reply) => text === reply || text.includes(reply),
    );
  }

  private includesKeyword(text: string, keywords: readonly string[]): boolean {
    return keywords.some((keyword) => text.includes(keyword));
  }

  private parseWeeklyTrainingFrequency(text: string): number | null {
    const numericMatch = text.match(
      /\b(\d{1,2})\s*(?:x|vez|vezes)\s*(?:por|na)?\s*semana\b/,
    );

    if (numericMatch) {
      return Number.parseInt(numericMatch[1], 10);
    }

    const wordNumbers: ReadonlyArray<readonly [string, number]> = [
      ['uma', 1],
      ['duas', 2],
      ['tres', 3],
      ['quatro', 4],
      ['cinco', 5],
      ['seis', 6],
      ['sete', 7],
    ];

    for (const [word, value] of wordNumbers) {
      if (
        new RegExp(`\\b${word}\\s+vezes\\s+(?:por|na)\\s+semana\\b`).test(text)
      ) {
        return value;
      }
    }

    return null;
  }

  private normalizeText(text: string): string {
    return text
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '');
  }

  private correctPhysicalAnswer(
    answers: ActivationOnboardingAnswers,
    text: string,
    at: Date,
  ): ActivationOnboardingAnswers | null {
    const body = this.normalizeText(text).match(
      /^(?:corrigindo|na verdade|quero corrigir)[:,]?\s+(.+)$/u,
    )?.[1];
    if (!body) return null;
    if (
      /^(?:(?:minha )?idade(?: e|:)?\s+|tenho\s+)\d{1,3}(?:\s+anos)?$/u.test(
        body,
      )
    ) {
      const age = this.parseAge(body);
      return age === null
        ? null
        : { ...answers, age, birthDate: this.birthDateFromAge(age, at) };
    }
    const height = body.match(/^(?:minha )?altura(?: e|:)?\s+(.+)$/u)?.[1];
    if (height) {
      const heightCm = this.parseHeightCm(height);
      return heightCm === null ? null : { ...answers, heightCm };
    }
    const weight = body.match(
      /^(?:meu )?peso(?: atual)?(?: e|:)?\s+(.+)$/u,
    )?.[1];
    if (weight) {
      const currentWeightKg = this.parseWeightKg(weight);
      return currentWeightKg === null ? null : { ...answers, currentWeightKg };
    }
    return null;
  }

  private normalizeContent(
    value: Prisma.JsonValue,
  ): ActivationOnboardingSessionContent | null {
    if (!this.isRecord(value)) {
      return null;
    }

    if (
      value.version !== ACTIVATION_ONBOARDING_VERSION ||
      value.source !== ACTIVATION_ONBOARDING_SOURCE ||
      !this.isState(value.currentState) ||
      !this.isStatus(value.status) ||
      typeof value.activationId !== 'string' ||
      typeof value.startedAt !== 'string' ||
      typeof value.updatedAt !== 'string'
    ) {
      return null;
    }

    return {
      version: value.version,
      source: value.source,
      activationId: value.activationId,
      status: value.status,
      currentState: value.currentState,
      previousState: this.optionalState(value.previousState),
      expectedNextState: this.optionalState(value.expectedNextState),
      startMode: this.optionalStartMode(value.startMode),
      userFirstName:
        typeof value.userFirstName === 'string' ? value.userFirstName : null,
      answers: this.normalizeAnswers(value.answers),
      dietary: this.normalizeDietary(value.dietary),
      pendingInput: this.normalizePendingInput(value.pendingInput),
      lastProcessedMessageId:
        typeof value.lastProcessedMessageId === 'string'
          ? value.lastProcessedMessageId
          : null,
      lastPromptState: this.optionalState(value.lastPromptState),
      lastPromptAt:
        typeof value.lastPromptAt === 'string' ? value.lastPromptAt : null,
      startedAt: value.startedAt,
      updatedAt: value.updatedAt,
      completedAt:
        typeof value.completedAt === 'string' ? value.completedAt : null,
    };
  }

  private normalizeAnswers(value: unknown): ActivationOnboardingAnswers {
    if (!this.isRecord(value)) {
      return this.emptyAnswers();
    }

    return {
      age: typeof value.age === 'number' ? value.age : null,
      birthDate: typeof value.birthDate === 'string' ? value.birthDate : null,
      heightCm: typeof value.heightCm === 'number' ? value.heightCm : null,
      currentWeightKg:
        typeof value.currentWeightKg === 'string'
          ? value.currentWeightKg
          : null,
      gender:
        value.gender === 'MALE' || value.gender === 'FEMALE'
          ? value.gender
          : null,
      commercialGoal:
        typeof value.commercialGoal === 'string' ? value.commercialGoal : null,
      fitnessGoal:
        value.fitnessGoal === 'WEIGHT_LOSS' ||
        value.fitnessGoal === 'MUSCLE_GAIN' ||
        value.fitnessGoal === 'MAINTENANCE'
          ? value.fitnessGoal
          : null,
      activityLevel:
        value.activityLevel === 'SEDENTARY' ||
        value.activityLevel === 'LIGHT' ||
        value.activityLevel === 'MODERATE' ||
        value.activityLevel === 'HIGH' ||
        value.activityLevel === 'ATHLETE'
          ? value.activityLevel
          : null,
      restrictions: Array.isArray(value.restrictions)
        ? value.restrictions.filter(
            (restriction): restriction is string =>
              typeof restriction === 'string',
          )
        : [],
      desiredResultText:
        typeof value.desiredResultText === 'string'
          ? value.desiredResultText
          : null,
      targetWeightKg:
        typeof value.targetWeightKg === 'string' ? value.targetWeightKg : null,
      targetWeightSource:
        typeof value.targetWeightSource === 'string'
          ? value.targetWeightSource
          : null,
    };
  }

  private normalizeDietary(
    value: unknown,
  ): NonNullable<ActivationOnboardingSessionContent['dietary']> {
    const empty = this.dietary.empty();
    if (
      !this.isRecord(value) ||
      ![
        'UNKNOWN',
        'DETAILS_REQUIRED',
        'CONFIRMATION_PENDING',
        'CONFIRMED',
      ].includes(String(value.status))
    )
      return empty;
    const fields = [
      'allergies',
      'intolerances',
      'avoidedFoods',
      'otherRestrictions',
      'rawRestrictions',
    ] as const;
    for (const field of fields) {
      const items = value[field];
      if (
        !Array.isArray(items) ||
        !items.every((item) => typeof item === 'string')
      )
        return empty;
      empty[field] = items.filter(
        (item): item is string => typeof item === 'string',
      );
    }
    empty.status = value.status as typeof empty.status;
    empty.allergiesExplicit = value.allergiesExplicit === true;
    empty.specifiedCategories = Array.isArray(value.specifiedCategories)
      ? value.specifiedCategories.filter(
          (item): item is (typeof empty.specifiedCategories)[number] =>
            [
              'allergies',
              'intolerances',
              'avoidedFoods',
              'otherRestrictions',
            ].includes(String(item)),
        )
      : [];
    empty.returnState = this.optionalState(value.returnState);
    return empty;
  }

  private mergeDietary(
    previous: NonNullable<ActivationOnboardingSessionContent['dietary']>,
    next: NonNullable<ActivationOnboardingSessionContent['dietary']>,
    append: boolean,
  ) {
    const result = {
      ...previous,
      status: next.status,
      returnState: previous.returnState,
      allergiesExplicit: previous.allergiesExplicit || next.allergiesExplicit,
      specifiedCategories: [
        ...new Set([
          ...previous.specifiedCategories,
          ...next.specifiedCategories,
        ]),
      ],
      rawRestrictions: [...next.rawRestrictions],
    };
    for (const category of next.specifiedCategories)
      result[category] = append
        ? [...new Set([...previous[category], ...next[category]])]
        : [...next[category]];
    result.rawRestrictions = [
      ...result.allergies,
      ...result.intolerances,
      ...result.avoidedFoods,
      ...result.otherRestrictions,
    ];
    return result;
  }

  private toJson(
    content: ActivationOnboardingSessionContent,
  ): Prisma.InputJsonObject {
    return {
      version: content.version,
      source: content.source,
      activationId: content.activationId,
      status: content.status,
      currentState: content.currentState,
      previousState: content.previousState,
      expectedNextState: content.expectedNextState,
      startMode: content.startMode,
      userFirstName: content.userFirstName,
      answers: {
        age: content.answers.age,
        birthDate: content.answers.birthDate,
        heightCm: content.answers.heightCm,
        currentWeightKg: content.answers.currentWeightKg,
        gender: content.answers.gender,
        commercialGoal: content.answers.commercialGoal,
        fitnessGoal: content.answers.fitnessGoal,
        activityLevel: content.answers.activityLevel,
        restrictions: content.answers.restrictions,
        desiredResultText: content.answers.desiredResultText,
        targetWeightKg: content.answers.targetWeightKg,
        targetWeightSource: content.answers.targetWeightSource,
      },
      dietary: content.dietary ? { ...content.dietary } : null,
      pendingInput: content.pendingInput
        ? {
            messageId: content.pendingInput.messageId,
            text: content.pendingInput.text,
            receivedAt: content.pendingInput.receivedAt,
          }
        : null,
      lastProcessedMessageId: content.lastProcessedMessageId,
      lastPromptState: content.lastPromptState,
      lastPromptAt: content.lastPromptAt,
      startedAt: content.startedAt,
      updatedAt: content.updatedAt,
      completedAt: content.completedAt,
    };
  }

  private summary(content: ActivationOnboardingSessionContent): string {
    return `${ACTIVATION_ONBOARDING_MEMORY_SUMMARY}: ${content.currentState}`;
  }

  private firstName(name: string | null | undefined): string | null {
    const trimmed = name?.trim();

    if (!trimmed) {
      return null;
    }

    return trimmed.split(/\s+/, 1)[0] ?? null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private optionalState(value: unknown): ActivationOnboardingState | null {
    return this.isState(value) ? value : null;
  }

  private optionalStartMode(
    value: unknown,
  ): ActivationOnboardingStartMode | null {
    return this.isStartMode(value) ? value : null;
  }

  private normalizePendingInput(
    value: unknown,
  ): ActivationOnboardingPendingInput | null {
    if (!this.isRecord(value)) {
      return null;
    }

    if (
      typeof value.messageId !== 'string' ||
      typeof value.text !== 'string' ||
      typeof value.receivedAt !== 'string'
    ) {
      return null;
    }

    return {
      messageId: value.messageId,
      text: value.text,
      receivedAt: value.receivedAt,
    };
  }

  private isState(value: unknown): value is ActivationOnboardingState {
    return (
      typeof value === 'string' &&
      Object.values(ACTIVATION_ONBOARDING_STATE).includes(
        value as ActivationOnboardingState,
      )
    );
  }

  private isStartMode(value: unknown): value is ActivationOnboardingStartMode {
    return (
      typeof value === 'string' &&
      Object.values(ACTIVATION_ONBOARDING_START_MODE).includes(
        value as ActivationOnboardingStartMode,
      )
    );
  }

  private isStatus(
    value: unknown,
  ): value is ActivationOnboardingSessionContent['status'] {
    return (
      typeof value === 'string' &&
      Object.values(ACTIVATION_ONBOARDING_STATUS).includes(
        value as ActivationOnboardingSessionContent['status'],
      )
    );
  }
}
