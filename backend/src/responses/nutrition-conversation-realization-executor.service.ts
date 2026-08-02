import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIJobStatus, AIJobType, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { OpenAIJsonSchema } from '../ai/interfaces/openai.interface';
import { AIUsageService } from '../ai/ai-usage.service';
import { PromptService } from '../ai/prompt.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  LanguageRealizationExecutionStatus,
  LanguageRealizationOperationalMetadata,
  LanguageRealizationResult,
} from './conversation-language-realization.contract';
import { NutritionConversationLanguageRealizer } from './nutrition-conversation-language-realizer';
import { NUTRITION_CONVERSATION_REALIZATION_PROMPT } from './nutrition-conversation-realization-prompt.definition';
import type { SanitizedConversationPayload } from './sanitized-conversation-payload.contract';
import { SanitizedConversationPayloadReferenceBuilder } from './sanitized-conversation-payload-reference.builder';
import type { ConversationReasoningEvidence } from './reasoning-bridge/conversation-reasoning-bridge.contract';

const JOB_FAILURE_CODE = 'CONVERSATION_REALIZATION_FAILED';

export interface ExecuteNutritionConversationRealizationInput {
  readonly userId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly payload: SanitizedConversationPayload;
  readonly reasoningEvidence?: ConversationReasoningEvidence;
}

type RealizationJob = Prisma.AIJobGetPayload<{
  include: {
    usage: true;
  };
}>;

type PreparedRealization =
  | {
      readonly execute: true;
      readonly job: RealizationJob;
    }
  | {
      readonly execute: false;
      readonly job: RealizationJob;
      readonly status: LanguageRealizationExecutionStatus;
      readonly failureCode: string;
    };

@Injectable()
export class NutritionConversationRealizationExecutorService {
  private readonly referenceBuilder =
    new SanitizedConversationPayloadReferenceBuilder();

  constructor(
    private readonly prisma: PrismaService,
    private readonly promptService: PromptService,
    private readonly aiUsageService: AIUsageService,
    private readonly languageRealizer: NutritionConversationLanguageRealizer,
    private readonly configService: ConfigService,
  ) {}

  async execute(
    input: ExecuteNutritionConversationRealizationInput,
  ): Promise<LanguageRealizationResult> {
    const reference = this.referenceBuilder.build(input.payload);
    const promptVersion = await this.promptService.getActive(
      NUTRITION_CONVERSATION_REALIZATION_PROMPT.name,
    );
    const prompt = this.resolvePrompt(promptVersion);
    const operationKey = this.operationKey(input, promptVersion.id, reference);
    const prepared = await this.prepare(input, promptVersion.id, operationKey);

    if (!prepared.execute) {
      if (prepared.status === 'REUSED_COMPLETED') {
        const stored = this.reuseCompleted(prepared.job);
        if (stored) return stored;
      }
      return this.unavailable(
        reference,
        prepared.job,
        prepared.status,
        prepared.failureCode,
      );
    }

    let realization: LanguageRealizationResult;

    try {
      const execution = {
        prompt,
        operation: {
          aiJobId: prepared.job.id,
          promptVersionId: prepared.job.promptVersionId,
        },
      };
      realization = input.reasoningEvidence
        ? await this.languageRealizer.realize(
            input.payload,
            execution,
            input.reasoningEvidence,
          )
        : await this.languageRealizer.realize(input.payload, execution);
    } catch {
      await this.failJob(prepared.job.id, JOB_FAILURE_CODE);
      return this.unavailable(
        reference,
        prepared.job,
        'FAILED',
        JOB_FAILURE_CODE,
      );
    }

    try {
      return await this.persistOutcome(prepared.job, realization);
    } catch {
      const metadata = this.requireOperationalMetadata(realization);
      await this.failJob(
        prepared.job.id,
        JOB_FAILURE_CODE,
        metadata.providerResponseId,
      );
      return this.withFinalMetadata(realization, {
        ...metadata,
        executionStatus: 'FAILED',
      });
    }
  }

