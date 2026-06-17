import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AIJobType,
  MealAnalysisStatus,
  MealCategory,
  Prisma,
  Severity,
} from '@prisma/client';
import { AIService } from '../ai/ai.service';
import { OpenAIResponseResult } from '../ai/interfaces/openai.interface';
import { PrismaService } from '../prisma/prisma.service';
import { MediaService } from '../storage/media.service';
import {
  ParsedNutritionAnalysis,
  NutritionAnalysisResult,
  NutritionFoodResult,
} from './interfaces/nutrition-analysis.interface';
import {
  NUTRITION_VISION_JSON_SCHEMA,
  NUTRITION_VISION_PROMPT_NAME,
  NUTRITION_VISION_SCHEMA_NAME,
} from './nutrition.constants';
import { NutritionService } from './nutrition.service';
import { AuditService } from '../observability/audit.service';
import { EventService } from '../observability/event.service';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
} from '../observability/observability.constants';
import { EventBusService } from '../event-bus/event-bus.service';
import { INTERNAL_EVENT } from '../event-bus/event-bus.constants';
import { NutritionIntelligenceService } from './nutrition-intelligence.service';
import { NutritionUserContext } from './interfaces/nutrition-context.interface';

const MAX_NUTRITION_VALUE = 1_000_000;

