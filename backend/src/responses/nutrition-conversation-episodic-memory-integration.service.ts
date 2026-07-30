import { Injectable, Logger } from '@nestjs/common';
import {
  CONVERSATION_LAYER_MODE,
  ConversationLayerOperationalConfigService,
} from './conversation-layer-operational-config.service';
import type { BuildNutritionConversationContextInput } from './nutrition-conversation-context.builder';
import { NutritionConversationContextBuilder } from './nutrition-conversation-context.builder';
import { NutritionConversationEpisodicMemoryCaptureEngine } from './nutrition-conversation-episodic-memory-capture.engine';
import type { NutritionConversationEpisodeCategory } from './nutrition-conversation-episodic-memory.contract';
import { NutritionConversationEpisodicMemoryPersistenceService } from './nutrition-conversation-episodic-memory-persistence.service';

@Injectable()
export class NutritionConversationEpisodicMemoryIntegrationService {
  private readonly logger = new Logger(
    NutritionConversationEpisodicMemoryIntegrationService.name,
  );

  constructor(
    private readonly operationalConfig: ConversationLayerOperationalConfigService,
    private readonly contextBuilder: NutritionConversationContextBuilder,
    private readonly captureEngine: NutritionConversationEpisodicMemoryCaptureEngine,
    private readonly persistence: NutritionConversationEpisodicMemoryPersistenceService,
  ) {}

  async loadForContext(
    input: BuildNutritionConversationContextInput,
    now = new Date(),
  ) {
    try {
      if (!this.enabled()) return Object.freeze([]);
      const context = this.contextBuilder.build(input);
      return await this.persistence.selectForContext(
        input.context.userId,
        {
          currentGoal: context.userContext.goal ?? undefined,
          relevantCategories: this.relevantCategories(context),
          fatigueScore: context.communication.fatigue.score,
          dialogueProfile:
            context.dialogue?.interactionIntent === 'FOLLOW_UP'
              ? 'CONTINUITY_CHECK'
              : context.communication.fatigue.score >= 70
                ? 'REASSURE_AND_SIMPLIFY'
                : 'ACKNOWLEDGE_ONLY',
          limit: 3,
        },
        now,
      );
    } catch {
      this.logger.warn('Leitura episódica isolada após falha sanitizada');
      return Object.freeze([]);
    }
  }

  captureAfterCommit(input: BuildNutritionConversationContextInput): void {
    try {
      if (!this.enabled()) return;
      void Promise.resolve()
        .then(() => this.capture(input, new Date()))
        .catch(() => {
          this.logger.warn('Captura episódica isolada após falha sanitizada');
        });
    } catch {
      this.logger.warn('Captura episódica isolada após falha sanitizada');
    }
  }

  async capture(
    input: BuildNutritionConversationContextInput,
    now: Date,
  ): Promise<void> {
    if (!this.enabled()) return;
    const userId = input.context.userId;
    const context = this.contextBuilder.build(input);
    const existing = await this.persistence.loadCaptureState(userId);
    const commands = this.captureEngine.plan({
      userId,
      sourceEvidenceKey: input.analysis.id,
      logicalNow: now.getTime(),
      context,
      longitudinal: input.longitudinal,
      preferredMealTimes: input.context.preferences?.preferredMealTimes,
      ...(input.coach.experience.reengagement
        ? {
            coachReengagement: {
              reason: input.coach.experience.reengagement.reason,
              confidence: input.coach.experience.reengagement.confidence,
            },
          }
        : {}),
      existing,
    });
    await this.persistence.applyCaptureCommands(userId, commands, now);
  }

  private relevantCategories(
    context: ReturnType<NutritionConversationContextBuilder['build']>,
  ): readonly NutritionConversationEpisodeCategory[] {
    const categories = new Set<NutritionConversationEpisodeCategory>();
    for (const signal of context.recognition?.signals ?? []) {
      if (['SMALL_WIN', 'IMPROVEMENT', 'RECOVERY'].includes(signal.kind))
        categories.add('SUCCESS');
      if (signal.kind === 'BIG_WIN') categories.add('MILESTONE');
      if (
        ['CONSISTENCY', 'DISCIPLINE', 'ADHERENCE', 'MOMENTUM'].includes(
          signal.kind,
        )
      )
        categories.add('HABIT');
      if (signal.kind === 'GOOD_STRATEGY') categories.add('PLAN');
      if (['BAD_STRATEGY', 'PLATEAU'].includes(signal.kind))
        categories.add('DIFFICULTY');
      if (['SETBACK', 'RECURRENCE'].includes(signal.kind))
        categories.add('SETBACK');
    }
    if (context.dialogue?.interactionIntent === 'FOLLOW_UP') {
      categories.add('FOLLOW_UP');
      categories.add('COMMITMENT');
      categories.add('QUESTION');
    }
    return Object.freeze([...categories]);
  }

  private enabled(): boolean {
    return (
      this.operationalConfig.get().effectiveMode ===
      CONVERSATION_LAYER_MODE.SHADOW
    );
  }
}