  private async prepare(
    input: ExecuteNutritionConversationRealizationInput,
    promptVersionId: string,
    operationKey: string,
  ): Promise<PreparedRealization> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        WITH advisory_lock AS (
          SELECT pg_advisory_xact_lock(
            hashtext(${this.identityLockKey(input, promptVersionId)})
          )
        )
        SELECT true AS "locked"
        FROM advisory_lock
      `;

      await this.assertOperationalContext(transaction, input);

      const existingByOperation = await transaction.aIJob.findUnique({
        where: { operationKey },
        include: { usage: true },
      });
      if (existingByOperation) {
        return this.resolveExisting(transaction, existingByOperation);
      }

      const existingByIdentity = await transaction.aIJob.findUnique({
        where: {
          messageId_type_promptVersionId: {
            messageId: input.messageId,
            type: AIJobType.CONVERSATION_REALIZATION,
            promptVersionId,
          },
        },
        include: { usage: true },
      });
      if (existingByIdentity) {
        return {
          execute: false,
          job: existingByIdentity,
          status: 'PAYLOAD_CONFLICT',
          failureCode: 'PAYLOAD_REFERENCE_CONFLICT',
        };
      }

      const pendingJob = await transaction.aIJob.create({
        data: {
          userId: input.userId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          type: AIJobType.CONVERSATION_REALIZATION,
          promptVersionId,
          operationKey,
        },
        include: { usage: true },
      });

      return this.resolveExisting(transaction, pendingJob);
    });
  }

  private async resolveExisting(
    transaction: Prisma.TransactionClient,
    job: RealizationJob,
  ): Promise<PreparedRealization> {
    if (job.status === AIJobStatus.PENDING) {
      const now = new Date();
      const claimed = await transaction.aIJob.update({
        where: { id: job.id },
        data: {
          status: AIJobStatus.PROCESSING,
          startedAt: now,
          leaseExpiresAt: new Date(now.getTime() + this.getLeaseMs()),
          attempts: { increment: 1 },
          failedAt: null,
          error: null,
        },
        include: { usage: true },
      });
      return { execute: true, job: claimed };
    }
    if (job.status === AIJobStatus.PROCESSING) {
      return {
        execute: false,
        job,
        status: 'IN_PROGRESS',
        failureCode: 'JOB_PROCESSING',
      };
    }
    if (job.status === AIJobStatus.COMPLETED) {
      return {
        execute: false,
        job,
        status: 'REUSED_COMPLETED',
        failureCode: 'JOB_ALREADY_COMPLETED',
      };
    }
    return {
      execute: false,
      job,
      status: 'TERMINAL_FAILURE',
      failureCode: 'JOB_ALREADY_FAILED',
    };
  }

  private async persistOutcome(
    job: RealizationJob,
    realization: LanguageRealizationResult,
  ): Promise<LanguageRealizationResult> {
    const metadata = this.requireOperationalMetadata(realization);
    const providerCompleted =
      metadata.providerResponseId !== null &&
      metadata.model !== null &&
      metadata.usage !== null;
    const accepted =
      realization.status === 'COMPLETED' ||
      realization.status === 'PARTIALLY_COMPLETED';

    return this.prisma.$transaction(async (transaction) => {
      const usage = providerCompleted
        ? await this.aiUsageService.recordInTransaction(transaction, {
            userId: job.userId,
            aiJobId: job.id,
            jobType: AIJobType.CONVERSATION_REALIZATION,
            model: metadata.model,
            promptTokens: metadata.usage?.inputTokens ?? 0,
            completionTokens: metadata.usage?.outputTokens ?? 0,
            totalTokens: metadata.usage?.totalTokens ?? 0,
          })
        : null;
      const completedAt = new Date();
      const finalized = this.withFinalMetadata(realization, {
        ...metadata,
        usage: metadata.usage
          ? Object.freeze({
              ...metadata.usage,
              estimatedCostUsd: usage?.estimatedCost.toString() ?? null,
            })
          : null,
        executionStatus: accepted ? 'COMPLETED' : 'FAILED',
      });
      const changed = await transaction.aIJob.updateMany({
        where: {
          id: job.id,
          status: AIJobStatus.PROCESSING,
        },
        data: accepted
          ? {
              status: AIJobStatus.COMPLETED,
              providerResponseId: metadata.providerResponseId,
              result: finalized as unknown as Prisma.InputJsonValue,
              completedAt,
              leaseExpiresAt: null,
              error: null,
            }
          : {
              status: AIJobStatus.FAILED,
              providerResponseId: metadata.providerResponseId,
              failedAt: completedAt,
              leaseExpiresAt: null,
              error: JOB_FAILURE_CODE,
            },
      });
      if (changed.count !== 1) {
        throw new ConflictException(
          'Realização conversacional não está disponível para conclusão',
        );
      }

      return finalized;
    });
  }

  private reuseCompleted(
    job: RealizationJob,
  ): LanguageRealizationResult | null {
    if (!this.isRecord(job.result)) return null;
    const stored = job.result;
    if (
      typeof stored.id !== 'string' ||
      typeof stored.sanitizedPayloadReference !== 'string' ||
      (stored.status !== 'COMPLETED' &&
        stored.status !== 'PARTIALLY_COMPLETED') ||
      typeof stored.candidateText !== 'string' ||
      !stored.candidateText.trim()
    ) {
      return null;
    }
    const result = this.deepFreezeJson(stored) as LanguageRealizationResult;
    const usage = job.usage[0];
    return this.withFinalMetadata(result, {
      aiJobId: job.id,
      promptVersionId: job.promptVersionId,
      providerResponseId: job.providerResponseId,
      model: usage?.model ?? result.operationalMetadata?.model ?? null,
      usage: usage
        ? Object.freeze({
            inputTokens: usage.promptTokens,
            outputTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            estimatedCostUsd: usage.estimatedCost.toString(),
          })
        : (result.operationalMetadata?.usage ?? null),
      executionStatus: 'REUSED_COMPLETED',
    });
  }

  private async failJob(
    aiJobId: string,
    error: string,
    providerResponseId: string | null = null,
  ): Promise<void> {
    try {
      await this.prisma.aIJob.updateMany({
        where: {
          id: aiJobId,
          status: AIJobStatus.PROCESSING,
        },
        data: {
          status: AIJobStatus.FAILED,
          failedAt: new Date(),
          leaseExpiresAt: null,
          error,
          ...(providerResponseId ? { providerResponseId } : {}),
        },
      });
    } catch {
      return;
    }
  }

  private async assertOperationalContext(
    transaction: Prisma.TransactionClient,
    input: ExecuteNutritionConversationRealizationInput,
  ): Promise<void> {
    const message = await transaction.message.findUnique({
      where: { id: input.messageId },
      select: {
        conversationId: true,
        conversation: {
          select: { userId: true },
        },
      },
    });
    if (
      !message ||
      message.conversationId !== input.conversationId ||
      message.conversation.userId !== input.userId
    ) {
      throw new BadRequestException(
        'Mensagem, conversa e usuário não correspondem',
      );
    }
  }

  private resolvePrompt(promptVersion: {
    readonly name: string;
    readonly prompt: string;
    readonly capability: string | null;
    readonly model: string | null;
    readonly jsonSchema: Prisma.JsonValue | null;
  }): {
    readonly model: 'TEXT';
    readonly instructions: string;
    readonly schema: OpenAIJsonSchema;
  } {
    const schema = promptVersion.jsonSchema;
    if (
      promptVersion.name !== NUTRITION_CONVERSATION_REALIZATION_PROMPT.name ||
      promptVersion.capability !==
        NUTRITION_CONVERSATION_REALIZATION_PROMPT.capability ||
      promptVersion.model !== 'TEXT' ||
      !promptVersion.prompt.trim() ||
      !this.isRecord(schema) ||
      typeof schema.name !== 'string' ||
      !schema.name.trim() ||
      !this.isRecord(schema.schema)
    ) {
      throw new ServiceUnavailableException(
        'Prompt oficial de realização conversacional inválido',
      );
    }

    return Object.freeze({
      model: 'TEXT' as const,
      instructions: promptVersion.prompt.trim(),
      schema: Object.freeze({
        name: schema.name,
        ...(typeof schema.description === 'string' && schema.description.trim()
          ? { description: schema.description.trim() }
          : {}),
        schema: schema.schema as Record<string, unknown>,
      }),
    });
  }

  private operationKey(
    input: ExecuteNutritionConversationRealizationInput,
    promptVersionId: string,
    payloadReference: string,
  ): string {
    const digest = createHash('sha256')
      .update(
        [
          input.userId,
          input.messageId,
          promptVersionId,
          AIJobType.CONVERSATION_REALIZATION,
          payloadReference,
          ...(input.reasoningEvidence
            ? [this.reasoningReference(input.reasoningEvidence)]
            : []),
        ].join(':'),
      )
      .digest('hex');
    return `conversation-realization:${digest}`;
  }

  private reasoningReference(evidence: ConversationReasoningEvidence): string {
    return createHash('sha256')
      .update(this.canonicalStringify(evidence))
      .digest('hex');
  }

  private canonicalStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.canonicalStringify(item)).join(',')}]`;
    }
    if (this.isRecord(value)) {
      return `{${Object.keys(value)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${this.canonicalStringify(value[key])}`,
        )
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }

  private identityLockKey(
    input: ExecuteNutritionConversationRealizationInput,
    promptVersionId: string,
  ): string {
    return [
      'conversation-realization',
      input.userId,
      input.messageId,
      promptVersionId,
    ].join(':');
  }

  private unavailable(
    reference: string,
    job: RealizationJob,
    executionStatus: LanguageRealizationExecutionStatus,
    failureCode: string,
  ): LanguageRealizationResult {
    const usage = job.usage[0];
    return Object.freeze({
      id: `language-realization:${reference.slice('sanitized-payload:'.length)}`,
      sanitizedPayloadReference: reference,
      status: 'FAILED',
      candidateText: null,
      candidateTextSource: 'VALIDATED_UNITS',
      realizedUnits: Object.freeze([]),
      omittedUnits: Object.freeze([]),
      realizedFacts: Object.freeze([]),
      omittedFacts: Object.freeze([]),
      realizedDecisions: Object.freeze([]),
      omittedDecisions: Object.freeze([]),
      disclaimerRealized: false,
      questionRealized: false,
      closingRealized: false,
      producedLength: 0,
      producedQuestionCount: 0,
      warningCodes: Object.freeze([]),
      failureCode,
      operationalMetadata: Object.freeze({
        aiJobId: job.id,
        promptVersionId: job.promptVersionId,
        providerResponseId: job.providerResponseId,
        model: usage?.model ?? null,
        usage: usage
          ? Object.freeze({
              inputTokens: usage.promptTokens,
              outputTokens: usage.completionTokens,
              totalTokens: usage.totalTokens,
              estimatedCostUsd: usage.estimatedCost.toString(),
            })
          : null,
        executionStatus,
      }),
    });
  }

  private requireOperationalMetadata(
    realization: LanguageRealizationResult,
  ): LanguageRealizationOperationalMetadata {
    if (!realization.operationalMetadata) {
      throw new ServiceUnavailableException(
        'Metadata operacional da realização ausente',
      );
    }
    return realization.operationalMetadata;
  }

  private withFinalMetadata(
    realization: LanguageRealizationResult,
    operationalMetadata: LanguageRealizationOperationalMetadata,
  ): LanguageRealizationResult {
    return Object.freeze({
      ...realization,
      operationalMetadata: Object.freeze(operationalMetadata),
    });
  }

  private getLeaseMs(): number {
    const seconds = Number.parseInt(
      this.configService.get<string>('AI_JOB_LEASE_SECONDS', '120'),
      10,
    );
    if (!Number.isInteger(seconds) || seconds < 30 || seconds > 3600) {
      throw new ServiceUnavailableException(
        'AI_JOB_LEASE_SECONDS possui valor inválido',
      );
    }
    return seconds * 1_000;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private deepFreezeJson(value: Prisma.JsonValue): unknown {
    if (Array.isArray(value)) {
      return Object.freeze(value.map((item) => this.deepFreezeJson(item)));
    }
    if (this.isRecord(value)) {
      return Object.freeze(
        Object.fromEntries(
          Object.entries(value).map(([key, item]) => [
            key,
            this.deepFreezeJson(item as Prisma.JsonValue),
          ]),
        ),
      );
    }
    return value;
  }
}
