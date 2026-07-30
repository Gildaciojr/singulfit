import type { AuthorizedFactValue } from './conversation-authorized-facts.contract';
import type {
  NutritionConversationEpisode,
  NutritionConversationEpisodeEvidence,
  NutritionConversationEpisodeImportance,
  NutritionConversationEpisodeLifecycleDirective,
  NutritionConversationEpisodeSelection,
  NutritionConversationEpisodeSelectionContext,
  NutritionConversationEpisodeSuppression,
  NutritionConversationEpisodeSuppressionReason,
  NutritionConversationEpisodicRecall,
} from './nutrition-conversation-episodic-memory.contract';

const IMPORTANCE_ORDER: Readonly<
  Record<NutritionConversationEpisodeImportance, number>
> = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 });

export class NutritionConversationEpisodicMemoryEngine {
  register(
    existing: readonly NutritionConversationEpisode[],
    evidence: readonly NutritionConversationEpisodeEvidence[],
    logicalNow: number,
  ): readonly NutritionConversationEpisode[] {
    this.validateLogicalTime(logicalNow);
    const episodes = existing.map((episode) => this.freezeEpisode(episode));

    for (const item of evidence) {
      this.validateEvidence(item, logicalNow);
      const previousIndex = this.latestActiveIndex(
        episodes,
        item.continuityKey,
      );
      const previous =
        previousIndex === -1 ? undefined : episodes[previousIndex];
      if (previous) {
        episodes[previousIndex] = this.transition(
          previous,
          'SUPERSEDED',
          'SUPERSEDED',
          logicalNow,
          'NEWER_STRUCTURED_EVIDENCE',
        );
      }
      const consolidated =
        previous !== undefined &&
        previous.category === item.category &&
        JSON.stringify(previous.fact) === JSON.stringify(item.fact);
      episodes.push(
        this.freezeEpisode({
          ...item,
          status: item.initialStatus ?? 'ACTIVE',
          lifecycle: {
            state: consolidated ? 'CONSOLIDATED' : 'ORIGINAL',
            version: (previous?.lifecycle.version ?? 0) + 1,
            lastTransitionAtLogical: logicalNow,
            ...(consolidated
              ? { transitionReason: 'REPEATED_STRUCTURED_EVIDENCE' }
              : {}),
          },
        }),
      );
    }

    return Object.freeze(episodes);
  }

  applyLifecycle(
    source: readonly NutritionConversationEpisode[],
    directives: readonly NutritionConversationEpisodeLifecycleDirective[],
    logicalNow: number,
  ): readonly NutritionConversationEpisode[] {
    this.validateLogicalTime(logicalNow);
    const directiveByKey = new Map(
      directives.map((directive) => {
        this.validateLogicalTime(directive.atLogical);
        if (!directive.reason.trim()) {
          throw new Error('Diretiva episódica sem motivo estruturado');
        }
        return [directive.continuityKey, directive] as const;
      }),
    );

    return Object.freeze(
      source.map((episode) => {
        const directive = ['SUPERSEDED', 'EXPIRED', 'INVALIDATED'].includes(
          episode.status,
        )
          ? undefined
          : directiveByKey.get(episode.continuityKey);
        if (directive) {
          if (directive.action === 'COMPLETE') {
            return this.transition(
              episode,
              'COMPLETED',
              episode.lifecycle.state,
              directive.atLogical,
              directive.reason,
            );
          }
          if (directive.action === 'INVALIDATE') {
            return this.transition(
              episode,
              'INVALIDATED',
              'INVALIDATED',
              directive.atLogical,
              directive.reason,
            );
          }
          return this.transition(
            episode,
            'EXPIRED',
            'EXPIRED',
            directive.atLogical,
            directive.reason,
          );
        }
        if (
          episode.expiresAtLogical !== undefined &&
          episode.expiresAtLogical <= logicalNow &&
          !['SUPERSEDED', 'INVALIDATED', 'EXPIRED'].includes(episode.status)
        ) {
          return this.transition(
            episode,
            'EXPIRED',
            'EXPIRED',
            logicalNow,
            'LOGICAL_EXPIRATION_REACHED',
          );
        }
        return this.freezeEpisode(episode);
      }),
    );
  }

