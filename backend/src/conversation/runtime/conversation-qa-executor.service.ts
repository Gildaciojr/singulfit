import { ConflictException, Injectable, Optional } from '@nestjs/common';
import { AIJobStatus, AIJobType, Prisma } from '@prisma/client';
import { performance } from 'node:perf_hooks';
import { AIService } from '../../ai/ai.service';
import { OpenAIGateway } from '../../ai/openai.gateway';
import type { ConversationAIValue } from '../../ai/conversation-ai.contract';
import type { CoachConversationHumanContext } from '../../context/coach-conversation-human-context.contract';
import { PrismaService } from '../../prisma/prisma.service';
import type { PublicNutritionResponse } from '../../diet/v2/presentation/public-nutrition-response.contract';
import type { ConversationExecutionRoute } from '../contracts/conversation-execution-route.contract';
import { ACTIVE_CONVERSATION_QA_PROMPT as COACH_CONVERSATIONAL_QA_V4_PROMPT } from './conversation-qa-capability';
import { ConversationCurrentNutritionContextService } from './conversation-current-nutrition-context.service';
import { ConversationPublicAnswerBoundaryService } from './conversation-public-answer-boundary.service';
import { normalizeConversationQACandidate } from './conversation-qa-candidate-normalizer';
import { ConversationNutritionDeterministicAnswerService } from './conversation-nutrition-deterministic-answer.service';
import {
  nutritionAdviceContext,
  nutritionAdvicePayload,
  nutritionAdviceViolation,
  type NutritionAdviceContext,
} from './nutrition-advice.policy';
import { PersonalizedCoachContextService } from './personalized-coach-context.service';
import type { ConversationEntity } from '../contracts/conversation-entity.contract';
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
  readonly referenceDate?: Date;
  readonly entities?: readonly ConversationEntity[];
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
    @Optional()
    private readonly deterministicNutrition?: ConversationNutritionDeterministicAnswerService,
    @Optional()
    private readonly personalized?: PersonalizedCoachContextService,
    @Optional() private readonly correctionGateway?: OpenAIGateway,
  ) {}

  async execute(
    input: ConversationQAExecutionInput,
  ): Promise<ConversationQAExecutionResult> {
    const deadlineAtMs =
      input.deadlineAtMs ?? Date.now() + DEFAULT_RUNTIME_BUDGET_MS;
    if (!this.providerBudget(deadlineAtMs)) {
      return this.failed('INSUFFICIENT_RUNTIME_BUDGET');
    }
    let personalized: ConversationAIValue = null;
    if (this.personalized) {
      try {
        personalized = await this.personalized.build({
          ...input,
          referenceDate: input.referenceDate ?? new Date(),
        });
      } catch {
        return this.failed('PERSONALIZED_CONTEXT_UNAVAILABLE');
      }
    }
    const personalAnswer = this.personalized?.answer(
      personalized,
      input.entities ?? [],
      input.humanContext.currentMessage,
    );
    if (personalAnswer)
      return this.candidateResult(
        Object.freeze({
          disposition: 'ANSWER',
          domain: 'GENERAL',
          answer: personalAnswer,
          followUpQuestion: null,
          grounding: 'PROFILE',
          confidence: 'HIGH',
        }),
        'DETERMINISTIC_FALLBACK',
        0,
      );
    const currentNutrition = await this.currentNutrition.read(input.userId);
    const nutritionAdvice = nutritionAdviceContext(
      input.humanContext,
      personalized,
      currentNutrition.plan,
      input.previousAnswer ?? null,
      input.referenceDate ?? new Date(),
    );
    if (
      nutritionAdvice?.unresolvedSafety ||
      nutritionAdvice?.unresolvedOriginalMeal
    ) {
      return this.candidateResult(
        {
          disposition: 'CLARIFY',
          domain: 'NUTRITION',
          answer: null,
          followUpQuestion: nutritionAdvice.unresolvedSafety
            ? 'Há informações diferentes sobre suas restrições alimentares. Qual alimento você precisa evitar?'
            : 'O que costuma ter nessa refeição que você quer substituir?',
          grounding: 'PROFILE',
          confidence: 'LOW',
        },
        'DETERMINISTIC_FALLBACK',
        0,
      );
    }
    const deterministic = this.deterministicNutrition?.answer({
      request: input.humanContext.currentMessage,
      route: input.route,
      current: currentNutrition,
    });
    if (deterministic) {
      return Object.freeze({
        status: 'COMPLETED' as const,
        content: deterministic.content,
        observability: this.observability(
          0,
          deterministic.candidate,
          'DETERMINISTIC_FALLBACK',
        ),
      });
    }
    let job: Awaited<ReturnType<AIService['createJob']>>;
    try {
      job = await this.ai.createJob({
        userId: input.userId,
        conversationId: input.conversationId,
        messageId: input.messageId,
        type: AIJobType.TEXT,
        promptName: COACH_CONVERSATIONAL_QA_V4_PROMPT.name,
      });
    } catch {
      return this.failed('AI_JOB_PREPARATION_FAILED');
    }

    if (job.userId !== undefined && job.userId !== input.userId)
      return this.failed('AI_JOB_OWNERSHIP_MISMATCH');
    if (job.status === AIJobStatus.COMPLETED) {
      const stored = this.parseCandidate(job.result);
      const violation =
        stored && nutritionAdviceViolation(nutritionAdvice, stored);
      if (violation) return this.failed(violation);
      if (
        stored &&
        this.personalized &&
        !this.personalized.validatesAnswer(
          personalized,
          [stored.answer, stored.followUpQuestion].filter(Boolean).join('\n'),
        )
      )
        return this.failed('UNSUPPORTED_PERSONAL_ASSERTION');
      return stored
        ? this.candidateResult(stored, 'AI_REUSED', 0)
        : this.failed('STORED_ANSWER_INVALID');
    }
    if (job.status === AIJobStatus.PROCESSING) {
      return this.join(
        job.id,
        deadlineAtMs,
        personalized,
        input.userId,
        nutritionAdvice,
      );
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
            personalized,
            nutritionAdvice,
          ),
        ),
        jsonSchema: COACH_CONVERSATIONAL_QA_V4_PROMPT.schema,
        timeoutMs: providerBudgetMs,
      });
    } catch (error: unknown) {
      if (error instanceof ConflictException) {
        return this.join(
          job.id,
          deadlineAtMs,
          personalized,
          input.userId,
          nutritionAdvice,
        );
      }
      await this.ai.failJob(job.id, error);
      return this.failed(
        'PROVIDER_EXECUTION_FAILED',
        this.elapsed(providerStartedAt),
      );
    }
    let providerDurationMs = this.elapsed(providerStartedAt);
    let recovery: Partial<ConversationQAObservability> = {};
    const finish = (
      result: ConversationQAExecutionResult,
    ): ConversationQAExecutionResult => ({
      ...result,
      observability: {
        ...result.observability,
        ...recovery,
        ...(input.humanContext.currentReadOnlyReferent
          ? {
              effectiveReferentSource:
                input.humanContext.currentReadOnlyReferent.source,
              effectiveReferentMessageId:
                input.humanContext.currentReadOnlyReferent.sourceMessageId,
              effectiveReferentDomain:
                input.humanContext.currentReadOnlyReferent.domain,
              effectiveReferentMeal:
                input.humanContext.effectiveNutritionRequest?.meal ?? null,
            }
          : {}),
      },
    });
    const safeNutritionFallback = (
      reason: string,
    ): ConversationQAExecutionResult => {
      const fallback: ConversationAnswerCandidate = {
        disposition: 'CLARIFY',
        domain: 'NUTRITION',
        answer: null,
        followUpQuestion:
          'Que alimentos você tem disponíveis para uma alternativa?',
        grounding: 'RECENT_CONTEXT',
        confidence: 'LOW',
      };
      const fallbackViolation = nutritionAdviceViolation(
        nutritionAdvice,
        fallback,
      );
      if (fallbackViolation)
        return finish(
          this.failed(fallbackViolation, providerDurationMs, response),
        );
      const result = this.candidateResult(
        fallback,
        'DETERMINISTIC_FALLBACK',
        providerDurationMs,
        response,
      );
      return finish({
        ...result,
        observability: { ...result.observability, fallbackReason: reason },
      });
    };

    let candidate = this.parseText(response.outputText);
    if (!candidate) {
      await this.ai.failJob(job.id, new Error('INVALID_QA_RESPONSE'), response);
      return this.failed('INVALID_AI_RESPONSE', providerDurationMs, response);
    }
    let violation = nutritionAdviceViolation(nutritionAdvice, candidate);
    if (
      (violation === 'NUTRITION_ADVICE_REPEATS_CURRENT_MEAL' ||
        violation === 'NUTRITION_ADVICE_REPEATS_PREVIOUS_SUGGESTION') &&
      this.correctionGateway &&
      candidate.disposition === 'ANSWER'
    ) {
      recovery = {
        nutritionAdviceInitialViolation: violation,
        nutritionAdviceRetryAttempted: false,
        nutritionAdviceRetryOutcome: 'NOT_ATTEMPTED',
      };
      const remaining = this.providerBudget(deadlineAtMs);
      if (!remaining) {
        await this.ai.failJob(
          job.id,
          new Error('INSUFFICIENT_RUNTIME_BUDGET'),
          response,
        );
        return safeNutritionFallback('INSUFFICIENT_RUNTIME_BUDGET');
      }
      recovery = {
        ...recovery,
        nutritionAdviceRetryAttempted: true,
        nutritionAdviceRetryOutcome: 'FAILED',
      };
      try {
        const corrected = await this.correctionGateway.createTextResponse({
          instructions: job.promptVersion.prompt,
          input: JSON.stringify({
            ...this.payload(
              input.route,
              input.humanContext,
              currentNutrition,
              input.previousAnswer ?? null,
              input.previousFollowUpQuestion ?? null,
              personalized,
              nutritionAdvice,
            ),
            nutritionAdviceCorrection: {
              originalViolation: violation,
              correctiveAttempt: 1,
              instruction:
                'O primeiro candidato repetiu uma composição já oferecida (refeição atual ou sugestão anterior) e foi descartado. Entregue uma alternativa diferente, mantendo o alvo, constraints e todas as restrições de segurança. Não altere o plano. Esta é a única tentativa corretiva.',
            },
          }),
          requestId: `${job.id}:nutrition-advice-correction:1`,
          jsonSchema: COACH_CONVERSATIONAL_QA_V4_PROMPT.schema,
          timeoutMs: remaining,
        });
        response = {
          ...corrected,
          promptTokens: response.promptTokens + corrected.promptTokens,
          completionTokens:
            response.completionTokens + corrected.completionTokens,
          totalTokens: response.totalTokens + corrected.totalTokens,
        };
      } catch (error: unknown) {
        await this.ai.failJob(job.id, error, response);
        return finish(
          this.failed(
            'PROVIDER_EXECUTION_FAILED',
            this.elapsed(providerStartedAt),
            response,
          ),
        );
      }
      providerDurationMs = this.elapsed(providerStartedAt);
      candidate = this.parseText(response.outputText);
      if (!candidate) {
        await this.ai.failJob(
          job.id,
          new Error('INVALID_QA_RESPONSE'),
          response,
        );
        return safeNutritionFallback('INVALID_AI_RESPONSE');
      }
      violation = nutritionAdviceViolation(nutritionAdvice, candidate);
      if (violation) {
        await this.ai.failJob(job.id, new Error(violation), response);
        return safeNutritionFallback(violation);
      }
      recovery = { ...recovery, nutritionAdviceRetryOutcome: 'RECOVERED' };
    }
    if (violation) {
      await this.ai.failJob(job.id, new Error(violation), response);
      return finish(
        this.failed(violation, providerDurationMs, response, candidate),
      );
    }
    if (
      this.personalized &&
      !this.personalized.validatesAnswer(
        personalized,
        [candidate.answer, candidate.followUpQuestion]
          .filter(Boolean)
          .join('\n'),
      )
    ) {
      await this.ai.failJob(
        job.id,
        new Error('UNSUPPORTED_PERSONAL_ASSERTION'),
        response,
      );
      if (recovery.nutritionAdviceRetryAttempted) {
        recovery = { ...recovery, nutritionAdviceRetryOutcome: 'FAILED' };
        return safeNutritionFallback('UNSUPPORTED_PERSONAL_ASSERTION');
      }
      return finish(
        this.failed(
          'UNSUPPORTED_PERSONAL_ASSERTION',
          providerDurationMs,
          response,
        ),
      );
    }

    if (
      recovery.nutritionAdviceRetryAttempted &&
      candidate.disposition !== 'DEFER_TO_SIDE_EFFECT_PIPELINE' &&
      !this.boundary.project(candidate)
    ) {
      await this.ai.failJob(
        job.id,
        new Error('PUBLIC_BOUNDARY_REJECTED'),
        response,
      );
      recovery = { ...recovery, nutritionAdviceRetryOutcome: 'FAILED' };
      return safeNutritionFallback('PUBLIC_BOUNDARY_REJECTED');
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
      return finish(
        this.failed(
          'AI_JOB_COMPLETION_FAILED',
          providerDurationMs,
          response,
          candidate,
        ),
      );
    }

    return finish(
      this.candidateResult(candidate, 'AI', providerDurationMs, response),
    );
  }

  private async join(
    aiJobId: string,
    deadlineAtMs: number,
    personalized: ConversationAIValue = null,
    userId?: string,
    nutritionAdvice: NutritionAdviceContext | null = null,
  ): Promise<ConversationQAExecutionResult> {
    const joinDeadlineAtMs = deadlineAtMs - OFFICIAL_SELECTION_MARGIN_MS;
    while (Date.now() < joinDeadlineAtMs) {
      const job = await this.ai.getJob(aiJobId);
      if (job.userId !== undefined && job.userId !== userId)
        return this.failed('AI_JOB_OWNERSHIP_MISMATCH');
      if (job.status === AIJobStatus.COMPLETED) {
        const stored = this.parseCandidate(job.result);
        const violation =
          stored && nutritionAdviceViolation(nutritionAdvice, stored);
        if (violation) return this.failed(violation);
        if (
          stored &&
          this.personalized &&
          !this.personalized.validatesAnswer(
            personalized,
            [stored.answer, stored.followUpQuestion].filter(Boolean).join('\n'),
          )
        )
          return this.failed('UNSUPPORTED_PERSONAL_ASSERTION');
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
    personalized: ConversationAIValue = null,
    nutritionAdvice: NutritionAdviceContext | null = null,
  ): Readonly<Record<string, ConversationAIValue>> {
    const recent = (context.recentConversation ?? []).filter(
      (turn) => !personalized || Boolean(turn.origin),
    );
    const personalHistory: unknown = this.record(personalized)
      ? personalized.recentConversation
      : null;
    const recentConversation = recent.length
      ? recent
      : Array.isArray(personalHistory)
        ? personalHistory.flatMap((turn: unknown) =>
            this.record(turn) &&
            (turn.direction === 'INBOUND' || turn.direction === 'OUTBOUND') &&
            typeof turn.text === 'string'
              ? [
                  {
                    direction: turn.direction === 'INBOUND' ? 'USER' : 'COACH',
                    text: turn.text,
                    origin: null,
                  },
                ]
              : [],
          )
        : [];
    const trusted =
      personalized &&
      typeof personalized === 'object' &&
      !Array.isArray(personalized)
        ? Object.fromEntries(
            Object.entries(personalized).map(([key, value]) => [
              key,
              key === 'recentConversation' ? [] : value,
            ]),
          )
        : personalized;
    return Object.freeze({
      request: context.currentMessage,
      route: route.kind,
      previousAnswer,
      previousFollowUpQuestion,
      ...(nutritionAdvice
        ? { nutritionGuidance: nutritionAdvicePayload(nutritionAdvice) }
        : {}),
      trustedContext:
        trusted ??
        Object.freeze({
          preferredName: context.preferredName?.value ?? null,
          goal: context.goal?.value ?? null,
          desiredOutcome: context.desiredOutcome?.value ?? null,
          mealTimes: context.routine.mealTimes?.value ?? Object.freeze([]),
          trainingTime: context.routine.trainingTime?.value ?? null,
          preferredFoods:
            context.nutrition.preferredFoods?.value ?? Object.freeze([]),
          rejectedFoods:
            context.nutrition.rejectedFoods?.value ?? Object.freeze([]),
          dietaryPattern: context.nutrition.dietaryPattern?.value ?? null,
          cookingAvailability:
            context.routine.cookingAvailability?.value ?? null,
          mealsAwayFromHome: context.routine.mealsAwayFromHome?.value ?? null,
          restrictions: context.restrictions?.value ?? Object.freeze([]),
          progress: context.progress?.value ?? null,
          memories: Object.freeze(
            context.memory.map((memory) => memory.summary),
          ),
        }),
      recentConversation: Object.freeze(
        recentConversation.slice(-8).map((turn) =>
          Object.freeze({
            direction: turn.direction,
            text: turn.text,
            origin: turn.origin ? Object.freeze({ ...turn.origin }) : null,
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
    return normalizeConversationQACandidate(
      Object.freeze({
        disposition: value.disposition,
        domain: value.domain,
        answer: value.answer,
        followUpQuestion: value.followUpQuestion,
        grounding: value.grounding,
        confidence: value.confidence,
      }),
    );
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
