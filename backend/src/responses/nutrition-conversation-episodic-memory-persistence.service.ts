import { Injectable, Logger } from '@nestjs/common';
import { MemoryType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthorizedFactValue } from './conversation-authorized-facts.contract';
import type {
  NutritionConversationEpisodeCaptureCommand,
  NutritionConversationPersistedEpisodeReference,
} from './nutrition-conversation-episodic-memory-capture.contract';
import type {
  NutritionConversationEpisode,
  NutritionConversationEpisodeCategory,
  NutritionConversationEpisodeConfidence,
  NutritionConversationEpisodeConfirmation,
  NutritionConversationEpisodeImportance,
  NutritionConversationEpisodeLifecycleState,
  NutritionConversationEpisodeNature,
  NutritionConversationEpisodeRecallPolicy,
  NutritionConversationEpisodeRecallReason,
  NutritionConversationEpisodeResumePolicy,
  NutritionConversationEpisodeSelectionContext,
  NutritionConversationEpisodeSensitivity,
  NutritionConversationEpisodeSource,
  NutritionConversationEpisodeStatus,
  NutritionConversationEpisodicRecall,
} from './nutrition-conversation-episodic-memory.contract';
import { NutritionConversationEpisodicMemoryEngine } from './nutrition-conversation-episodic-memory.engine';

const EPISODIC_SOURCE_PREFIX = 'episodic:v1:';
const EPISODIC_SCHEMA = 'NUTRITION_EPISODIC_MEMORY';
const EPISODIC_SCHEMA_VERSION = 1;
const DEFAULT_READ_LIMIT = 20;
const CAPTURE_STATE_LIMIT = 50;

interface PersistedEpisodicEnvelope {
  readonly schema: typeof EPISODIC_SCHEMA;
  readonly schemaVersion: typeof EPISODIC_SCHEMA_VERSION;
  readonly continuityKey: string;
  readonly history: readonly NutritionConversationEpisode[];
  readonly lastRecalledAtLogical: number | null;
}

interface ParsedRow {
  readonly sourceKey: string;
  readonly envelope: PersistedEpisodicEnvelope;
}