  select(
    source: readonly NutritionConversationEpisode[],
    context: NutritionConversationEpisodeSelectionContext,
  ): NutritionConversationEpisodeSelection {
    this.validateSelectionContext(context);
    const episodes = this.applyLifecycle(source, [], context.logicalNow);
    const suppressed: NutritionConversationEpisodeSuppression[] = [];
    const eligible = episodes.filter((episode) => {
      const reason = this.ineligibilityReason(episode, context);
      if (reason) suppressed.push(this.suppression(episode, reason));
      return reason === undefined;
    });
    const ordered = [...eligible].sort((left, right) =>
      this.compare(left, right, context),
    );
    const selected: NutritionConversationEpisodicRecall[] = [];
    const selectedCategories = new Set<string>();

    for (const episode of ordered) {
      if (selectedCategories.has(episode.category)) {
        suppressed.push(this.suppression(episode, 'CATEGORY_DUPLICATE'));
        continue;
      }
      if (selected.length >= Math.min(context.limit, 3)) {
        suppressed.push(this.suppression(episode, 'RECALL_BUDGET'));
        continue;
      }
      selectedCategories.add(episode.category);
      selected.push(this.recall(episode));
    }

    return Object.freeze({
      episodes,
      selected: Object.freeze(selected),
      suppressed: Object.freeze(suppressed),
    });
  }

  private ineligibilityReason(
    episode: NutritionConversationEpisode,
    context: NutritionConversationEpisodeSelectionContext,
  ): NutritionConversationEpisodeSuppressionReason | undefined {
    if (episode.status === 'EXPIRED') return 'EXPIRED';
    if (!['ACTIVE', 'PENDING', 'COMPLETED'].includes(episode.status))
      return 'STATUS_INELIGIBLE';
    if (
      !episode.eligibleForConversation ||
      episode.resumePolicy === 'NEVER' ||
      episode.recallPolicy === 'PROHIBITED'
    )
      return 'CONVERSATION_PROHIBITED';
    if (episode.nature !== 'FACT' && episode.confirmation !== 'CONFIRMED')
      return 'CONFIRMATION_REQUIRED';
    if (!this.isContextuallyRelevant(episode, context))
      return 'CONTEXT_MISMATCH';
    if (
      context.fatigueScore >= 70 &&
      !['HIGH', 'CRITICAL'].includes(episode.importance)
    )
      return 'FATIGUE';
    return undefined;
  }

  private isContextuallyRelevant(
    episode: NutritionConversationEpisode,
    context: NutritionConversationEpisodeSelectionContext,
  ): boolean {
    if (context.relevantCategories.includes(episode.category)) return true;
    if (context.currentGoal && episode.goalRelation === context.currentGoal)
      return true;
    if (context.currentTheme && episode.theme === context.currentTheme)
      return true;
    if (
      context.dialogueProfile === 'CONTINUITY_CHECK' &&
      episode.resumePolicy !== 'NEVER'
    )
      return true;
    return episode.recallReason === 'SAFETY_RELEVANCE';
  }

  private compare(
    left: NutritionConversationEpisode,
    right: NutritionConversationEpisode,
    context: NutritionConversationEpisodeSelectionContext,
  ): number {
    const relevance =
      this.relevance(right, context) - this.relevance(left, context);
    if (relevance !== 0) return relevance;
    const leftReused = context.previouslyRecalledContinuityKeys.includes(
      left.continuityKey,
    );
    const rightReused = context.previouslyRecalledContinuityKeys.includes(
      right.continuityKey,
    );
    if (leftReused !== rightReused) return leftReused ? 1 : -1;
    const importance =
      IMPORTANCE_ORDER[right.importance] - IMPORTANCE_ORDER[left.importance];
    if (importance !== 0) return importance;
    if (left.createdAtLogical !== right.createdAtLogical)
      return right.createdAtLogical - left.createdAtLogical;
    return left.continuityKey < right.continuityKey
      ? -1
      : left.continuityKey > right.continuityKey
        ? 1
        : 0;
  }

