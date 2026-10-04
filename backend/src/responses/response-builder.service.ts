import { ConversationContinuationService } from '../conversation/runtime/conversation-continuation.service';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  AIResponseEvaluationType,
  MealAnalysisStatus,
  MealSource,
  Prisma,
  ResponseType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../event-bus/event-bus.service';
import { INTERNAL_EVENT } from '../event-bus/event-bus.constants';
import { ListResponsesQueryDto } from './dto/list-responses-query.dto';
import { NutritionResponseFormatter } from './nutrition-response.formatter';
import { NutritionIntelligenceService } from '../nutrition/nutrition-intelligence.service';
import { CoachIntelligenceService } from '../automation/coach-intelligence.service';
import { BehavioralIntelligenceService } from '../behavior/behavioral-intelligence.service';
import { AIResponseEvaluationService } from '../ai-quality/ai-response-evaluation.service';
import { RecommendationService } from '../recommendations/recommendation.service';
import { LongitudinalService } from '../longitudinal/longitudinal.service';
import { AdaptiveIntelligenceSignals } from '../adaptive-intelligence/interfaces/adaptive-intelligence.interface';
import { NutritionConversationShadowPipelineService } from './nutrition-conversation-shadow-pipeline.service';
import { NutritionConversationEpisodicMemoryIntegrationService } from './nutrition-conversation-episodic-memory-integration.service';

