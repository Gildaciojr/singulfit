import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ConversationGoalDecision } from '../context/conversation-goal-planner.contract';
import { CONVERSATION_GOAL } from '../context/conversation-goal-planner.contract';
import type { NutritionExecutionResultV2 } from '../diet/v2/execution/nutrition-application-execution.contract';
import { NutritionApplicationExecutorService } from '../diet/v2/execution/nutrition-application-executor.service';
import { NutritionPublicResultFormatter } from '../diet/v2/execution/nutrition-public-result.formatter';
import type { GenerateNutritionPlanV2Input } from '../diet/v2/nutrition-planning-generation.contract';
import { NutritionV2PilotConfigService } from './nutrition-v2-pilot-config.service';

const MAX_OFFICIAL_MESSAGE_LENGTH = 10_000;
const PILOT_TIMEOUT = new Error('NUTRITION_V2_PILOT_TIMEOUT');

export interface NutritionV2PilotSelectionInput {
  readonly userId: string;
  readonly profileId: string | null;
  readonly decision: ConversationGoalDecision;
  readonly generationInput: GenerateNutritionPlanV2Input | null;
  readonly correlationId: string;
  readonly traceId?: string;
  readonly legacyContent: string;
}

export interface NutritionV2PilotSelection {
  readonly content: string;
  readonly selected: 'LEGACY' | 'V2';
  readonly suppressShadow: boolean;
}

@Injectable()
export class NutritionV2PilotService {
  private readonly logger = new Logger(NutritionV2PilotService.name);

  constructor(
    private readonly config: NutritionV2PilotConfigService,
    private readonly executor: NutritionApplicationExecutorService,
    private readonly formatter: NutritionPublicResultFormatter,
  ) {}

  async select(
    input: NutritionV2PilotSelectionInput,
  ): Promise<NutritionV2PilotSelection> {
    const authorization = this.config.authorize(input.userId);
    const subject = this.subject(input.userId);

    if (authorization.status === 'DISABLED') {
      this.logger.debug('Nutrition V2 Pilot desabilitado');
      return this.legacy(input.legacyContent, false);
    }
    if (authorization.status === 'INVALID_CONFIG') {
      this.logger.warn('Nutrition V2 Pilot com configuração inválida');
      return this.legacy(input.legacyContent, false);
    }
    if (authorization.status === 'NOT_AUTHORIZED') {
      this.logger.debug(
        `Nutrition V2 Pilot recusou usuário não autorizado: ${subject}`,
      );
      return this.legacy(input.legacyContent, false);
    }
    const generationInput = input.generationInput;
    if (
      input.decision.goal !== CONVERSATION_GOAL.GENERATE_DIET_PLAN ||
      generationInput?.explicitArtifactType !== 'DAILY_STRUCTURE'
    ) {
      this.logger.debug(
        `Nutrition V2 Pilot recusou goal ou artifact inelegível: ${subject}`,
      );
      return this.legacy(input.legacyContent, false);
    }
    const profileId = input.profileId;
    if (!profileId?.trim()) {
      this.logger.warn(
        `Nutrition V2 Pilot sem ownership disponível: ${subject}`,
      );
      return this.legacy(input.legacyContent, false);
    }

    this.logger.debug(`Nutrition V2 Pilot iniciou execução: ${subject}`);
    try {
      const attempt = await this.withTimeout(
        this.executeAndFormat(input, generationInput, profileId),
        this.config.timeoutMs(),
      );

      if (!this.compatible(attempt.result) || attempt.formatted === null) {
        this.logger.warn(
          `Nutrition V2 Pilot recebeu resultado incompatível: ${subject}`,
        );
        return this.legacy(input.legacyContent, true);
      }

      const formatted = attempt.formatted;
      if (
        typeof formatted !== 'string' ||
        !formatted.trim() ||
        formatted.trim().length > MAX_OFFICIAL_MESSAGE_LENGTH
      ) {
        this.logger.warn(
          `Nutrition V2 Pilot recebeu resposta incompatível: ${subject}`,
        );
        return this.legacy(input.legacyContent, true);
      }

      this.logger.log(`Nutrition V2 Pilot selecionou resposta V2: ${subject}`);
      return Object.freeze({
        content: formatted.trim(),
        selected: 'V2' as const,
        suppressShadow: true,
      });
    } catch (error: unknown) {
      if (error === PILOT_TIMEOUT)
        this.logger.warn(`Nutrition V2 Pilot excedeu timeout: ${subject}`);
      else
        this.logger.warn(
          `Nutrition V2 Pilot aplicou fallback por erro: ${subject}`,
        );
      return this.legacy(input.legacyContent, true);
    }
  }

  private async executeAndFormat(
    input: NutritionV2PilotSelectionInput,
    generationInput: GenerateNutritionPlanV2Input,
    profileId: string,
  ): Promise<{
    readonly result: NutritionExecutionResultV2;
    readonly formatted: string | null;
  }> {
    const result = await this.executor.execute({
      generationInput,
      ownership: {
        userId: input.userId,
        profileId,
      },
      correlationId: input.correlationId,
      traceId: input.traceId,
    });
    return Object.freeze({
      result,
      formatted: this.compatible(result) ? this.formatter.format(result) : null,
    });
  }

  private compatible(
    result: NutritionExecutionResultV2,
  ): result is Extract<NutritionExecutionResultV2, { readonly kind: 'PLAN' }> {
    return (
      result.kind === 'PLAN' &&
      result.artifactType === 'DAILY_STRUCTURE' &&
      typeof result.document === 'object' &&
      result.document !== null
    );
  }

  private withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
    let handle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      handle = setTimeout(() => reject(PILOT_TIMEOUT), timeoutMs);
    });

    return Promise.race([operation, timeout]).finally(() => {
      if (handle !== undefined) clearTimeout(handle);
    });
  }

  private legacy(
    content: string,
    suppressShadow: boolean,
  ): NutritionV2PilotSelection {
    return Object.freeze({
      content,
      selected: 'LEGACY' as const,
      suppressShadow,
    });
  }

  private subject(userId: string): string {
    return createHash('sha256').update(userId).digest('hex').slice(0, 12);
  }
}
