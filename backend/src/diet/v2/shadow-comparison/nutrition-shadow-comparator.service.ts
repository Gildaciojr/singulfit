import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  NutritionShadowComparisonDivergence as Divergence,
  NutritionShadowOutputKind,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { CONVERSATION_GOAL } from '../../../context/conversation-goal-planner.contract';
import type {
  CompareNutritionShadowInput,
  NutritionComparisonResult,
} from './nutrition-shadow-comparison.contract';
import {
  NUTRITION_SHADOW_COMPARISON_WEIGHTS,
  NUTRITION_SHADOW_CONTENT_OVERLAP_THRESHOLD,
} from './nutrition-shadow-comparison.contract';
import {
  NUTRITION_SHADOW_COMPARISON_REPOSITORY,
  type NutritionShadowComparisonRepository,
  type PersistNutritionShadowComparisonInput,
} from './nutrition-shadow-comparison.repository';

interface ComparisonCheck {
  readonly passed: boolean;
  readonly divergence: Divergence;
}

@Injectable()
export class NutritionShadowComparatorService {
  private readonly logger = new Logger(NutritionShadowComparatorService.name);

  constructor(
    @Inject(NUTRITION_SHADOW_COMPARISON_REPOSITORY)
    private readonly repository: NutritionShadowComparisonRepository,
  ) {}

  async compareSafely(
    input: CompareNutritionShadowInput,
  ): Promise<NutritionComparisonResult | null> {
    try {
      return await this.compare(input);
    } catch (error: unknown) {
      this.logger.warn(
        `Comparação Nutrition Shadow isolada: ${this.safeMessage(error)}`,
      );
      return null;
    }
  }

  async compare(
    input: CompareNutritionShadowInput,
  ): Promise<NutritionComparisonResult> {
    this.logger.debug(
      `Comparação Nutrition Shadow iniciada: ${input.shadow.shadowRunId}`,
    );
    const shadowText = this.normalize(JSON.stringify(input.shadow.document));
    const legacyText = this.normalize(input.legacy.response);
    const structural = this.structural(input);
    const contentOverlap = this.overlap(legacyText, shadowText);
    const semantic = this.semantic(input, shadowText, contentOverlap);
    const operational = this.operational(input);
    const structuralScore = this.score(structural);
    const semanticScore = this.score(semantic);
    const operationalScore = this.score(operational);
    const overallScore = Math.round(
      structuralScore * NUTRITION_SHADOW_COMPARISON_WEIGHTS.structural +
        semanticScore * NUTRITION_SHADOW_COMPARISON_WEIGHTS.semantic +
        operationalScore * NUTRITION_SHADOW_COMPARISON_WEIGHTS.operational,
    );
    const divergences = Object.freeze(
      [...structural, ...semantic, ...operational]
        .filter((check) => !check.passed)
        .map((check) => check.divergence)
        .filter((value, index, values) => values.indexOf(value) === index),
    );
    const equivalent = divergences.length === 0 && overallScore === 100;
    const timeRatio = this.ratio(
      input.shadow.durationMs,
      input.legacy.durationMs,
    );
    const tokenRatio = this.ratio(
      input.shadow.totalTokens,
      input.legacy.totalTokens,
    );
    const costRatio = this.decimalRatio(
      input.shadow.estimatedCostUsd,
      input.legacy.estimatedCostUsd,
    );
    const identity = this.identity(input);
    const persistence: PersistNutritionShadowComparisonInput = {
      operationKey: identity.operationKey,
      inputFingerprint: identity.fingerprint,
      conversationId: input.legacy.conversationId,
      messageId: input.legacy.messageId,
      shadowRunId: input.shadow.shadowRunId,
      conversationGoal: input.expectation.conversationGoal,
      expectedArtifactType: input.expectation.artifactType,
      actualArtifactType: input.shadow.artifactType,
      expectedKind: input.expectation.kind,
      actualKind: input.shadow.kind,
      equivalent,
      structuralScore,
      semanticScore,
      operationalScore,
      overallScore,
      divergences,
      legacyDurationMs: input.legacy.durationMs,
      shadowDurationMs: input.shadow.durationMs,
      legacyTokens: input.legacy.totalTokens,
      shadowTokens: input.shadow.totalTokens,
      legacyCostUsd: input.legacy.estimatedCostUsd,
      shadowCostUsd: input.shadow.estimatedCostUsd,
      timeRatio,
      tokenRatio,
      costRatio,
      legacyProvider: input.legacy.provider,
      shadowProvider: input.shadow.provider,
      legacyModel: input.legacy.model,
      shadowModel: input.shadow.model,
      legacyHash: this.hash(legacyText),
      shadowHash: input.shadow.documentHash,
    };
    const persisted = await this.repository.persist(persistence);
    if (divergences.length > 0)
      this.logger.warn(`Nutrition Shadow divergiu: ${divergences.join(',')}`);
    this.logger.debug(
      `Comparação Nutrition Shadow concluída: ${persisted.comparison.id}`,
    );
    return Object.freeze({
      comparisonId: persisted.comparison.id,
      conversationId: input.legacy.conversationId,
      shadowRunId: input.shadow.shadowRunId,
      equivalent,
      structuralScore,
      semanticScore,
      operationalScore,
      overallScore,
      divergences,
      metrics: Object.freeze({
        timeRatio,
        tokenRatio,
        costRatio,
        contentOverlap,
      }),
      reused: persisted.reused,
    });
  }

