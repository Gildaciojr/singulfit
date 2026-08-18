import { Injectable } from '@nestjs/common';
import { AIJobStatus, AIJobType, Prisma } from '@prisma/client';
import { AIService } from '../ai/ai.service';
import type { OpenAIResponseResult } from '../ai/interfaces/openai.interface';
import { PrismaService } from '../prisma/prisma.service';
import type { CoachProactiveRealizationInput } from './coach-proactive.contract';
import { COACH_PROACTIVE_OUTREACH_PROMPT } from './coach-proactive-outreach.prompt.definition';

const MAXIMUM_PROACTIVE_LENGTH = 320;

@Injectable()
export class CoachProactiveRealizerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AIService,
  ) {}

  async realize(input: CoachProactiveRealizationInput): Promise<string> {
    try {
      const job = await this.aiService.createStandaloneJob({
        userId: input.userId,
        type: AIJobType.TEXT,
        promptName: COACH_PROACTIVE_OUTREACH_PROMPT.name,
        operationKey: input.operationKey,
      });
      if (job.status === AIJobStatus.COMPLETED) {
        return this.text(job.result) ?? input.fallback;
      }
      if (job.status !== AIJobStatus.PENDING) return input.fallback;

      let response: OpenAIResponseResult | undefined;
      try {
        response = await this.aiService.runTextJob(job.id, {
          input: JSON.stringify(this.providerInput(input)),
          jsonSchema: COACH_PROACTIVE_OUTREACH_PROMPT.schema,
          timeoutMs: 8_000,
        });
        const text = this.output(response.outputText);
        if (!text) throw new Error('COACH_PROACTIVE_INVALID_OUTPUT');
        await this.prisma.$transaction((transaction) =>
          this.aiService.completeJobInTransaction(transaction, {
            userId: input.userId,
            aiJobId: job.id,
            jobType: AIJobType.TEXT,
            response: response as OpenAIResponseResult,
            result: { text } satisfies Prisma.InputJsonValue,
          }),
        );
        return text;
      } catch (error: unknown) {
        await this.aiService.failJob(job.id, error, response);
        return input.fallback;
      }
    } catch {
      return input.fallback;
    }
  }

  private providerInput(input: CoachProactiveRealizationInput) {
    return Object.freeze({
      preferredName: input.preferredName,
      intent: input.intent,
      slotKey: input.slotKey,
      localTime: input.localTime,
      goal: input.goal,
      activeNutritionPlanSummary: input.nutritionPlanSummary,
      activeWorkoutSummary: input.workoutPlanSummary,
      trainingTime: input.trainingTime,
      mealTimes: input.mealTimes,
    });
  }

  private output(value: string): string | null {
    try {
      return this.text(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }

  private text(value: unknown): string | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null;
    }
    const text = Reflect.get(value, 'text');
    if (typeof text !== 'string') return null;
    const normalized = text.replace(/\s+/gu, ' ').trim();
    return normalized.length > 0 &&
      normalized.length <= MAXIMUM_PROACTIVE_LENGTH
      ? normalized
      : null;
  }
}
