import { ConflictException, Injectable } from '@nestjs/common';
import { AIJobStatus, AIJobType, Prisma } from '@prisma/client';
import { performance } from 'node:perf_hooks';
import { AIService } from '../../ai/ai.service';
import type { ConversationAIValue } from '../../ai/conversation-ai.contract';
import type { CoachConversationHumanContext } from '../../context/coach-conversation-human-context.contract';
import { PrismaService } from '../../prisma/prisma.service';
import type { PublicNutritionResponse } from '../../diet/v2/presentation/public-nutrition-response.contract';
import type { ConversationExecutionRoute } from '../contracts/conversation-execution-route.contract';
import { COACH_CONVERSATIONAL_QA_V2_PROMPT } from './coach-conversational-qa.prompt.definition';
import { ConversationCurrentNutritionContextService } from './conversation-current-nutrition-context.service';
import { ConversationPublicAnswerBoundaryService } from './conversation-public-answer-boundary.service';
import type {
  ConversationAnswerCandidate,
  ConversationAnswerDisposition,
  ConversationAnswerDomain,
  ConversationAnswerGrounding,
  ConversationQAObservability,
} from './conversation-qa.contract';

export interface ConversationQAExecutionInput {
  readonly userId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly route: ConversationExecutionRoute;
  readonly humanContext: CoachConversationHumanContext;
  readonly previousAnswer?: string | null;
  readonly previousFollowUpQuestion?: string | null;
  readonly deadlineAtMs?: number;
}

export type ConversationQAExecutionResult =
  | Readonly<{
      status: 'COMPLETED';
      content: string;
      observability: ConversationQAObservability;
    }>
  | Readonly<{
      status: 'DEFERRED' | 'FAILED';
      reason: string;
      observability: ConversationQAObservability;
    }>;

const DISPOSITIONS = new Set<ConversationAnswerDisposition>([
  'ANSWER',
  'CLARIFY',
  'DEFER_TO_SIDE_EFFECT_PIPELINE',
  'SAFE_RESPONSE',
]);
const DOMAINS = new Set<ConversationAnswerDomain>([
  'NUTRITION',
  'WORKOUT',
  'PROGRESS',
  'GENERAL',
]);
const GROUNDINGS = new Set<ConversationAnswerGrounding>([
  'CURRENT_PLAN',
  'PROFILE',
  'RECENT_CONTEXT',
  'GENERAL_KNOWLEDGE',
  'MIXED',
]);
const CONFIDENCE = new Set<ConversationAnswerCandidate['confidence']>([
  'HIGH',
  'MEDIUM',
  'LOW',
]);
const DEFAULT_RUNTIME_BUDGET_MS = 25_000;
const PROVIDER_COMPLETION_MARGIN_MS = 2_500;
const OFFICIAL_SELECTION_MARGIN_MS = 500;
const MIN_PROVIDER_BUDGET_MS = 1_000;
const JOIN_POLL_INTERVAL_MS = 250;

@Injectable()
export class ConversationQAExecutorService {
  constructor(
    private readonly ai: AIService,
    private readonly prisma: PrismaService,
    private readonly currentNutrition: ConversationCurrentNutritionContextService,
    private readonly boundary: ConversationPublicAnswerBoundaryService,
  ) {}

  async execute(
    input: ConversationQAExecutionInput,
  ): Promise<ConversationQAExecutionResult> {
    const deadlineAtMs =
      input.deadlineAtMs ?? Date.now() + DEFAULT_RUNTIME_BUDGET_MS;
    if (!this.providerBudget(deadlineAtMs)) {
      return this.failed('INSUFFICIENT_RUNTIME_BUDGET');
    }
    const currentNutrition = await this.currentNutrition.read(input.userId);
    let job: Awaited<ReturnType<AIService['createJob']>>;
    try {
      job = await this.ai.createJob({
        userId: input.userId,
        conversationId: input.conversationId,
        messageId: input.messageId,
        type: AIJobType.TEXT,
        promptName: COACH_CONVERSATIONAL_QA_V2_PROMPT.name,
      });
    } catch {
      return this.failed('AI_JOB_PREPARATION_FAILED');
    }

    if (job.status === AIJobStatus.COMPLETED) {
      const stored = this.parseCandidate(job.result);
      return stored
        ? this.candidateResult(stored, 'AI_REUSED', 0)
        : this.failed('STORED_ANSWER_INVALID');
    }
    if (job.status === AIJobStatus.PROCESSING) {
      return this.join(job.id, deadlineAtMs);
    }
    if (job.status !== AIJobStatus.PENDING) {
      return this.failed(`AI_JOB_${job.status}`);
    }

    const providerBudgetMs = this.providerBudget(deadlineAtMs);
    if (!providerBudgetMs) {
      await this.ai.failPendingJob(
        job.id,
        new Error('INSUFFICIENT_RUNTIME_BUDGET'),
      );
      return this.failed('INSUFFICIENT_RUNTIME_BUDGET');
    }

    let response: Awaited<ReturnType<AIService['runTextJob']>>;
    const providerStartedAt = performance.now();
    try {
      response = await this.ai.runTextJob(job.id, {
        input: JSON.stringify(
          this.payload(
            input.route,
            input.humanContext,
            currentNutrition,
            input.previousAnswer ?? null,
            input.previousFollowUpQuestion ?? null,
          ),
        ),
        jsonSchema: COACH_CONVERSATIONAL_QA_V2_PROMPT.schema,
        timeoutMs: providerBudgetMs,
      });
    } catch (error: unknown) {
      if (error instanceof ConflictException) {
        return this.join(job.id, deadlineAtMs);
      }
      await this.ai.failJob(job.id, error);
      return this.failed(
        'PROVIDER_EXECUTION_FAILED',
        this.elapsed(providerStartedAt),
      );
    }
    const providerDurationMs = this.elapsed(providerStartedAt);

    const candidate = this.parseText(response.outputText);
    if (!candidate) {
      await this.ai.failJob(job.id, new Error('INVALID_QA_RESPONSE'), response);
      return this.failed('INVALID_AI_RESPONSE', providerDurationMs, response);
    }

    try {
      await this.prisma.$transaction((transaction) =>
        this.ai.completeJobInTransaction(transaction, {
          userId: input.userId,
          aiJobId: job.id,
          jobType: AIJobType.TEXT,
          response,
          result: candidate as unknown as Prisma.InputJsonValue,
        }),
      );
    } catch (error: unknown) {
      await this.ai.failJob(job.id, error, response);
      return this.failed(
        'AI_JOB_COMPLETION_FAILED',
        providerDurationMs,
        response,
        candidate,
      );
    }

    return this.candidateResult(candidate, 'AI', providerDurationMs, response);
  }

