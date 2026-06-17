import {
  ConflictException,
  Injectable,
  NotFoundException,
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
  ) {}

  async buildNutritionResponse(mealAnalysisId: string) {
    const reference = await this.prisma.mealAnalysis.findUnique({
      where: {
        id: mealAnalysisId,
      },
      select: {
        meal: {
          select: {
            userId: true,
          },
        },
      },
    });

    if (!reference) {
      throw new NotFoundException('Análise nutricional não encontrada');
    }

    const [context, longitudinal] = await Promise.all([
      this.intelligenceService.buildUserNutritionContext(reference.meal.userId),
      this.longitudinal.getResponseContext(reference.meal.userId),
    ]);
    const behavior = await this.behavioralIntelligence.refreshSignals(
      reference.meal.userId,
    );
    const proactiveRecommendations =
      await this.recommendationService.refreshForUser(reference.meal.userId);
    const coach = await this.coachIntelligence.getResponseSignals(
      reference.meal.userId,
    );
    const adaptive = coach.adaptive;

    return this.prisma.$transaction(async (transaction) => {
      const analysis = await transaction.mealAnalysis.findUnique({
        where: {
          id: mealAnalysisId,
        },
        include: {
          items: {
            orderBy: {
              id: 'asc',
            },
          },
          meal: true,
          qualityScore: true,
          aiJob: {
            select: {
              id: true,
              promptVersionId: true,
              usage: {
                select: {
                  estimatedCost: true,
                },
              },
            },
          },
        },
      });

      if (!analysis) {
        throw new NotFoundException('Análise nutricional não encontrada');
      }

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

      const nutritionRecommendations =
        await transaction.nutritionRecommendation.findMany({
          where: {
            userId: analysis.meal.userId,
            active: true,
          },
          orderBy: [{ priority: 'asc' }, { generatedAt: 'desc' }],
          take: 3,
        });
      const recommendations = this.mergeRecommendations(
        proactiveRecommendations,
        nutritionRecommendations,
        adaptive,
      );
      const content = this.nutritionFormatter.format(analysis, {
        context,
        recommendations,
        coach,
        behavior,
        longitudinal,
      });
      const decision = this.responseEvaluation.evaluate(
        content,
        AIResponseEvaluationType.NUTRITION_RESPONSE,
        {
          goal: context.goal,
          memoryCount: context.memories.length,
          recentMealCount: context.recentMeals.length,
          insightCount: context.activeInsights.length,
          recommendationCount: recommendations.length,
          behaviorStage: behavior.stage,
          adherenceScore: behavior.adherenceScore,
        },
      );
      const outbound = await transaction.outboundMessage.upsert({
        where: {
          mealAnalysisId,
        },
        update: {
          content: decision.finalContent,
        },
        create: {
          userId: analysis.meal.userId,
          conversationId: analysis.meal.conversationId,
          sourceMessageId: analysis.meal.messageId,
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
        messageId: analysis.meal.messageId,
        responseId: outbound.id,
        promptVersionId: analysis.aiJob?.promptVersionId ?? null,
        estimatedCost,
        decision,
      });

      await this.publishOutbound(transaction, outbound);

      return outbound;
    });
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
        title: recommendation.title,
        rationale: recommendation.reason,
        action: recommendation.description,
      })),
      ...nutrition,
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
