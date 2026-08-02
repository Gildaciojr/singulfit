import { Injectable } from '@nestjs/common';
import { ConversationReasoningExplanationBuilder } from './conversation-reasoning-explanation.builder';
import type {
  ConversationReasoningBridgeInput,
  ConversationReasoningBridgeResult,
  ConversationReasoningEvidence,
} from './conversation-reasoning-bridge.contract';
import { ConversationReasoningPriorityBuilder } from './conversation-reasoning-priority.builder';
import { ConversationReasoningQuestionBuilder } from './conversation-reasoning-question.builder';
import { ConversationReasoningSafetyBuilder } from './conversation-reasoning-safety.builder';
import { ConversationReasoningSummaryBuilder } from './conversation-reasoning-summary.builder';
import { ConversationReasoningTeachingBuilder } from './conversation-reasoning-teaching.builder';
import { ConversationReasoningTradeoffBuilder } from './conversation-reasoning-tradeoff.builder';

const INTERNAL_VALUE =
  /\b(?:[A-Z][A-Z0-9]*_+[A-Z0-9_]*|packageIds?|strategyIds?|reasonCodes?|conflictCodes?|priorityCodes?)\b/u;
const TECHNICAL_ID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu;

@Injectable()
export class ConversationReasoningBridgeService {
  private readonly summaryBuilder = new ConversationReasoningSummaryBuilder();
  private readonly priorityBuilder = new ConversationReasoningPriorityBuilder();
  private readonly tradeoffBuilder = new ConversationReasoningTradeoffBuilder();
  private readonly teachingBuilder = new ConversationReasoningTeachingBuilder();
  private readonly questionBuilder = new ConversationReasoningQuestionBuilder();
  private readonly safetyBuilder = new ConversationReasoningSafetyBuilder();
  private readonly explanationBuilder =
    new ConversationReasoningExplanationBuilder();

  build(
    input: ConversationReasoningBridgeInput,
  ): ConversationReasoningBridgeResult {
    const availability = Object.freeze({
      planner: input.planner != null,
      nutrition: input.nutrition != null,
      workout: input.workout != null,
      longitudinal:
        input.longitudinal != null || input.longitudinalContext != null,
    });
    if (!Object.values(availability).some(Boolean)) {
      return Object.freeze({ evidence: null, availability });
    }

    const summary = this.summaryBuilder.build(input);
    const priorities = this.priorityBuilder.build(input);
    const strategies = this.summaryBuilder.strategies(input);
    const tradeoffs = this.tradeoffBuilder.build(input);
    const safetyResult = this.safetyBuilder.build(input);
    const evidence: ConversationReasoningEvidence = Object.freeze({
      summary,
      priorities,
      strategies,
      restrictions: safetyResult.restrictions,
      tradeoffs,
      explanations: this.explanationBuilder.build({
        summary,
        priorities,
        strategies,
        tradeoffs,
        safety: safetyResult.safety,
      }),
      teachingOpportunities: this.teachingBuilder.build(input, strategies),
      suggestedQuestions: this.questionBuilder.build(input),
      safety: safetyResult.safety,
      longitudinal: this.summaryBuilder.longitudinal(input),
      application:
        input.application ??
        Object.freeze({
          nutrition: this.defaultApplication(input.nutrition != null),
          workout: this.defaultApplication(input.workout != null),
          longitudinal: this.defaultApplication(input.longitudinal != null),
        }),
    });
    this.assertSemantic(evidence);
    return Object.freeze({ evidence, availability });
  }

  private defaultApplication(available: boolean) {
    return Object.freeze({
      appliedToGeneration: false,
      observedOnly: available,
      unavailable: !available,
    });
  }

  private assertSemantic(value: unknown): void {
    if (typeof value === 'string') {
      if (INTERNAL_VALUE.test(value) || TECHNICAL_ID.test(value)) {
        throw new Error(
          'Evidência conversacional contém identificador interno',
        );
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => this.assertSemantic(item));
      return;
    }
    if (typeof value === 'object' && value !== null) {
      Object.values(value).forEach((item) => this.assertSemantic(item));
    }
  }
}