@Injectable()
export class NutritionVisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly nutritionService: NutritionService,
    private readonly aiService: AIService,
    private readonly mediaService: MediaService,
    private readonly auditService: AuditService,
    private readonly eventService: EventService,
    private readonly eventBus: EventBusService,
    private readonly intelligenceService: NutritionIntelligenceService,
  ) {}

  async analyzeMeal(mealId: string) {
    const meal = await this.nutritionService.getMeal(mealId);

    if (!meal.analysis) {
      throw new NotFoundException('Análise da refeição não encontrada');
    }

    if (!meal.mediaFileId || !meal.messageId || !meal.conversationId) {
      throw new ConflictException(
        'Refeição legada não possui mídia e conversa vinculadas',
      );
    }

    if (meal.analysis.status === MealAnalysisStatus.COMPLETED) {
      return meal;
    }

    if (meal.analysis.status !== MealAnalysisStatus.PENDING) {
      throw new ConflictException('Análise já processada ou em andamento');
    }

    const job = await this.aiService.createJob({
      userId: meal.userId,
      conversationId: meal.conversationId,
      messageId: meal.messageId,
      type: AIJobType.IMAGE,
      promptName: NUTRITION_VISION_PROMPT_NAME,
    });
    const startedAt = new Date();

    await this.prisma.$transaction(async (transaction) => {
      const analysisClaim = await transaction.mealAnalysis.updateMany({
        where: {
          id: meal.analysis?.id,
          status: MealAnalysisStatus.PENDING,
        },
        data: {
          status: MealAnalysisStatus.PROCESSING,
          aiJobId: job.id,
          processingStartedAt: startedAt,
        },
      });

      if (analysisClaim.count !== 1) {
        throw new ConflictException('Análise já processada ou em andamento');
      }
    });

    let response: OpenAIResponseResult | undefined;

    try {
      const context = await this.intelligenceService.buildUserNutritionContext(
        meal.userId,
      );
      const image = await this.mediaService.getImageDataUrl(meal.mediaFileId);
      response = await this.aiService.runVisionJob(job.id, {
        input: this.buildAnalysisInput(context),
        imageUrl: image.dataUrl,
        jsonSchema: {
          name: NUTRITION_VISION_SCHEMA_NAME,
          description:
            'Alimentos, porções e totais nutricionais estimados da refeição.',
          schema: NUTRITION_VISION_JSON_SCHEMA,
        },
      });
      const parsed = this.parseResponse(response.outputText);

      return await this.completeAnalysis(
        meal.id,
        meal.analysis.id,
        job.id,
        meal.userId,
        response,
        parsed,
        context,
      );
    } catch (error: unknown) {
      await this.failAnalysis(
        meal.analysis.id,
        job.id,
        meal.userId,
        response,
        error,
      );
      throw error;
    }
  }

  private async completeAnalysis(
    mealId: string,
    mealAnalysisId: string,
    aiJobId: string,
    userId: string,
    response: OpenAIResponseResult,
    parsed: ParsedNutritionAnalysis,
    context: NutritionUserContext,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      if (parsed.result.foods.length > 0) {
        await transaction.mealItem.createMany({
          data: parsed.result.foods.map((food) => ({
            mealAnalysisId,
            foodName: food.foodName,
            estimatedGrams: this.toDecimal(food.estimatedGrams),
            calories: this.toDecimal(food.calories),
            protein: this.toDecimal(food.protein),
            carbs: this.toDecimal(food.carbs),
            fat: this.toDecimal(food.fat),
            fiber: this.toDecimal(food.fiber),
            sugar: this.toDecimal(food.sugar),
            isUltraProcessed: food.isUltraProcessed,
            isVegetable: food.isVegetable,
          })),
        });
      }

      await transaction.mealAnalysis.update({
        where: {
          id: mealAnalysisId,
        },
        data: {
          status: MealAnalysisStatus.COMPLETED,
          confidence: new Prisma.Decimal(parsed.result.confidence.toFixed(4)),
          totalCalories: this.toDecimal(parsed.result.totalCalories),
          totalProtein: this.toDecimal(parsed.result.protein),
          totalCarbs: this.toDecimal(parsed.result.carbs),
          totalFat: this.toDecimal(parsed.result.fat),
          totalFiber: this.toDecimal(parsed.result.fiber),
          totalSugar: this.toDecimal(parsed.result.sugar),
          ultraProcessedRatio: new Prisma.Decimal(
            parsed.result.ultraProcessedRatio.toFixed(4),
          ),
          vegetableGrams: this.toDecimal(parsed.result.vegetableGrams),
          hydrationMl: this.toDecimal(parsed.result.hydrationMl),
          mealCategory: parsed.result.mealCategory,
          rawResponse: parsed.rawResponse,
          error: null,
          processingStartedAt: null,
        },
      });
      await this.intelligenceService.processCompletedAnalysis(
        transaction,
        userId,
        mealAnalysisId,
        context,
      );
      await this.aiService.completeJobInTransaction(transaction, {
        userId,
        aiJobId,
        jobType: AIJobType.IMAGE,
        response,
      });
      await this.auditService.recordInTransaction(transaction, {
        userId,
        action: AUDIT_ACTION.NUTRITION_ANALYSIS_COMPLETED,
        entityType: AUDIT_ENTITY.MEAL_ANALYSIS,
        entityId: mealAnalysisId,
        metadata: {
          mealId,
          aiJobId,
          model: response.model,
          totalTokens: response.totalTokens,
        },
      });
      await this.eventBus.publish(
        {
          eventType: INTERNAL_EVENT.NUTRITION_ANALYSIS_COMPLETED,
          aggregateType: 'MEAL_ANALYSIS',
          aggregateId: mealAnalysisId,
          payload: {
            mealId,
            mealAnalysisId,
            aiJobId,
            userId,
          },
        },
        transaction,
      );

      return transaction.meal.findUniqueOrThrow({
        where: {
          id: mealId,
        },
        include: {
          mediaFile: true,
          analysis: {
            include: {
              qualityScore: true,
              items: {
                orderBy: {
                  id: 'asc',
                },
              },
              aiJob: {
                include: {
                  usage: {
                    orderBy: {
                      createdAt: 'asc',
                    },
                  },
                },
              },
            },
          },
        },
      });
    });
  }

  private async failAnalysis(
    mealAnalysisId: string,
    aiJobId: string,
    userId: string,
    response: OpenAIResponseResult | undefined,
    error: unknown,
  ): Promise<void> {
    const safeError = this.getSafeError(error);

    await this.prisma.$transaction(async (transaction) => {
      await transaction.mealAnalysis.updateMany({
        where: {
          id: mealAnalysisId,
          status: MealAnalysisStatus.PROCESSING,
        },
        data: {
          status: MealAnalysisStatus.FAILED,
          rawResponse: response
            ? {
                invalidOutput: response.outputText.slice(0, 100_000),
              }
            : undefined,
          error: safeError,
          processingStartedAt: null,
        },
      });
      await this.eventService.recordInTransaction(transaction, {
        source: 'NUTRITION_INTELLIGENCE',
        severity: Severity.ERROR,
        eventType: 'NUTRITION_ANALYSIS_FAILED',
        message: 'Falha na análise nutricional',
        metadata: {
          userId,
          mealAnalysisId,
          aiJobId,
          error: safeError,
        },
      });
    });
    await this.aiService.failJob(aiJobId, error, response);
  }

  private parseResponse(outputText: string): ParsedNutritionAnalysis {
    let value: unknown;

    try {
      value = JSON.parse(outputText);
    } catch {
      throw new BadGatewayException(
        'OpenAI retornou JSON nutricional inválido',
      );
    }

    if (!this.isRecord(value) || !Array.isArray(value.foods)) {
      throw new BadGatewayException(
        'OpenAI retornou estrutura nutricional inválida',
      );
    }

    if (value.foods.length > 100) {
      throw new BadGatewayException(
        'OpenAI retornou itens nutricionais em excesso',
      );
    }

    const foods = value.foods.map((food) => this.parseFood(food));
    const result: NutritionAnalysisResult = {
      foods,
      totalCalories: this.requireNutritionNumber(
        value.totalCalories,
        'totalCalories',
      ),
      protein: this.requireNutritionNumber(value.protein, 'protein'),
      carbs: this.requireNutritionNumber(value.carbs, 'carbs'),
      fat: this.requireNutritionNumber(value.fat, 'fat'),
      fiber: this.requireNutritionNumber(value.fiber, 'fiber'),
      sugar: this.requireNutritionNumber(value.sugar, 'sugar'),
      ultraProcessedRatio: this.requireRatio(
        value.ultraProcessedRatio,
        'ultraProcessedRatio',
      ),
      vegetableGrams: this.requireNutritionNumber(
        value.vegetableGrams,
        'vegetableGrams',
      ),
      hydrationMl: this.requireNutritionNumber(
        value.hydrationMl,
        'hydrationMl',
      ),
      mealCategory: this.requireMealCategory(value.mealCategory),
      confidence: this.requireConfidence(value.confidence),
    };
    const rawFoods: Prisma.InputJsonArray = foods.map(
      (food): Prisma.InputJsonObject => ({
        foodName: food.foodName,
        estimatedGrams: food.estimatedGrams,
        calories: food.calories,
        protein: food.protein,
        carbs: food.carbs,
        fat: food.fat,
        fiber: food.fiber,
        sugar: food.sugar,
        isUltraProcessed: food.isUltraProcessed,
        isVegetable: food.isVegetable,
      }),
    );

    return {
      result,
      rawResponse: {
        foods: rawFoods,
        totalCalories: result.totalCalories,
        protein: result.protein,
        carbs: result.carbs,
        fat: result.fat,
        fiber: result.fiber,
        sugar: result.sugar,
        ultraProcessedRatio: result.ultraProcessedRatio,
        vegetableGrams: result.vegetableGrams,
        hydrationMl: result.hydrationMl,
        mealCategory: result.mealCategory,
        confidence: result.confidence,
      },
    };
  }

  private parseFood(value: unknown): NutritionFoodResult {
    if (!this.isRecord(value)) {
      throw new BadGatewayException('OpenAI retornou alimento inválido');
    }

    const foodName =
      typeof value.foodName === 'string' ? value.foodName.trim() : '';

    if (!foodName || foodName.length > 200) {
      throw new BadGatewayException(
        'OpenAI retornou nome de alimento inválido',
      );
    }

    return {
      foodName,
      estimatedGrams: this.requireNutritionNumber(
        value.estimatedGrams,
        'estimatedGrams',
      ),
      calories: this.requireNutritionNumber(value.calories, 'calories'),
      protein: this.requireNutritionNumber(value.protein, 'protein'),
      carbs: this.requireNutritionNumber(value.carbs, 'carbs'),
      fat: this.requireNutritionNumber(value.fat, 'fat'),
      fiber: this.requireNutritionNumber(value.fiber, 'fiber'),
      sugar: this.requireNutritionNumber(value.sugar, 'sugar'),
      isUltraProcessed: this.requireBoolean(
        value.isUltraProcessed,
        'isUltraProcessed',
      ),
      isVegetable: this.requireBoolean(value.isVegetable, 'isVegetable'),
    };
  }

  private requireRatio(value: unknown, field: string): number {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1
    ) {
      throw new BadGatewayException(
        `OpenAI retornou proporção nutricional inválida: ${field}`,
      );
    }

    return value;
  }

  private requireBoolean(value: unknown, field: string): boolean {
    if (typeof value !== 'boolean') {
      throw new BadGatewayException(
        `OpenAI retornou indicador nutricional inválido: ${field}`,
      );
    }

    return value;
  }

  private requireMealCategory(value: unknown): MealCategory {
    if (
      typeof value !== 'string' ||
      !Object.values(MealCategory).includes(value as MealCategory)
    ) {
      throw new BadGatewayException(
        'OpenAI retornou categoria de refeição inválida',
      );
    }

    return value as MealCategory;
  }

  private requireNutritionNumber(value: unknown, field: string): number {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > MAX_NUTRITION_VALUE
    ) {
      throw new BadGatewayException(
        `OpenAI retornou valor nutricional inválido: ${field}`,
      );
    }

    return value;
  }

  private requireConfidence(value: unknown): number {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1
    ) {
      throw new BadGatewayException('OpenAI retornou confiança inválida');
    }

    return value;
  }

  private toDecimal(value: number): Prisma.Decimal {
    return new Prisma.Decimal(value.toFixed(2));
  }

  private getSafeError(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim().slice(0, 2_000);
    }

    return 'Falha não identificada na análise nutricional';
  }

  private buildAnalysisInput(context: NutritionUserContext): string {
    return [
      'Analise a imagem e retorne a estimativa nutricional estruturada.',
      'Considere o contexto apenas para classificar e contextualizar; não invente alimentos ausentes na imagem.',
      'Não produza diagnóstico, prescrição clínica ou afirmações sobre doenças.',
      `Contexto persistido: ${JSON.stringify({
        goal: context.goal,
        activityLevel: context.activityLevel,
        restrictions: context.restrictions,
        allergies: context.allergies,
        preferences: context.preferences,
        recentMeals: context.recentMeals.slice(0, 5),
        trends: context.trends,
        activeInsights: context.activeInsights,
        memorySummaries: context.memories
          .slice(0, 3)
          .map((memory) => memory.summary),
      })}`,
    ].join('\n');
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
