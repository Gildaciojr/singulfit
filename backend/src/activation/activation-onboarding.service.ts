import { Injectable } from '@nestjs/common';
import {
  ActivityLevel,
  FitnessGoal,
  Gender,
  MemoryType,
  MessageDirection,
  MessageType,
  Prisma,
  UserGoalType,
} from '@prisma/client';
import { EventBusService } from '../event-bus/event-bus.service';
import { INTERNAL_EVENT } from '../event-bus/event-bus.constants';
import { EvolutionGateway } from '../evolution/evolution.gateway';
import { PrismaService } from '../prisma/prisma.service';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionGateway,
    private readonly eventBus: EventBusService,
  ) {}

  async start(
    input: StartActivationOnboardingInput,
  ): Promise<ActivationOnboardingSession> {
    const existing = await this.get(input.userId);

    if (existing) {
      return existing;
    }

    const startedAt = input.startedAt ?? new Date();
    const content = this.initialContent(input, startedAt);

    return this.persist({
      userId: input.userId,
      content,
      generatedAt: startedAt,
    });
  }

  async get(userId: string): Promise<ActivationOnboardingSession | null> {
    const memory = await this.prisma.conversationMemory.findUnique({
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
  ): Promise<ActivationOnboardingSession> {
    const profile = this.profileData(content);

    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        WITH advisory_lock AS (
          SELECT pg_advisory_xact_lock(
            hashtext(${`activation-onboarding-completion:${userId}`})
          )
        )
        SELECT true AS "locked"
        FROM advisory_lock
      `;

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
          aggregateId: `${ACTIVATION_ONBOARDING_PROFILE_SOURCE_KEY}:${userId}`,
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
    });
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

    if (session.content.status === ACTIVATION_ONBOARDING_STATUS.COMPLETED) {
      return {
        handled: false,
        duplicated: false,
        state: session.content.currentState,
        reason: 'ONBOARDING_COMPLETED',
      };
    }

    if (session.content.lastProcessedMessageId === input.messageId) {
      return {
        handled: true,
        duplicated: true,
        state: session.content.currentState,
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

    const user = await this.prisma.user.findUnique({
      where: {
        id: input.userId,
      },
      select: {
        phone: true,
        phoneE164: true,
      },
    });

    if (!user) {
      return {
        handled: false,
        duplicated: false,
        state: session.content.currentState,
        reason: 'USER_NOT_FOUND',
      };
    }

    const now = input.receivedAt ?? message.timestamp;
    const transition = this.transition(session.content, message.content, now);
    const content: ActivationOnboardingSessionContent = {
      ...transition.content,
      lastProcessedMessageId: message.id,
      pendingInput: {
        messageId: message.id,
        text: message.content,
        receivedAt: now.toISOString(),
      },
      updatedAt: now.toISOString(),
    };
    const persisted =
      content.currentState === ACTIVATION_ONBOARDING_STATE.PROFILE_COMPLETED
        ? await this.completeWithProfile(input.userId, content, now)
        : await this.persist({
            userId: input.userId,
            content,
            generatedAt: now,
          });

    await this.evolution.sendText({
      number: user.phoneE164 ?? user.phone,
      text: this.messageForState(
        persisted.content.currentState,
        persisted.content.userFirstName,
      ),
    });

    return {
      handled: true,
      duplicated: false,
      state: persisted.content.currentState,
    };
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
    const restrictions: Prisma.InputJsonArray = profile.restrictions.map(
      (restriction) => ({
        type: ACTIVATION_ONBOARDING_RESTRICTION_TYPE,
        description: restriction,
      }),
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
        allergies: [],
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
    let currentState = content.currentState;
    let previousState: ActivationOnboardingState | null = content.currentState;
    let startMode = content.startMode;
    let completedAt = content.completedAt;

    if (
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
    } else if (currentState === ACTIVATION_ONBOARDING_STATE.ASK_RESTRICTIONS) {
      answers.restrictions = this.parseRestrictions(text);
      currentState = ACTIVATION_ONBOARDING_STATE.ASK_DESIRED_RESULT;
    } else if (
      currentState === ACTIVATION_ONBOARDING_STATE.ASK_DESIRED_RESULT
    ) {
      answers.desiredResultText = text.trim();
      const target = this.parseTargetWeightKg(text, answers);
      answers.targetWeightKg = target.targetWeightKg;
      answers.targetWeightSource = target.source;
      currentState = ACTIVATION_ONBOARDING_STATE.PROFILE_COMPLETED;
      completedAt = at.toISOString();
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

  private parseRestrictions(text: string): string[] {
    const trimmed = text.trim();
    const normalized = this.normalizeText(trimmed);

    if (!trimmed || this.hasNoRestrictions(normalized)) {
      return [];
    }

    return trimmed
      .split(/[,;]+/)
      .map((restriction) => restriction.trim())
      .filter((restriction) => restriction.length > 0);
  }

  private hasNoRestrictions(text: string): boolean {
    return /^(nenhuma|nenhum|nao|não|nao tenho|nao tenho restricao|nao tenho restricoes|não tenho restrições|sem restricao|sem restricoes|sem restrição|sem restrições)$/u.test(
      text,
    );
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
