import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  NutritionShadowOutputKind,
  NutritionShadowRuntimeSkipReason,
  type NutritionArtifactType,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type {
  CoachProfileConstraint,
  CoachProfileDatum,
  CoachProfileSnapshot,
} from '../../../context/coach-profile-snapshot.contract';
import { NutritionShadowComparatorService } from '../shadow-comparison/nutrition-shadow-comparator.service';
import { NutritionShadowRunnerService } from '../shadow/nutrition-shadow-runner.service';
import {
  NUTRITION_SHADOW_RUNTIME_DECISION_REPOSITORY,
  type ClaimNutritionShadowRuntimeDecisionInput,
  type NutritionShadowRuntimeDecisionRepository,
} from './nutrition-shadow-runtime-decision.repository';
import {
  NutritionShadowExecutionPolicy,
  type NutritionShadowExecutionPolicyDecision,
} from './nutrition-shadow-execution.policy';
import type {
  NutritionShadowRuntimeDispatchResult,
  NutritionShadowRuntimeInput,
} from './nutrition-shadow-runtime.contract';
import {
  NUTRITION_SHADOW_RUNTIME_RESULT_READER,
  type NutritionShadowRuntimeResultReader,
} from './nutrition-shadow-runtime-result.reader';

const NUTRITION_SHADOW_RUNTIME_CONCURRENCY_LIMIT = 2;

type RuntimeStage =
  | 'DECISION_CLAIM'
  | 'SHADOW'
  | 'DECISION_FINALIZE'
  | 'RESULT_READER'
  | 'COMPARATOR';

@Injectable()
export class NutritionShadowRuntimeOrchestratorService implements OnApplicationShutdown {
  private readonly logger = new Logger(
    NutritionShadowRuntimeOrchestratorService.name,
  );
  private readonly inFlight = new Set<Promise<void>>();
  private activeExecutions = 0;
  private shuttingDown = false;

  constructor(
    private readonly policy: NutritionShadowExecutionPolicy,
    private readonly shadowRunner: NutritionShadowRunnerService,
    private readonly comparator: NutritionShadowComparatorService,
    @Inject(NUTRITION_SHADOW_RUNTIME_RESULT_READER)
    private readonly resultReader: NutritionShadowRuntimeResultReader,
    @Inject(NUTRITION_SHADOW_RUNTIME_DECISION_REPOSITORY)
    private readonly decisions: NutritionShadowRuntimeDecisionRepository,
  ) {}