  private structural(input: CompareNutritionShadowInput): ComparisonCheck[] {
    const document = this.asObject(input.shadow.document) ?? {};
    const artifact = this.asObject(document.artifact);
    const expected = input.expectation;
    const checks: ComparisonCheck[] = [
      this.check(
        input.shadow.artifactType === expected.artifactType,
        Divergence.WRONG_ARTIFACT_TYPE,
      ),
      this.check(input.shadow.kind === expected.kind, Divergence.WRONG_KIND),
    ];
    const hasPlan = this.asObject(document.plan) !== null;
    checks.push(
      expected.kind === NutritionShadowOutputKind.PLAN
        ? this.check(hasPlan, Divergence.MISSING_PLAN)
        : this.check(!hasPlan, Divergence.EXTRA_PLAN),
    );
    if (expected.artifactType === 'POINT_GUIDANCE')
      checks.push(
        this.check(
          this.asObject(artifact?.guidance) !== null,
          Divergence.MISSING_GUIDANCE,
        ),
      );
    if (expected.artifactType === 'MEAL_SUGGESTION')
      checks.push(
        this.check(
          this.asObject(artifact?.meal) !== null,
          Divergence.MISSING_MEAL_SUGGESTION,
        ),
      );
    if (expected.artifactType === 'PLAN_REVIEW')
      checks.push(
        this.check(
          this.asObject(artifact?.review) !== null,
          Divergence.MISSING_REVIEW,
        ),
      );
    if (expected.artifactType === 'CURRENT_PLAN_PRESENTATION')
      checks.push(
        this.check(
          Object.prototype.hasOwnProperty.call(document, 'activePlanReference'),
          Divergence.MISSING_PRESENTATION,
        ),
      );
    return checks;
  }

  private semantic(
    input: CompareNutritionShadowInput,
    shadowText: string,
    contentOverlap: number,
  ): ComparisonCheck[] {
    return [
      this.check(this.goalMatches(input), Divergence.GOAL_MISMATCH),
      this.check(
        this.termsCovered(shadowText, input.expectation.objectiveTerms),
        Divergence.OBJECTIVE_MISMATCH,
      ),
      this.check(
        this.termsCovered(shadowText, input.expectation.focusTerms),
        Divergence.FOCUS_MISMATCH,
      ),
      this.check(
        this.termsCovered(shadowText, input.expectation.contextTerms),
        Divergence.CONTEXT_MISMATCH,
      ),
      this.check(
        input.expectation.forbiddenRestrictionTerms.every(
          (term) => !shadowText.includes(this.normalize(term)),
        ),
        Divergence.RESTRICTION_MISMATCH,
      ),
      this.check(
        contentOverlap >= NUTRITION_SHADOW_CONTENT_OVERLAP_THRESHOLD,
        Divergence.CONTENT_DIVERGENCE,
      ),
    ];
  }

  private operational(input: CompareNutritionShadowInput): ComparisonCheck[] {
    const checks: ComparisonCheck[] = [];
    if (input.legacy.durationMs !== null)
      checks.push(
        this.check(
          input.shadow.durationMs <= input.legacy.durationMs,
          Divergence.PERFORMANCE_REGRESSION,
        ),
      );
    if (input.legacy.totalTokens !== null)
      checks.push(
        this.check(
          input.shadow.totalTokens <= input.legacy.totalTokens,
          Divergence.TOKEN_REGRESSION,
        ),
      );
    if (
      input.legacy.estimatedCostUsd !== null &&
      input.shadow.estimatedCostUsd !== null
    )
      checks.push(
        this.check(
          this.number(input.shadow.estimatedCostUsd) <=
            this.number(input.legacy.estimatedCostUsd),
          Divergence.COST_REGRESSION,
        ),
      );
    if (input.legacy.provider !== null && input.shadow.provider !== null)
      checks.push(
        this.check(
          input.legacy.provider === input.shadow.provider,
          Divergence.PROVIDER_DIFFERENCE,
        ),
      );
    if (input.legacy.model !== null && input.shadow.model !== null)
      checks.push(
        this.check(
          input.legacy.model === input.shadow.model,
          Divergence.MODEL_DIFFERENCE,
        ),
      );
    checks.push(
      this.check(
        input.shadow.attempts <= input.legacy.attempts,
        Divergence.RETRY_REGRESSION,
      ),
      this.check(
        input.shadow.parserSucceeded === input.legacy.parserSucceeded,
        Divergence.PARSER_DIFFERENCE,
      ),
      this.check(
        input.shadow.validationSucceeded === input.legacy.validationSucceeded,
        Divergence.VALIDATION_DIFFERENCE,
      ),
    );
    return checks;
  }