@Injectable()
export class ResponseBuilderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly nutritionFormatter: NutritionResponseFormatter,
    private readonly eventBus: EventBusService,
    private readonly intelligenceService: NutritionIntelligenceService,
    private readonly coachIntelligence: CoachIntelligenceService,
    private readonly behavioralIntelligence: BehavioralIntelligenceService,
    private readonly responseEvaluation: AIResponseEvaluationService,
    private readonly recommendationService: RecommendationService,
    private readonly longitudinal: LongitudinalService,
    private readonly nutritionConversationShadowPipeline: NutritionConversationShadowPipelineService,
    private readonly episodicMemoryIntegration: NutritionConversationEpisodicMemoryIntegrationService,
    @Optional()
    private readonly continuations?: ConversationContinuationService,
  ) {}

  async buildNutritionResponse(
    mealAnalysisId: string,
    expectedUserId?: string,
  ) {
    const analysis = await this.prisma.mealAnalysis.findUnique({
      where: { id: mealAnalysisId },
      include: {
        items: { orderBy: { id: 'asc' } },
        meal: true,
        qualityScore: true,
        aiJob: {
          select: {
            id: true,
            userId: true,
            conversationId: true,
            messageId: true,
            promptVersionId: true,
            usage: { select: { estimatedCost: true } },
          },
        },
      },
    });
    if (!analysis) {
      throw new NotFoundException('Análise nutricional não encontrada');
    }
    if (
      analysis.id !== mealAnalysisId ||
      (expectedUserId !== undefined && analysis.meal.userId !== expectedUserId)
    )
      throw new ConflictException('Nutrition response ownership mismatch');
    if (analysis.status !== MealAnalysisStatus.COMPLETED) {
      throw new ConflictException(
        'Análise nutricional ainda não foi concluída',
      );
    }
    if (
      !analysis.meal.conversationId ||
      !analysis.meal.messageId ||
      analysis.meal.source !== MealSource.WHATSAPP
    ) {
      throw new ConflictException(
        'Análise não possui origem WhatsApp compatível com resposta',
      );
    }
    const conversationId = analysis.meal.conversationId;
    const sourceMessageId = analysis.meal.messageId;
    if (expectedUserId !== undefined) {
      const source = await this.prisma.message.findUnique({
        where: { id: sourceMessageId },
        select: {
          id: true,
          conversationId: true,
          conversation: { select: { userId: true } },
        },
      });
      if (
        !source ||
        source.id !== sourceMessageId ||
        source.conversationId !== conversationId ||
        source.conversation.userId !== expectedUserId
      )
        throw new ConflictException(
          'Nutrition response source ownership mismatch',
        );
    }
    if (
      expectedUserId !== undefined &&
      analysis.aiJob &&
      (analysis.aiJob.userId !== expectedUserId ||
        analysis.aiJob.conversationId !== conversationId ||
        analysis.aiJob.messageId !== sourceMessageId)
    )
      throw new ConflictException('Nutrition response job ownership mismatch');
    const sent = this.continuations?.enabled(analysis.meal.userId)
      ? await this.prisma.outboundMessage.findFirst({
          where: {
            mealAnalysisId,
            userId: analysis.meal.userId,
            conversationId,
            sourceMessageId,
            status: { in: ['SENT', 'DELIVERED'] },
          },
        })
      : null;
    if (sent) return sent;

    const [context, longitudinal] = await Promise.all([
      this.intelligenceService.buildUserNutritionContext(analysis.meal.userId),
      this.longitudinal.getResponseContext(analysis.meal.userId),
    ]);
    if (context.userId !== analysis.meal.userId)
      throw new ConflictException(
        'Nutrition response context ownership mismatch',
      );
    const behavior = await this.behavioralIntelligence.refreshSignals(
      analysis.meal.userId,
    );
    const proactiveRecommendations =
      await this.recommendationService.refreshForUser(analysis.meal.userId);
    const coach = await this.coachIntelligence.getResponseSignals(
      analysis.meal.userId,
    );
    const adaptive = coach.adaptive;
    const nutritionRecommendations =
      await this.prisma.nutritionRecommendation.findMany({
        where: { userId: analysis.meal.userId, active: true },
        orderBy: [{ priority: 'asc' }, { generatedAt: 'desc' }],
        take: 3,
      });
    const recommendations = this.mergeRecommendations(
      proactiveRecommendations,
      nutritionRecommendations,
      adaptive,
    );
    const conversationInput = {
      analysis,
      context,
      recommendations,
      coach,
      behavior,
      longitudinal,
    };
    const formatterContent = this.nutritionFormatter.format(analysis, {
      context,
      recommendations,
      coach,
      behavior,
      longitudinal,
    });
    const evaluationContext = {
      goal: context.goal,
      memoryCount: context.memories.length,
      recentMealCount: context.recentMeals.length,
      insightCount: context.activeInsights.length,
      recommendationCount: recommendations.length,
      behaviorStage: behavior.stage,
      adherenceScore: behavior.adherenceScore,
    };
    const legacyDecision = this.responseEvaluation.evaluate(
      formatterContent,
      AIResponseEvaluationType.NUTRITION_RESPONSE,
      evaluationContext,
    );
    const officialSelectionEnabled =
      this.nutritionConversationShadowPipeline.isOfficialSelectionEnabled(
        analysis.meal.userId,
      );
    const episodicMemory = officialSelectionEnabled
      ? await this.episodicMemoryIntegration
          .loadForContext(conversationInput)
          .catch(() => Object.freeze([]))
      : Object.freeze([]);
    const selectionInput = {
      operation: {
        userId: analysis.meal.userId,
        conversationId,
        messageId: sourceMessageId,
      },
      conversation: { ...conversationInput, episodicMemory },
      reasoning: { longitudinalContext: conversationInput.longitudinal },
      legacyText: legacyDecision.finalContent,
    };
    const mealContinuation = await this.continuations?.mediaReply(
      analysis.meal.userId,
      sourceMessageId,
      analysis.items
        .map(
          (item) =>
            `${item.foodName}: ${item.estimatedGrams?.toString() ?? 'quantidade não determinada'} g estimados`,
        )
        .join(', '),
    );
    const selection = mealContinuation
      ? { content: mealContinuation.content, candidateExecutionAttempted: true }
      : await this.nutritionConversationShadowPipeline.selectOfficial(
          selectionInput,
        );
    const evaluatedDecision = mealContinuation
      ? this.responseEvaluation.evaluate(
          mealContinuation.content,
          AIResponseEvaluationType.NUTRITION_RESPONSE,
          evaluationContext,
        )
      : selection.content === legacyDecision.finalContent
        ? legacyDecision
        : this.responseEvaluation.evaluate(
            selection.content,
            AIResponseEvaluationType.NUTRITION_RESPONSE,
            evaluationContext,
          );
    const decision =
      mealContinuation && this.continuations
        ? {
            ...evaluatedDecision,
            finalContent: this.continuations.publicText(
              evaluatedDecision.finalContent,
            ),
          }
        : evaluatedDecision;

    const outbound = await this.prisma.$transaction(async (transaction) => {
      if (mealContinuation && this.continuations) {
        if (!this.continuations.enabled(analysis.meal.userId))
          throw new ConflictException(
            'Continuation runtime disabled before media commit',
          );
        const completed = mealContinuation.pending
          ? await this.continuations.completeMedia(
              transaction,
              analysis.meal.userId,
              conversationId,
              sourceMessageId,
              mealContinuation,
            )
          : true;
        if (completed === false)
          throw new ConflictException('Continuation media commit unavailable');
      }
      const outbound = await transaction.outboundMessage.upsert({
        where: {
          mealAnalysisId,
        },
        update: {
          content: decision.finalContent,
        },
        create: {
          userId: analysis.meal.userId,
          conversationId,
          sourceMessageId,
          mealAnalysisId: analysis.id,
          responseType: ResponseType.NUTRITION_ANALYSIS,
          content: decision.finalContent,
        },
      });
      const estimatedCost =
        analysis.aiJob?.usage.reduce(
          (total, usage) => total.add(usage.estimatedCost),
          new Prisma.Decimal(0),
        ) ?? new Prisma.Decimal(0);

      await this.responseEvaluation.persistInTransaction(transaction, {
        userId: analysis.meal.userId,
        aiJobId: analysis.aiJob?.id ?? null,
        messageId: sourceMessageId,
        responseId: outbound.id,
        promptVersionId: analysis.aiJob?.promptVersionId ?? null,
        estimatedCost,
        decision,
      });

      await this.publishOutbound(transaction, outbound);
      if (
        mealContinuation &&
        !this.continuations?.enabled(analysis.meal.userId)
      )
        throw new ConflictException(
          'Continuation runtime disabled before response commit',
        );
      return outbound;
    });

    if (!selection.candidateExecutionAttempted) {
      void this.episodicMemoryIntegration
        .loadForContext(conversationInput)
        .then((shadowMemory) =>
          this.nutritionConversationShadowPipeline.execute({
            ...selectionInput,
            conversation: {
              ...selectionInput.conversation,
              episodicMemory: shadowMemory,
            },
            legacyText: decision.finalContent,
          }),
        )
        .catch(() => undefined);
    }
    this.episodicMemoryIntegration.captureAfterCommit(conversationInput);

    return outbound;
  }

  async buildUsageLimitResponse(mealId: string, content: string) {
    return this.prisma.$transaction(async (transaction) => {
      const meal = await transaction.meal.findUnique({
        where: {
          id: mealId,
        },
        select: {
          userId: true,
          conversationId: true,
          messageId: true,
          source: true,
        },
      });

      if (
        !meal ||
        !meal.conversationId ||
        !meal.messageId ||
        meal.source !== MealSource.WHATSAPP
      ) {
        throw new ConflictException(
          'Refeição não possui origem WhatsApp compatível com resposta',
        );
      }

      const outbound = await transaction.outboundMessage.upsert({
        where: {
          sourceMessageId_responseType: {
            sourceMessageId: meal.messageId,
            responseType: ResponseType.USAGE_LIMIT,
          },
        },
        update: {},
        create: {
          userId: meal.userId,
          conversationId: meal.conversationId,
          sourceMessageId: meal.messageId,
          responseType: ResponseType.USAGE_LIMIT,
          content,
        },
      });

      await this.publishOutbound(transaction, outbound);

      return outbound;
    });
  }

  async listByConversation(
    conversationId: string,
    query: ListResponsesQueryDto,
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: {
        id: conversationId,
      },
      select: {
        id: true,
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversa não encontrada');
    }

    const limit = query.limit ?? 50;
    const responses = await this.prisma.outboundMessage.findMany({
      where: {
        conversationId,
      },
      orderBy: [
        {
          createdAt: 'desc',
        },
        {
          id: 'desc',
        },
      ],
      cursor: query.cursor
        ? {
            id: query.cursor,
          }
        : undefined,
      skip: query.cursor ? 1 : 0,
      take: limit + 1,
    });
    const hasMore = responses.length > limit;
    const items = hasMore ? responses.slice(0, limit) : responses;

    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private publishOutbound(
    transaction: Prisma.TransactionClient,
    outbound: {
      id: string;
      userId: string;
      conversationId: string;
      sourceMessageId: string;
      responseType: ResponseType;
    },
  ) {
    return this.eventBus.publish(
      {
        eventType: INTERNAL_EVENT.OUTBOUND_MESSAGE_REQUESTED,
        aggregateType: 'OUTBOUND_MESSAGE',
        aggregateId: outbound.id,
        payload: {
          outboundMessageId: outbound.id,
          userId: outbound.userId,
          conversationId: outbound.conversationId,
          sourceMessageId: outbound.sourceMessageId,
          responseType: outbound.responseType,
        },
      },
      transaction,
    );
  }

  private mergeRecommendations(
    proactive: Array<{
      id: string;
      title: string;
      description: string;
      reason: string;
    }>,
    nutrition: Array<{
      id: string;
      title: string;
      rationale: string;
      action: string;
    }>,
    adaptive: AdaptiveIntelligenceSignals,
  ) {
    const ranks = new Map(
      adaptive.recommendationRanking.map((item) => [
        item.recommendationId,
        item.rank,
      ]),
    );
    const adaptiveProactive = [...proactive].sort(
      (left, right) =>
        (ranks.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (ranks.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    );
    const merged = [
      ...adaptiveProactive.map((recommendation) => ({
        recommendationId: recommendation.id,
        title: recommendation.title,
        rationale: recommendation.reason,
        action: recommendation.description,
      })),
      ...nutrition.map((recommendation) => ({
        recommendationId: recommendation.id,
        title: recommendation.title,
        rationale: recommendation.rationale,
        action: recommendation.action,
      })),
    ];
    const seen = new Set<string>();

    return merged
      .filter((recommendation) => {
        const key = this.normalizedText(
          `${recommendation.title}:${recommendation.action}`,
        );

        if (seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      })
      .slice(0, 3);
  }

  private normalizedText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('pt-BR')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