  execute(
    input: NutritionShadowRuntimeInput,
  ): NutritionShadowRuntimeDispatchResult {
    const identity = this.identity(input);

    if (this.shuttingDown)
      return this.scheduleSkipped(
        identity,
        NutritionShadowRuntimeSkipReason.SHUTTING_DOWN,
        'nova execução cancelada',
      );
    if (!this.valid(input))
      return this.scheduleSkipped(
        identity,
        NutritionShadowRuntimeSkipReason.MISSING_REQUIRED_CONTEXT,
        'contexto obrigatório inválido',
      );

    let policy: NutritionShadowExecutionPolicyDecision;
    try {
      policy = this.policy.evaluate(input.source.decision);
    } catch (error: unknown) {
      this.logger.warn(
        `Nutrition Shadow Runtime falhou ao avaliar política: ${this.safeMessage(error)}`,
      );
      return this.scheduleSkipped(
        identity,
        NutritionShadowRuntimeSkipReason.POLICY_EVALUATION_ERROR,
        'falha na política de ativação',
      );
    }

    if (!policy.enabled)
      return this.scheduleSkipped(
        identity,
        policy.reason === 'DISABLED'
          ? NutritionShadowRuntimeSkipReason.DISABLED_BY_POLICY
          : NutritionShadowRuntimeSkipReason.NON_NUTRITION_GOAL,
        'política de ativação',
      );
    if (this.activeExecutions >= NUTRITION_SHADOW_RUNTIME_CONCURRENCY_LIMIT)
      return this.scheduleSkipped(
        identity,
        NutritionShadowRuntimeSkipReason.CONCURRENCY_LIMIT,
        'limite de concorrência',
      );

    this.activeExecutions += 1;
    this.logger.debug(
      `Nutrition Shadow Runtime iniciado: ${input.legacy.messageId}`,
    );
    this.schedule(this.run(input, identity), true);
    return Object.freeze({
      status: 'STARTED' as const,
      runtimeDecisionId: identity.id,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.inFlight.size > 0)
      this.logger.debug(
        `Nutrition Shadow Runtime aguardando ${this.inFlight.size} operação(ões) no encerramento`,
      );
    await Promise.allSettled([...this.inFlight]);
  }

  private async run(
    input: NutritionShadowRuntimeInput,
    identity: ClaimNutritionShadowRuntimeDecisionInput,
  ): Promise<void> {
    const startedAt = performance.now();
    let stage: RuntimeStage = 'DECISION_CLAIM';
    try {
      const claim = await this.decisions.claim(identity);
      if (claim.kind === 'TERMINAL_REUSED') {
        this.logger.debug(
          `Nutrition Shadow Runtime reutilizou decisão terminal: ${claim.decision.id}`,
        );
        return;
      }
      if (claim.kind === 'OWNERSHIP_ACTIVE') {
        this.logger.debug(
          `Nutrition Shadow Runtime recusou ownership ativa até ${claim.ownershipExpiresAt.toISOString()}: ${claim.decision.id}`,
        );
        return;
      }
      if (claim.kind === 'OWNERSHIP_RECOVERED')
        this.logger.warn(
          `Nutrition Shadow Runtime recuperou ownership expirada em ${claim.previousOwnershipExpiresAt.toISOString()}: ${claim.decision.id}`,
        );
      else
        this.logger.debug(
          `Nutrition Shadow Runtime criou ownership: ${claim.decision.id}`,
        );

      stage = 'SHADOW';
      const result = await this.shadowRunner.executeSafely({
        source: input.source,
        correlationId: input.correlationId,
        traceId: input.traceId,
        conversationId: input.legacy.conversationId,
        messageId: input.legacy.messageId,
      });

      stage = 'DECISION_FINALIZE';
      if (result.status === 'SKIPPED') {
        await this.decisions.completeSkipped(
          identity.id,
          claim.ownership.token,
          NutritionShadowRuntimeSkipReason.STORAGE_UNAVAILABLE,
        );
        this.logger.warn(
          'Nutrition Shadow Runtime encerrado sem geração: armazenamento indisponível',
        );
        return;
      }

      await this.decisions.completeStarted(
        identity.id,
        claim.ownership.token,
        result.shadowRunId,
      );
      this.logger.debug(
        `Decisão Nutrition Shadow STARTED persistida: ${identity.id}`,
      );
      if (result.status === 'FAILED') {
        this.logger.warn(
          'Nutrition Shadow Runtime encerrou com execução Shadow FAILED',
        );
        return;
      }

      if (!input.expectedArtifactType) {
        this.logger.warn(
          'Nutrition Shadow Runtime ignorou comparação: artifact esperado indisponível',
        );
        return;
      }

      stage = 'RESULT_READER';
      const shadow = await this.resultReader.findSucceeded(result.shadowRunId);
      if (!shadow)
        throw new Error('Resultado Nutrition Shadow concluído não localizado');
      if (shadow.conversationGoal === null)
        throw new Error(
          'Resultado Nutrition Shadow histórico não possui ConversationGoal',
        );
      if (shadow.conversationGoal !== input.source.decision.goal)
        throw new Error(
          'ConversationGoal do resultado Shadow diverge da decisão original',
        );

      stage = 'COMPARATOR';
      const comparison = await this.comparator.compare({
        legacy: input.legacy,
        shadow,
        expectation: {
          artifactType: input.expectedArtifactType,
          kind: this.kind(input.expectedArtifactType),
          conversationGoal: input.source.decision.goal,
          ...this.semanticExpectation(input.source.snapshot),
        },
      });
      this.logger.debug(
        `Nutrition Shadow Runtime concluiu comparação ${comparison.comparisonId} em ${this.duration(startedAt)}ms`,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Nutrition Shadow Runtime falhou em ${stage}: ${this.safeMessage(error)}`,
      );
    }
  }

  private scheduleSkipped(
    identity: ClaimNutritionShadowRuntimeDecisionInput,
    reason: NutritionShadowRuntimeSkipReason,
    detail: string,
  ): NutritionShadowRuntimeDispatchResult {
    this.logger.debug(
      `Nutrition Shadow Runtime ignorado: ${reason} (${detail})`,
    );
    this.schedule(this.persistSkipped(identity, reason), false);
    return Object.freeze({
      status: 'SKIPPED' as const,
      reason,
      runtimeDecisionId: identity.id,
    });
  }

  private async persistSkipped(
    identity: ClaimNutritionShadowRuntimeDecisionInput,
    reason: NutritionShadowRuntimeSkipReason,
  ): Promise<void> {
    const claim = await this.decisions.claim(identity);
    if (claim.kind === 'TERMINAL_REUSED') {
      this.logger.debug(
        `Nutrition Shadow Runtime reutilizou decisão terminal ignorada: ${claim.decision.id}`,
      );
      return;
    }
    if (claim.kind === 'OWNERSHIP_ACTIVE') {
      this.logger.debug(
        `Nutrition Shadow Runtime recusou ownership para SKIPPED até ${claim.ownershipExpiresAt.toISOString()}: ${claim.decision.id}`,
      );
      return;
    }
    if (claim.kind === 'OWNERSHIP_RECOVERED')
      this.logger.warn(
        `Nutrition Shadow Runtime recuperou ownership expirada para SKIPPED em ${claim.previousOwnershipExpiresAt.toISOString()}: ${claim.decision.id}`,
      );
    else
      this.logger.debug(
        `Nutrition Shadow Runtime criou ownership para SKIPPED: ${claim.decision.id}`,
      );
    await this.decisions.completeSkipped(
      identity.id,
      claim.ownership.token,
      reason,
    );
    this.logger.debug(
      `Decisão Nutrition Shadow SKIPPED persistida: ${identity.id} (${reason})`,
    );
  }

  private schedule(work: Promise<void>, activeExecution: boolean): void {
    const tracked = work
      .catch((error: unknown) => {
        this.logger.warn(
          `Evidência Nutrition Shadow não pôde ser persistida: ${this.safeMessage(error)}`,
        );
      })
      .finally(() => {
        this.inFlight.delete(tracked);
        if (activeExecution) this.activeExecutions -= 1;
      });
    this.inFlight.add(tracked);
  }

  private identity(
    input: NutritionShadowRuntimeInput,
  ): ClaimNutritionShadowRuntimeDecisionInput {
    const logical = JSON.stringify({
      version: 1,
      userId: input.source.userId,
      conversationId: input.legacy.conversationId,
      messageId: input.legacy.messageId,
      correlationId: input.correlationId,
    });
    const operationHash = this.hash(logical);
    const fingerprint = this.hash(
      JSON.stringify({
        logical,
        decision: input.source.decision,
        referenceDate: this.referenceDate(input.source.referenceDate),
        expectedArtifactType: input.expectedArtifactType,
      }),
    );
    return Object.freeze({
      id: `nsrd_${operationHash.slice(0, 28)}`,
      operationKey: `nutrition-shadow-runtime:v1:${operationHash}`,
      inputFingerprint: fingerprint,
      userId: input.source.userId,
      conversationId: input.legacy.conversationId,
      messageId: input.legacy.messageId,
      correlationId: input.correlationId,
      traceId: input.traceId ?? null,
      conversationGoal: input.source.decision.goal,
      ownershipToken: randomUUID(),
    });
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private referenceDate(value: Date): string {
    return Number.isNaN(value.getTime())
      ? 'INVALID_REFERENCE_DATE'
      : value.toISOString();
  }

  private semanticExpectation(snapshot: CoachProfileSnapshot): {
    readonly objectiveTerms: readonly string[];
    readonly focusTerms: readonly string[];
    readonly contextTerms: readonly string[];
    readonly forbiddenRestrictionTerms: readonly string[];
  } {
    return Object.freeze({
      objectiveTerms: this.terms([
        this.datum(snapshot.nutrition.primaryGoal),
        this.datum(snapshot.nutrition.desiredOutcome),
      ]),
      focusTerms: this.terms([this.datum(snapshot.nutrition.dietaryPattern)]),
      contextTerms: this.terms([
        this.datum(snapshot.nutrition.cookingAvailability),
        this.datum(snapshot.nutrition.hydration),
      ]),
      forbiddenRestrictionTerms: this.terms([
        ...(snapshot.nutrition.declaredFoodRejections
          ? (this.datum(snapshot.nutrition.declaredFoodRejections) ?? [])
          : []),
        ...this.constraints(this.datum(snapshot.restrictions.foodRestrictions)),
        ...this.constraints(this.datum(snapshot.restrictions.allergies)),
        ...this.constraints(
          snapshot.nutrition.foodIntolerances
            ? this.datum(snapshot.nutrition.foodIntolerances)
            : null,
        ),
      ]),
    });
  }

  private constraints(
    values: readonly CoachProfileConstraint[] | null,
  ): readonly string[] {
    return values?.map((value) => value.description) ?? [];
  }

  private datum<T>(datum: CoachProfileDatum<T>): T | null {
    return 'value' in datum ? datum.value : null;
  }

  private terms(values: readonly unknown[]): readonly string[] {
    const terms = values
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean);
    return Object.freeze([...new Set(terms)]);
  }

  private kind(artifactType: NutritionArtifactType): NutritionShadowOutputKind {
    if (artifactType === 'CURRENT_PLAN_PRESENTATION')
      return NutritionShadowOutputKind.CURRENT_PLAN_PRESENTATION;
    if (
      artifactType === 'POINT_GUIDANCE' ||
      artifactType === 'MEAL_SUGGESTION' ||
      artifactType === 'PLAN_REVIEW'
    )
      return NutritionShadowOutputKind.CONVERSATIONAL_ARTIFACT;
    return NutritionShadowOutputKind.PLAN;
  }

  private valid(input: NutritionShadowRuntimeInput): boolean {
    return (
      input.correlationId.trim().length > 0 &&
      input.legacy.conversationId.trim().length > 0 &&
      input.legacy.messageId.trim().length > 0 &&
      input.source.userId === this.datum(input.source.snapshot.identity.userId)
    );
  }

  private duration(startedAt: number): number {
    return Math.max(0, Math.round(performance.now() - startedAt));
  }

  private safeMessage(error: unknown): string {
    return (
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : 'falha Shadow não identificada'
    ).slice(0, 1_000);
  }
}