  private async join(
    aiJobId: string,
    deadlineAtMs: number,
  ): Promise<ConversationQAExecutionResult> {
    const joinDeadlineAtMs = deadlineAtMs - OFFICIAL_SELECTION_MARGIN_MS;
    while (Date.now() < joinDeadlineAtMs) {
      const job = await this.ai.getJob(aiJobId);
      if (job.status === AIJobStatus.COMPLETED) {
        const stored = this.parseCandidate(job.result);
        return stored
          ? this.candidateResult(stored, 'AI_REUSED', 0)
          : this.failed('STORED_ANSWER_INVALID');
      }
      if (job.status === AIJobStatus.FAILED) {
        return this.failed('AI_JOB_FAILED_WHILE_JOINING');
      }
      await this.delay(
        Math.min(JOIN_POLL_INTERVAL_MS, joinDeadlineAtMs - Date.now()),
      );
    }
    return this.failed('AI_JOB_JOIN_TIMEOUT');
  }

  private candidateResult(
    candidate: ConversationAnswerCandidate,
    source: ConversationQAObservability['answerSource'],
    providerDurationMs: number,
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    },
  ): ConversationQAExecutionResult {
    const observation = this.observability(
      providerDurationMs,
      candidate,
      source,
      usage,
    );
    if (candidate.disposition === 'DEFER_TO_SIDE_EFFECT_PIPELINE') {
      return Object.freeze({
        status: 'DEFERRED',
        reason: 'AI_REQUESTED_SIDE_EFFECT_PIPELINE',
        observability: observation,
      });
    }
    const content = this.boundary.project(candidate);
    return content
      ? Object.freeze({
          status: 'COMPLETED',
          content,
          observability: observation,
        })
      : this.failed(
          'PUBLIC_BOUNDARY_REJECTED',
          providerDurationMs,
          usage,
          candidate,
        );
  }

  private payload(
    route: ConversationExecutionRoute,
    context: CoachConversationHumanContext,
    currentNutrition: Awaited<
      ReturnType<ConversationCurrentNutritionContextService['read']>
    >,
    previousAnswer: string | null = null,
    previousFollowUpQuestion: string | null = null,
  ): ConversationAIValue {
    return Object.freeze({
      request: context.currentMessage,
      route: route.kind,
      previousAnswer,
      previousFollowUpQuestion,
      trustedContext: Object.freeze({
        preferredName: context.preferredName?.value ?? null,
        goal: context.goal?.value ?? null,
        desiredOutcome: context.desiredOutcome?.value ?? null,
        mealTimes: context.routine.mealTimes?.value ?? Object.freeze([]),
        trainingTime: context.routine.trainingTime?.value ?? null,
        preferredFoods:
          context.nutrition.preferredFoods?.value ?? Object.freeze([]),
        rejectedFoods:
          context.nutrition.rejectedFoods?.value ?? Object.freeze([]),
        restrictions: context.restrictions?.value ?? Object.freeze([]),
        progress: context.progress?.value ?? null,
        memories: Object.freeze(context.memory.map((memory) => memory.summary)),
      }),
      recentConversation: Object.freeze(
        (context.recentConversation ?? []).map((turn) =>
          Object.freeze({
            direction: turn.direction,
            text: turn.text,
          }),
        ),
      ),
      currentNutrition: Object.freeze({
        status: currentNutrition.status,
        plan: this.planPayload(currentNutrition.plan),
      }),
      policy: Object.freeze({
        readOnly: true,
        approximationMustBeExplicit: true,
        canonicalFactsOverrideGeneralKnowledge: true,
        mutationsMustBeDeferred: true,
      }),
    });
  }

  private planPayload(
    plan: PublicNutritionResponse | null,
  ): ConversationAIValue {
    if (!plan) return null;
    return Object.freeze({
      title: plan.title,
      summary: plan.summary,
      goal: plan.goal ?? null,
      energyTargetKcal: plan.energyTargetKcal ?? null,
      macroTargets: plan.macroTargets
        ? Object.freeze({
            proteinGrams: plan.macroTargets.proteinGrams ?? null,
            carbohydrateGrams: plan.macroTargets.carbohydrateGrams ?? null,
            fatGrams: plan.macroTargets.fatGrams ?? null,
          })
        : null,
      days: Object.freeze(
        plan.days.map((day) =>
          Object.freeze({
            label: day.label ?? null,
            meals: Object.freeze(
              day.meals.map((meal) =>
                Object.freeze({
                  name: meal.name,
                  time: meal.time ?? null,
                  items: Object.freeze(
                    meal.items.map((item) =>
                      Object.freeze({
                        name: item.name,
                        quantity: item.quantity,
                      }),
                    ),
                  ),
                }),
              ),
            ),
          }),
        ),
      ),
      substitutions: Object.freeze(
        plan.substitutions.map((substitution) =>
          Object.freeze({
            source: substitution.source,
            alternative: substitution.alternative,
          }),
        ),
      ),
      hydrationGuidance: Object.freeze([...plan.hydrationGuidance]),
      generalGuidance: Object.freeze([...plan.generalGuidance]),
      adaptationGuidance: Object.freeze([...plan.adaptationGuidance]),
      safetyGuidance: Object.freeze([...plan.safetyGuidance]),
    });
  }

  private parseText(value: string): ConversationAnswerCandidate | null {
    try {
      return this.parseCandidate(JSON.parse(value));
    } catch {
      return null;
    }
  }

  private parseCandidate(value: unknown): ConversationAnswerCandidate | null {
    if (!this.record(value)) return null;
    const keys = Object.keys(value).sort();
    const expected = [
      'answer',
      'confidence',
      'disposition',
      'domain',
      'followUpQuestion',
      'grounding',
    ];
    if (
      keys.length !== expected.length ||
      keys.some((key, i) => key !== expected[i])
    ) {
      return null;
    }
    if (
      !this.member(value.disposition, DISPOSITIONS) ||
      !this.member(value.domain, DOMAINS) ||
      !this.nullableText(value.answer) ||
      !this.nullableText(value.followUpQuestion) ||
      !this.member(value.grounding, GROUNDINGS) ||
      !this.member(value.confidence, CONFIDENCE)
    ) {
      return null;
    }
    if (
      value.disposition === 'DEFER_TO_SIDE_EFFECT_PIPELINE' &&
      (value.answer !== null || value.followUpQuestion !== null)
    ) {
      return null;
    }
    if (
      value.disposition !== 'DEFER_TO_SIDE_EFFECT_PIPELINE' &&
      !value.answer &&
      !value.followUpQuestion
    ) {
      return null;
    }
    return Object.freeze({
      disposition: value.disposition,
      domain: value.domain,
      answer: value.answer,
      followUpQuestion: value.followUpQuestion,
      grounding: value.grounding,
      confidence: value.confidence,
    });
  }

  private failed(
    reason: string,
    providerDurationMs = 0,
    response?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    },
    candidate?: ConversationAnswerCandidate,
  ): ConversationQAExecutionResult {
    return Object.freeze({
      status: 'FAILED',
      reason,
      observability: Object.freeze({
        ...this.observability(
          providerDurationMs,
          candidate ?? null,
          'DETERMINISTIC_FALLBACK',
          response,
        ),
        fallbackReason: reason,
      }),
    });
  }

  private observability(
    providerDurationMs: number,
    candidate: ConversationAnswerCandidate | null,
    answerSource: ConversationQAObservability['answerSource'],
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    },
  ): ConversationQAObservability {
    return Object.freeze({
      answerSource,
      disposition: candidate?.disposition ?? null,
      domain: candidate?.domain ?? null,
      grounding: candidate?.grounding ?? null,
      providerDurationMs,
      promptTokens: usage?.promptTokens ?? 0,
      completionTokens: usage?.completionTokens ?? 0,
      totalTokens: usage?.totalTokens ?? 0,
      fallbackReason: null,
    });
  }

  private elapsed(startedAt: number): number {
    return Math.round(performance.now() - startedAt);
  }

  private providerBudget(deadlineAtMs: number): number | null {
    const available = deadlineAtMs - Date.now() - PROVIDER_COMPLETION_MARGIN_MS;
    return available >= MIN_PROVIDER_BUDGET_MS
      ? Math.min(available, 30_000)
      : null;
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  private nullableText(value: unknown): value is string | null {
    return (
      value === null || (typeof value === 'string' && value.trim().length > 0)
    );
  }

  private member<T extends string>(
    value: unknown,
    values: ReadonlySet<T>,
  ): value is T {
    return typeof value === 'string' && values.has(value as T);
  }

  private record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
