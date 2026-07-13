import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { ConversationShadowDiagnosticsService } from './conversation-shadow-diagnostics.service';
import { CONVERSATION_LAYER_MODE } from './conversation-layer-operational-config.service';
import { ConversationLayerOperationalConfigService } from './conversation-layer-operational-config.service';
import { NutritionConversationAuthorizedFactsBuilder } from './nutrition-conversation-authorized-facts.builder';
import {
  BuildNutritionConversationContextInput,
  NutritionConversationContextBuilder,
} from './nutrition-conversation-context.builder';
import { NutritionConversationComposer } from './nutrition-conversation-composer';
import { NutritionConversationDecisionEngine } from './nutrition-conversation-decision-engine';
import { NutritionConversationDecisionScoringPolicy } from './nutrition-conversation-decision-scoring-policy';
import { NutritionConversationLanguageRealizer } from './nutrition-conversation-language-realizer';
import { NutritionConversationLegacyCandidateAdapter } from './nutrition-conversation-legacy-candidate.adapter';
import { NutritionConversationComparator } from './nutrition-conversation-comparator';
import { SanitizedConversationPayloadBuilder } from './sanitized-conversation-payload.builder';

const SHADOW_TOTAL_TIMEOUT_MS = 25_000;
const SHADOW_CONCURRENCY_LIMIT = 2;

export interface ExecuteNutritionConversationShadowInput {
  readonly conversation: BuildNutritionConversationContextInput;
  readonly legacyText: string;
}

@Injectable()
export class NutritionConversationShadowPipelineService implements OnApplicationShutdown {
  private activeExecutions = 0;
  private shuttingDown = false;

  constructor(
    private readonly operationalConfig: ConversationLayerOperationalConfigService,
    private readonly contextBuilder: NutritionConversationContextBuilder,
    private readonly decisionEngine: NutritionConversationDecisionEngine,
    private readonly scoringPolicy: NutritionConversationDecisionScoringPolicy,
    private readonly composer: NutritionConversationComposer,
    private readonly authorizedFactsBuilder: NutritionConversationAuthorizedFactsBuilder,
    private readonly sanitizedPayloadBuilder: SanitizedConversationPayloadBuilder,
    private readonly languageRealizer: NutritionConversationLanguageRealizer,
    private readonly adapter: NutritionConversationLegacyCandidateAdapter,
    private readonly comparator: NutritionConversationComparator,
    private readonly diagnostics: ConversationShadowDiagnosticsService,
  ) {}

  execute(input: ExecuteNutritionConversationShadowInput): void {
    try {
      if (
        this.shuttingDown ||
        this.operationalConfig.get().effectiveMode !==
          CONVERSATION_LAYER_MODE.SHADOW
      ) {
        return;
      }

      if (this.activeExecutions >= SHADOW_CONCURRENCY_LIMIT) {
        this.safeDiagnostic({ event: 'SKIPPED_CONCURRENCY' });
        return;
      }

      this.activeExecutions += 1;
      this.safeDiagnostic({ event: 'STARTED' });
      const startedAt = performance.now();
      const work = Promise.resolve()
        .then(() => this.run(input, startedAt))
        .catch(() => undefined)
        .finally(() => {
          this.activeExecutions -= 1;
        });

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>((resolve) => {
        timeoutHandle = setTimeout(() => {
          this.safeDiagnostic({
            event: 'TIMEOUT',
            component: 'SHADOW_PIPELINE',
            latencyMs: SHADOW_TOTAL_TIMEOUT_MS,
          });
          resolve();
        }, SHADOW_TOTAL_TIMEOUT_MS);
        timeoutHandle.unref();
      });

      void Promise.race([work, timeout])
        .catch(() => undefined)
        .finally(() => {
          if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        });
    } catch {
      this.safeDiagnostic({ event: 'FAILED', component: 'EXECUTE' });
    }
  }

  onApplicationShutdown(): void {
    this.shuttingDown = true;
  }

  private async run(
    input: ExecuteNutritionConversationShadowInput,
    startedAt: number,
  ): Promise<void> {
    let component = 'CONTEXT';

    try {
      const context = this.contextBuilder.build(input.conversation);
      component = 'ENGINE';
      const candidates = this.decisionEngine.generate(context);
      component = 'POLICY';
      const decisionPlan = this.scoringPolicy.select(context, candidates);
      component = 'COMPOSER';
      const compositionPlan = this.composer.compose(context, decisionPlan);
      component = 'AUTHORIZED_FACTS';
      const authorizedFacts = this.authorizedFactsBuilder.build(context);
      component = 'PAYLOAD';
      const sanitizedPayload = this.sanitizedPayloadBuilder.build({
        context,
        authorizedFacts,
        decisionPlan,
        compositionPlan,
      });

      component = 'REALIZER';
      const realization = await this.languageRealizer.realize(sanitizedPayload);
      component = 'ADAPTER';
      const envelope = this.adapter.adapt(input.legacyText, realization);
      component = 'COMPARATOR';
      const comparison = this.comparator.compare({
        envelope,
        candidate: realization,
        payload: sanitizedPayload,
        incrementalLatencyMs: performance.now() - startedAt,
      });

      this.safeDiagnostic({
        event: 'COMPLETED',
        realizerStatus: realization.status,
        candidateEligible: comparison.candidateEligible,
        rejectionCode: comparison.ineligibilityCode,
        latencyMs: comparison.metrics.incrementalLatencyMs,
        legacyCharacters: comparison.metrics.legacyCharacters,
        candidateCharacters: comparison.metrics.candidateCharacters,
        candidateQuestions: comparison.metrics.candidateQuestions,
        candidateEmojis: comparison.metrics.candidateEmojis,
        fallback: realization.status === 'FALLBACK',
      });
    } catch {
      this.safeDiagnostic({ event: 'FAILED', component });
    }
  }

  private safeDiagnostic(
    diagnostic: Parameters<ConversationShadowDiagnosticsService['record']>[0],
  ): void {
    try {
      this.diagnostics.record(diagnostic);
    } catch {
      return;
    }
  }
}