  private relevance(
    episode: NutritionConversationEpisode,
    context: NutritionConversationEpisodeSelectionContext,
  ): number {
    return [
      context.relevantCategories.includes(episode.category),
      Boolean(
        context.currentGoal && episode.goalRelation === context.currentGoal,
      ),
      Boolean(context.currentTheme && episode.theme === context.currentTheme),
      episode.recallReason === 'SAFETY_RELEVANCE',
      context.dialogueProfile === 'CONTINUITY_CHECK',
    ].filter(Boolean).length;
  }

  private latestActiveIndex(
    episodes: readonly NutritionConversationEpisode[],
    continuityKey: string,
  ): number {
    for (let index = episodes.length - 1; index >= 0; index -= 1) {
      if (
        episodes[index].continuityKey === continuityKey &&
        !['SUPERSEDED', 'EXPIRED', 'INVALIDATED'].includes(
          episodes[index].status,
        )
      )
        return index;
    }
    return -1;
  }

  private transition(
    episode: NutritionConversationEpisode,
    status: NutritionConversationEpisode['status'],
    state: NutritionConversationEpisode['lifecycle']['state'],
    atLogical: number,
    reason: string,
  ): NutritionConversationEpisode {
    return this.freezeEpisode({
      ...episode,
      status,
      lifecycle: {
        ...episode.lifecycle,
        state,
        version: episode.lifecycle.version + 1,
        lastTransitionAtLogical: atLogical,
        transitionReason: reason,
      },
    });
  }

  private recall(
    episode: NutritionConversationEpisode,
  ): NutritionConversationEpisodicRecall {
    return Object.freeze({
      continuityKey: episode.continuityKey,
      category: episode.category,
      fact: this.freezeValue(episode.fact),
      relationToContext: episode.relationToContext,
      recallReason: episode.recallReason,
      source: episode.source,
      sensitivity: episode.sensitivity,
    });
  }

  private suppression(
    episode: NutritionConversationEpisode,
    reason: NutritionConversationEpisodeSuppressionReason,
  ): NutritionConversationEpisodeSuppression {
    return Object.freeze({
      continuityKey: episode.continuityKey,
      category: episode.category,
      reason,
    });
  }

  private validateEvidence(
    evidence: NutritionConversationEpisodeEvidence,
    logicalNow: number,
  ): void {
    this.validateLogicalTime(evidence.createdAtLogical);
    if (evidence.createdAtLogical > logicalNow)
      throw new Error('Episódio criado após o tempo lógico atual');
    if (evidence.expiresAtLogical !== undefined) {
      this.validateLogicalTime(evidence.expiresAtLogical);
      if (evidence.expiresAtLogical <= evidence.createdAtLogical)
        throw new Error('Expiração episódica inválida');
    }
    if (!evidence.continuityKey.trim())
      throw new Error('Episódio sem chave de continuidade');
    if (!evidence.relationToContext.trim())
      throw new Error('Episódio sem relação contextual');
    if (evidence.originEvidence.length === 0)
      throw new Error('Episódio sem evidência estruturada');
    if (evidence.nature === 'FACT' && evidence.confirmation !== 'NOT_REQUIRED')
      throw new Error('Fato não exige confirmação episódica');
    if (
      ['INFERENCE', 'HYPOTHESIS'].includes(evidence.nature) &&
      evidence.recallPolicy !== 'REQUIRES_CONFIRMATION'
    )
      throw new Error('Inferência ou hipótese sem confirmação obrigatória');
  }

  private validateSelectionContext(
    context: NutritionConversationEpisodeSelectionContext,
  ): void {
    this.validateLogicalTime(context.logicalNow);
    if (!Number.isInteger(context.limit) || context.limit < 0)
      throw new Error('Limite episódico inválido');
    if (
      !Number.isFinite(context.fatigueScore) ||
      context.fatigueScore < 0 ||
      context.fatigueScore > 100
    )
      throw new Error('Fadiga episódica inválida');
  }

  private validateLogicalTime(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error('Tempo lógico episódico inválido');
  }

  private freezeEpisode(
    episode: NutritionConversationEpisode,
  ): NutritionConversationEpisode {
    return Object.freeze({
      ...episode,
      fact: this.freezeValue(episode.fact),
      originEvidence: Object.freeze(
        episode.originEvidence.map((item) =>
          Object.freeze({ ...item, value: this.freezeValue(item.value) }),
        ),
      ),
      lifecycle: Object.freeze({ ...episode.lifecycle }),
    });
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
}