const CATEGORIES = new Set<NutritionConversationEpisodeCategory>([
  'GOAL',
  'DIFFICULTY',
  'HABIT',
  'SUCCESS',
  'SETBACK',
  'PLAN',
  'COMMITMENT',
  'QUESTION',
  'PREFERENCE',
  'ROUTINE',
  'ALLERGY',
  'RESTRICTION',
  'TRAVEL',
  'WORKOUT',
  'MILESTONE',
  'FOLLOW_UP',
]);
const NATURES = new Set<NutritionConversationEpisodeNature>([
  'FACT',
  'INFERENCE',
  'HYPOTHESIS',
  'OBSERVATION',
]);
const CONFIDENCES = new Set<NutritionConversationEpisodeConfidence>([
  'LOW',
  'MEDIUM',
  'HIGH',
]);
const STATUSES = new Set<NutritionConversationEpisodeStatus>([
  'ACTIVE',
  'PENDING',
  'COMPLETED',
  'SUPERSEDED',
  'EXPIRED',
  'INVALIDATED',
]);
const IMPORTANCES = new Set<NutritionConversationEpisodeImportance>([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);
const SOURCES = new Set<NutritionConversationEpisodeSource>([
  'NUTRITION',
  'USER_CONTEXT',
  'BEHAVIOR',
  'COACH',
  'LONGITUDINAL',
  'RECOMMENDATION',
]);
const RESUME_POLICIES = new Set<NutritionConversationEpisodeResumePolicy>([
  'NEVER',
  'WHEN_RELEVANT',
  'ON_FOLLOW_UP',
]);
const RECALL_POLICIES = new Set<NutritionConversationEpisodeRecallPolicy>([
  'FREE',
  'REQUIRES_CONFIRMATION',
  'PROHIBITED',
]);
const RECALL_REASONS = new Set<NutritionConversationEpisodeRecallReason>([
  'CURRENT_GOAL',
  'CURRENT_THEME',
  'FOLLOW_UP_DUE',
  'SAFETY_RELEVANCE',
  'STRATEGY_CONTINUITY',
  'PROGRESS_CONTINUITY',
  'USER_PREFERENCE',
]);
const SENSITIVITIES = new Set<NutritionConversationEpisodeSensitivity>([
  'STANDARD',
  'SENSITIVE',
]);
const CONFIRMATIONS = new Set<NutritionConversationEpisodeConfirmation>([
  'NOT_REQUIRED',
  'UNCONFIRMED',
  'CONFIRMED',
]);
const LIFECYCLE_STATES = new Set<NutritionConversationEpisodeLifecycleState>([
  'ORIGINAL',
  'CONSOLIDATED',
  'SUPERSEDED',
  'EXPIRED',
  'INVALIDATED',
]);

@Injectable()
export class NutritionConversationEpisodicMemoryPersistenceService {
  private readonly logger = new Logger(
    NutritionConversationEpisodicMemoryPersistenceService.name,
  );
  private readonly engine = new NutritionConversationEpisodicMemoryEngine();

  constructor(private readonly prisma: PrismaService) {}

  async loadCaptureState(
    userId: string,
  ): Promise<readonly NutritionConversationPersistedEpisodeReference[]> {
    this.requireUserId(userId);
    const rows = await this.prisma.conversationMemory.findMany({
      where: {
        userId,
        memoryType: MemoryType.SHORT_TERM,
        sourceKey: { startsWith: EPISODIC_SOURCE_PREFIX },
      },
      select: { sourceKey: true, content: true },
      orderBy: [
        { relevanceScore: 'desc' },
        { generatedAt: 'desc' },
        { id: 'asc' },
      ],
      take: CAPTURE_STATE_LIMIT,
    });

    return Object.freeze(
      rows.flatMap((row) => {
        const parsed = this.parseRow(row.sourceKey, row.content);
        if (!parsed) return [];
        const current = this.current(parsed.envelope.history);
        return current
          ? [
              Object.freeze({
                sourceKey: parsed.sourceKey,
                episode: current,
              }),
            ]
          : [];
      }),
    );
  }

  async applyCaptureCommands(
    userId: string,
    commands: readonly NutritionConversationEpisodeCaptureCommand[],
    now: Date,
  ): Promise<void> {
    this.requireUserId(userId);
    const logicalNow = this.logicalTime(now);
    const actionable = commands.filter(
      (command) => command.operation !== 'NO_OP',
    );
    if (actionable.length === 0) return;

    await this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, userId);
      for (const command of actionable) {
        await this.applyCommand(transaction, userId, command, logicalNow, now);
      }
    });
  }

  async selectForContext(
    userId: string,
    context: Omit<
      NutritionConversationEpisodeSelectionContext,
      'logicalNow' | 'previouslyRecalledContinuityKeys'
    >,
    now: Date,
  ): Promise<readonly NutritionConversationEpisodicRecall[]> {
    this.requireUserId(userId);
    const logicalNow = this.logicalTime(now);

    return this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, userId);
      const rows = await transaction.conversationMemory.findMany({
        where: {
          userId,
          memoryType: MemoryType.SHORT_TERM,
          sourceKey: { startsWith: EPISODIC_SOURCE_PREFIX },
        },
        select: {
          sourceKey: true,
          content: true,
          relevanceScore: true,
          generatedAt: true,
        },
        orderBy: [
          { relevanceScore: 'desc' },
          { generatedAt: 'desc' },
          { id: 'asc' },
        ],
        take: DEFAULT_READ_LIMIT,
      });
      const parsed = rows.flatMap((row) => {
        const item = this.parseRow(row.sourceKey, row.content);
        return item ? [item] : [];
      });
      const normalized: ParsedRow[] = [];

      for (const row of parsed) {
        const history = this.engine.applyLifecycle(
          row.envelope.history,
          [],
          logicalNow,
        );
        const updated = !this.sameHistory(row.envelope.history, history);
        const envelope = this.freezeEnvelope({
          ...row.envelope,
          history,
        });
        normalized.push(Object.freeze({ sourceKey: row.sourceKey, envelope }));
        if (updated) {
          await transaction.conversationMemory.update({
            where: {
              userId_memoryType_sourceKey: {
                userId,
                memoryType: MemoryType.SHORT_TERM,
                sourceKey: row.sourceKey,
              },
            },
            data: {
              content: this.serializeEnvelope(envelope),
              summary: this.summary(this.current(history)),
              generatedAt: now,
            },
          });
        }
      }

      const recalledAt = normalized
        .map((row) => row.envelope.lastRecalledAtLogical)
        .filter((value): value is number => value !== null);
      const mostRecentRecall =
        recalledAt.length > 0 ? Math.max(...recalledAt) : null;
      const previouslyRecalledContinuityKeys = normalized
        .filter(
          (row) =>
            mostRecentRecall !== null &&
            row.envelope.lastRecalledAtLogical === mostRecentRecall,
        )
        .map((row) => row.envelope.continuityKey);
      const episodes = normalized.flatMap((row) => {
        const current = this.current(row.envelope.history);
        return current ? [current] : [];
      });
      const selection = this.engine.select(episodes, {
        ...context,
        logicalNow,
        previouslyRecalledContinuityKeys,
      });
      const selectedKeys = new Set(
        selection.selected.map((episode) => episode.continuityKey),
      );

      for (const row of normalized) {
        if (!selectedKeys.has(row.envelope.continuityKey)) continue;
        const envelope = this.freezeEnvelope({
          ...row.envelope,
          lastRecalledAtLogical: logicalNow,
        });
        await transaction.conversationMemory.update({
          where: {
            userId_memoryType_sourceKey: {
              userId,
              memoryType: MemoryType.SHORT_TERM,
              sourceKey: row.sourceKey,
            },
          },
          data: { content: this.serializeEnvelope(envelope) },
        });
      }

      return selection.selected;
    });
  }

  private async applyCommand(
    transaction: Prisma.TransactionClient,
    userId: string,
    command: NutritionConversationEpisodeCaptureCommand,
    logicalNow: number,
    now: Date,
  ): Promise<void> {
    const identity = {
      userId,
      memoryType: MemoryType.SHORT_TERM,
      sourceKey: command.sourceKey,
    };
    const existing = await transaction.conversationMemory.findUnique({
      where: { userId_memoryType_sourceKey: identity },
      select: { content: true },
    });
    const parsed = existing
      ? this.parseRow(command.sourceKey, existing.content)
      : undefined;
    if (existing && !parsed) return;
    let history = parsed?.envelope.history ?? Object.freeze([]);

    if (command.evidence) {
      const current = this.current(history);
      const originCode = command.evidence.originEvidence[0]?.code;
      if (
        current &&
        originCode &&
        current.originEvidence.some((item) => item.code === originCode) &&
        JSON.stringify(current.fact) === JSON.stringify(command.evidence.fact)
      ) {
        return;
      }
      history = this.engine.register(history, [command.evidence], logicalNow);
    } else if (command.lifecycleAction) {
      if (history.length === 0) return;
      history = this.engine.applyLifecycle(
        history,
        [
          {
            continuityKey: command.continuityKey,
            action: command.lifecycleAction,
            atLogical: logicalNow,
            reason: command.reason,
          },
        ],
        logicalNow,
      );
    } else {
      return;
    }

    const envelope = this.freezeEnvelope({
      schema: EPISODIC_SCHEMA,
      schemaVersion: EPISODIC_SCHEMA_VERSION,
      continuityKey: command.continuityKey,
      history,
      lastRecalledAtLogical: parsed?.envelope.lastRecalledAtLogical ?? null,
    });
    const current = this.current(history);
    const data = {
      content: this.serializeEnvelope(envelope),
      summary: this.summary(current),
      relevanceScore: this.relevance(current),
      generatedAt: now,
    };

    await transaction.conversationMemory.upsert({
      where: { userId_memoryType_sourceKey: identity },
      update: data,
      create: { ...identity, ...data },
    });
  }

  private parseRow(
    sourceKey: string | null,
    content: Prisma.JsonValue,
  ): ParsedRow | undefined {
    if (!sourceKey?.startsWith(EPISODIC_SOURCE_PREFIX)) return undefined;
    const envelope = this.parseEnvelope(content);
    if (!envelope) {
      this.logger.warn(
        'Registro episódico incompatível ignorado com segurança',
      );
      return undefined;
    }
    return Object.freeze({ sourceKey, envelope });
  }

  private parseEnvelope(
    value: Prisma.JsonValue,
  ): PersistedEpisodicEnvelope | undefined {
    if (
      !this.isRecord(value) ||
      value.schema !== EPISODIC_SCHEMA ||
      value.schemaVersion !== EPISODIC_SCHEMA_VERSION ||
      typeof value.continuityKey !== 'string' ||
      !value.continuityKey.trim() ||
      !Array.isArray(value.history) ||
      !(
        value.lastRecalledAtLogical === null ||
        this.isLogicalTime(value.lastRecalledAtLogical)
      )
    ) {
      return undefined;
    }
    const history = value.history.map((episode) => this.parseEpisode(episode));
    if (
      history.length === 0 ||
      history.some((episode) => episode === undefined)
    )
      return undefined;
    const validHistory = history.filter(
      (episode): episode is NutritionConversationEpisode =>
        episode !== undefined,
    );
    if (
      validHistory.some(
        (episode) => episode.continuityKey !== value.continuityKey,
      )
    )
      return undefined;
    return this.freezeEnvelope({
      schema: EPISODIC_SCHEMA,
      schemaVersion: EPISODIC_SCHEMA_VERSION,
      continuityKey: value.continuityKey,
      history: Object.freeze(validHistory),
      lastRecalledAtLogical: value.lastRecalledAtLogical,
    });
  }

  private parseEpisode(
    value: Prisma.JsonValue,
  ): NutritionConversationEpisode | undefined {
    if (!this.isRecord(value)) return undefined;
    const category = this.enumValue(value.category, CATEGORIES);
    const nature = this.enumValue(value.nature, NATURES);
    const confidence = this.enumValue(value.confidence, CONFIDENCES);
    const status = this.enumValue(value.status, STATUSES);
    const importance = this.enumValue(value.importance, IMPORTANCES);
    const source = this.enumValue(value.source, SOURCES);
    const resumePolicy = this.enumValue(value.resumePolicy, RESUME_POLICIES);
    const recallPolicy = this.enumValue(value.recallPolicy, RECALL_POLICIES);
    const recallReason = this.enumValue(value.recallReason, RECALL_REASONS);
    const sensitivity = this.enumValue(value.sensitivity, SENSITIVITIES);
    const confirmation = this.enumValue(value.confirmation, CONFIRMATIONS);
    const lifecycle = this.isRecord(value.lifecycle)
      ? value.lifecycle
      : undefined;
    const lifecycleState = lifecycle
      ? this.enumValue(lifecycle.state, LIFECYCLE_STATES)
      : undefined;
    const lifecycleVersion =
      lifecycle &&
      typeof lifecycle.version === 'number' &&
      Number.isSafeInteger(lifecycle.version) &&
      lifecycle.version >= 1
        ? lifecycle.version
        : undefined;
    if (
      !category ||
      !nature ||
      !confidence ||
      !status ||
      !importance ||
      !source ||
      !resumePolicy ||
      !recallPolicy ||
      !recallReason ||
      !sensitivity ||
      !confirmation ||
      !lifecycle ||
      !lifecycleState ||
      lifecycleVersion === undefined ||
      !this.isLogicalTime(value.createdAtLogical) ||
      !(
        value.expiresAtLogical === undefined ||
        this.isLogicalTime(value.expiresAtLogical)
      ) ||
      typeof value.eligibleForConversation !== 'boolean' ||
      typeof value.continuityKey !== 'string' ||
      !value.continuityKey.trim() ||
      !Array.isArray(value.originEvidence) ||
      value.originEvidence.length === 0 ||
      !this.isAuthorizedValue(value.fact) ||
      typeof value.relationToContext !== 'string' ||
      !value.relationToContext.trim() ||
      !this.isLogicalTime(lifecycle.lastTransitionAtLogical)
    ) {
      return undefined;
    }
    const originEvidence = value.originEvidence.map((item) => {
      if (!this.isRecord(item)) return undefined;
      const itemSource = this.enumValue(item.source, SOURCES);
      if (
        !itemSource ||
        typeof item.code !== 'string' ||
        !item.code.trim() ||
        !this.isAuthorizedValue(item.value)
      )
        return undefined;
      return Object.freeze({
        code: item.code,
        source: itemSource,
        value: this.freezeValue(item.value),
      });
    });
    if (originEvidence.some((item) => item === undefined)) return undefined;
    if (
      value.goalRelation !== undefined &&
      typeof value.goalRelation !== 'string'
    )
      return undefined;
    if (value.theme !== undefined && typeof value.theme !== 'string')
      return undefined;
    if (
      lifecycle.transitionReason !== undefined &&
      typeof lifecycle.transitionReason !== 'string'
    )
      return undefined;

    return Object.freeze({
      category,
      nature,
      confidence,
      createdAtLogical: value.createdAtLogical,
      ...(value.expiresAtLogical !== undefined
        ? { expiresAtLogical: value.expiresAtLogical }
        : {}),
      status,
      importance,
      source,
      eligibleForConversation: value.eligibleForConversation,
      resumePolicy,
      recallPolicy,
      recallReason,
      continuityKey: value.continuityKey,
      originEvidence: Object.freeze(
        originEvidence.filter(
          (item): item is NonNullable<typeof item> => item !== undefined,
        ),
      ),
      sensitivity,
      lifecycle: Object.freeze({
        state: lifecycleState,
        version: lifecycleVersion,
        lastTransitionAtLogical: lifecycle.lastTransitionAtLogical,
        ...(typeof lifecycle.transitionReason === 'string'
          ? { transitionReason: lifecycle.transitionReason }
          : {}),
      }),
      confirmation,
      fact: this.freezeValue(value.fact),
      relationToContext: value.relationToContext,
      ...(typeof value.goalRelation === 'string'
        ? { goalRelation: value.goalRelation }
        : {}),
      ...(typeof value.theme === 'string' ? { theme: value.theme } : {}),
    });
  }

  private serializeEnvelope(
    envelope: PersistedEpisodicEnvelope,
  ): Prisma.InputJsonObject {
    return {
      schema: envelope.schema,
      schemaVersion: envelope.schemaVersion,
      continuityKey: envelope.continuityKey,
      history: envelope.history.map((episode) =>
        this.serializeEpisode(episode),
      ),
      lastRecalledAtLogical: envelope.lastRecalledAtLogical,
    };
  }

  private serializeEpisode(
    episode: NutritionConversationEpisode,
  ): Prisma.InputJsonObject {
    return {
      category: episode.category,
      nature: episode.nature,
      confidence: episode.confidence,
      createdAtLogical: episode.createdAtLogical,
      ...(episode.expiresAtLogical !== undefined
        ? { expiresAtLogical: episode.expiresAtLogical }
        : {}),
      status: episode.status,
      importance: episode.importance,
      source: episode.source,
      eligibleForConversation: episode.eligibleForConversation,
      resumePolicy: episode.resumePolicy,
      recallPolicy: episode.recallPolicy,
      recallReason: episode.recallReason,
      continuityKey: episode.continuityKey,
      originEvidence: episode.originEvidence.map((item) => ({
        code: item.code,
        source: item.source,
        value: item.value as Prisma.InputJsonValue,
      })),
      sensitivity: episode.sensitivity,
      lifecycle: {
        state: episode.lifecycle.state,
        version: episode.lifecycle.version,
        lastTransitionAtLogical: episode.lifecycle.lastTransitionAtLogical,
        ...(episode.lifecycle.transitionReason
          ? { transitionReason: episode.lifecycle.transitionReason }
          : {}),
      },
      confirmation: episode.confirmation,
      fact: episode.fact as Prisma.InputJsonValue,
      relationToContext: episode.relationToContext,
      ...(episode.goalRelation ? { goalRelation: episode.goalRelation } : {}),
      ...(episode.theme ? { theme: episode.theme } : {}),
    };
  }

  private current(
    history: readonly NutritionConversationEpisode[],
  ): NutritionConversationEpisode | undefined {
    return [...history].sort(
      (left, right) =>
        right.lifecycle.version - left.lifecycle.version ||
        right.createdAtLogical - left.createdAtLogical,
    )[0];
  }

  private summary(episode: NutritionConversationEpisode | undefined): string {
    return episode
      ? `Episódio ${episode.category} ${episode.status}`.slice(0, 2_000)
      : 'Episódio incompatível';
  }

  private relevance(
    episode: NutritionConversationEpisode | undefined,
  ): Prisma.Decimal {
    const values: Record<NutritionConversationEpisodeImportance, string> = {
      LOW: '0.4000',
      MEDIUM: '0.6500',
      HIGH: '0.8500',
      CRITICAL: '1.0000',
    };
    return new Prisma.Decimal(episode ? values[episode.importance] : '0.0000');
  }

  private freezeEnvelope(
    envelope: PersistedEpisodicEnvelope,
  ): PersistedEpisodicEnvelope {
    return Object.freeze({
      ...envelope,
      history: Object.freeze([...envelope.history]),
    });
  }

  private sameHistory(
    left: readonly NutritionConversationEpisode[],
    right: readonly NutritionConversationEpisode[],
  ): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  private enumValue<T extends string>(
    value: unknown,
    values: ReadonlySet<T>,
  ): T | undefined {
    return typeof value === 'string' && values.has(value as T)
      ? (value as T)
      : undefined;
  }

  private isAuthorizedValue(value: unknown): value is AuthorizedFactValue {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean'
    )
      return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value))
      return value.every((item) => this.isAuthorizedValue(item));
    return (
      this.isRecord(value) &&
      Object.values(value).every((item) => this.isAuthorizedValue(item))
    );
  }

  private freezeValue(value: AuthorizedFactValue): AuthorizedFactValue {
    if (Array.isArray(value))
      return Object.freeze(value.map((item) => this.freezeValue(item)));
    if (typeof value === 'object' && value !== null)
      return Object.freeze(
        Object.fromEntries(
          Object.entries(value).map(([key, item]) => [
            key,
            this.freezeValue(item),
          ]),
        ),
      );
    return value;
  }

  private lock(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<unknown> {
    return transaction.$queryRaw`
      WITH advisory_lock AS (
        SELECT pg_advisory_xact_lock(hashtext(${`episodic-memory:${userId}`}))
      )
      SELECT true AS "locked"
      FROM advisory_lock
    `;
  }

  private logicalTime(value: Date): number {
    const logicalTime = value.getTime();
    if (!Number.isSafeInteger(logicalTime) || logicalTime < 0)
      throw new Error('Relógio operacional episódico inválido');
    return logicalTime;
  }

  private isLogicalTime(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) >= 0;
  }

  private requireUserId(userId: string): void {
    if (!userId.trim()) throw new Error('Usuário episódico inválido');
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