  private goalMatches(input: CompareNutritionShadowInput): boolean {
    const goal = input.expectation.conversationGoal;
    const artifact = input.shadow.artifactType;
    if (goal === CONVERSATION_GOAL.GENERATE_DIET_PLAN)
      return artifact === 'DAILY_STRUCTURE' || artifact === 'WEEKLY_PLAN';
    if (goal === CONVERSATION_GOAL.UPDATE_DIET_PLAN)
      return artifact === 'PLAN_ADAPTATION' || artifact === 'FOOD_SUBSTITUTION';
    if (goal === CONVERSATION_GOAL.REVIEW_PROGRESS)
      return artifact === 'PLAN_REVIEW';
    if (
      goal === CONVERSATION_GOAL.SHOW_CURRENT_PLAN ||
      goal === CONVERSATION_GOAL.SHOW_PLAN_STATUS
    )
      return artifact === 'CURRENT_PLAN_PRESENTATION';
    if (
      goal === CONVERSATION_GOAL.GENERAL_GUIDANCE ||
      goal === CONVERSATION_GOAL.ANSWER_MESSAGE
    )
      return artifact === 'POINT_GUIDANCE' || artifact === 'MEAL_SUGGESTION';
    return false;
  }

  private score(checks: readonly ComparisonCheck[]): number {
    if (checks.length === 0) return 100;
    return Math.round(
      (checks.filter((check) => check.passed).length / checks.length) * 100,
    );
  }

  private check(passed: boolean, divergence: Divergence): ComparisonCheck {
    return Object.freeze({ passed, divergence });
  }

  private overlap(left: string, right: string): number {
    const leftTokens = this.tokens(left);
    const rightTokens = this.tokens(right);
    if (leftTokens.size === 0 && rightTokens.size === 0) return 1;
    if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
    const intersection = [...leftTokens].filter((token) =>
      rightTokens.has(token),
    );
    return Number(
      (
        intersection.length / Math.min(leftTokens.size, rightTokens.size)
      ).toFixed(4),
    );
  }

  private tokens(value: string): Set<string> {
    return new Set(
      value.split(/[^a-z0-9]+/).filter((token) => token.length >= 3),
    );
  }

  private termsCovered(text: string, terms: readonly string[]): boolean {
    return terms.every((term) => text.includes(this.normalize(term)));
  }

  private normalize(value: string): string {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private ratio(numerator: number, denominator: number | null): string | null {
    if (denominator === null || denominator <= 0) return null;
    return (numerator / denominator).toFixed(8);
  }

  private decimalRatio(
    numerator: string | null,
    denominator: string | null,
  ): string | null {
    if (numerator === null || denominator === null) return null;
    const denominatorNumber = this.number(denominator);
    if (denominatorNumber <= 0) return null;
    return (this.number(numerator) / denominatorNumber).toFixed(8);
  }

  private number(value: string | null): number {
    if (value === null) return 0;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0)
      throw new Error('Métrica monetária de comparação inválida');
    return parsed;
  }

  private identity(input: CompareNutritionShadowInput): {
    readonly operationKey: string;
    readonly fingerprint: string;
  } {
    const fingerprint = this.hash(this.canonical(input));
    return Object.freeze({
      operationKey: `nutrition-shadow-comparison:v1:${fingerprint}`,
      fingerprint,
    });
  }

  private canonical(value: unknown): string {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      typeof value === 'number'
    )
      return JSON.stringify(value);
    if (Array.isArray(value))
      return `[${value.map((item) => this.canonical(item)).join(',')}]`;
    if (typeof value === 'object') {
      const record = value as Readonly<{ [key: string]: unknown }>;
      return `{${Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${this.canonical(record[key])}`)
        .join(',')}}`;
    }
    throw new Error('Entrada de comparação não serializável');
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private asObject(
    value: unknown,
  ): Readonly<{ [key: string]: unknown }> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Readonly<{ [key: string]: unknown }>)
      : null;
  }

  private safeMessage(error: unknown): string {
    return (
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : 'Falha não identificada no Comparator Shadow'
    ).slice(0, 1_000);
  }
}
