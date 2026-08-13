import { Injectable } from '@nestjs/common';
import type { ConversationRoutingDecision } from '../contracts/conversation-execution-route.contract';
import type { ConversationBridgeResult } from '../contracts/conversation-runtime.contract';
import type { CoachConversationHumanContext } from '../../context/coach-conversation-human-context.contract';
import { ConversationLanguageRealizerService } from './conversation-language-realizer.service';
import { ConversationResponseFormatterService } from './conversation-response-formatter.service';
import { ConversationResponsePayloadBuilder } from './conversation-response-payload.builder';
import { ConversationResponseValidatorService } from './conversation-response-validator.service';
import { ConversationQAExecutorService } from './conversation-qa-executor.service';

export interface ConversationBridgeExecutionContext {
  readonly userId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly deadlineAtMs?: number;
}

@Injectable()
export class ConversationExecutionBridgeService {
  constructor(
    private readonly payloadBuilder: ConversationResponsePayloadBuilder,
    private readonly realizer: ConversationLanguageRealizerService,
    private readonly formatter: ConversationResponseFormatterService,
    private readonly validator: ConversationResponseValidatorService,
    private readonly qa?: ConversationQAExecutorService,
  ) {}

  execute(
    decision: ConversationRoutingDecision,
    humanContext: CoachConversationHumanContext | null = null,
    executionContext?: ConversationBridgeExecutionContext,
  ): Promise<ConversationBridgeResult> {
    const route = decision.executionRoute;
    const payload = this.payloadBuilder.build(route, humanContext);
    if (!payload) {
      return Promise.resolve(
        Object.freeze({
          status: 'FALLBACK_REQUIRED' as const,
          content: null,
          routeKind: route.kind,
          reason: this.unsupportedReason(route.kind),
        }),
      );
    }
    if (
      payload.kind === 'CONTEXTUAL_RESPONSE' &&
      this.qaEligible(payload.cue, payload.currentMessage) &&
      humanContext &&
      executionContext &&
      this.qa
    ) {
      return this.executeQA(decision, humanContext, executionContext);
    }
    try {
      const realized = this.realizer.realize(payload);
      if (!this.validator.isValid(realized)) {
        return Promise.resolve(
          Object.freeze({
            status: 'FAILED' as const,
            content: null,
            routeKind: route.kind,
            reason: 'INVALID_RESPONSE_CONTENT',
          }),
        );
      }
      const content = this.formatter.format(realized);
      return Promise.resolve(
        Object.freeze({
          status: 'COMPLETED' as const,
          content,
          routeKind: route.kind,
        }),
      );
    } catch {
      return Promise.resolve(
        Object.freeze({
          status: 'FAILED' as const,
          content: null,
          routeKind: route.kind,
          reason: 'RESPONSE_PIPELINE_FAILED',
        }),
      );
    }
  }

  private async executeQA(
    decision: ConversationRoutingDecision,
    humanContext: CoachConversationHumanContext,
    executionContext: ConversationBridgeExecutionContext,
  ): Promise<ConversationBridgeResult> {
    let result: Awaited<ReturnType<ConversationQAExecutorService['execute']>>;
    try {
      result = await this.qa!.execute({
        ...executionContext,
        route: decision.executionRoute,
        humanContext,
      });
    } catch {
      return Object.freeze({
        status: 'COMPLETED',
        content:
          'Não consegui responder isso com segurança agora. Pode tentar novamente em instantes?',
        routeKind: decision.executionRoute.kind,
        observability: Object.freeze({
          answerSource: 'DETERMINISTIC_FALLBACK',
          disposition: null,
          domain: null,
          grounding: null,
          providerDurationMs: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          fallbackReason: 'QA_EXECUTOR_UNEXPECTED_EXCEPTION',
        }),
      });
    }
    if (result.status === 'COMPLETED') {
      return Object.freeze({
        status: 'COMPLETED',
        content: result.content,
        routeKind: decision.executionRoute.kind,
        observability: result.observability,
      });
    }
    if (result.status === 'DEFERRED') {
      return Object.freeze({
        status: 'COMPLETED',
        content:
          'Você quer apenas uma orientação ou quer que eu altere isso de forma permanente no seu plano?',
        routeKind: decision.executionRoute.kind,
        observability: result.observability,
      });
    }
    return Object.freeze({
      status: 'COMPLETED',
      content:
        'Não consegui responder isso com segurança agora. Pode tentar novamente em instantes?',
      routeKind: decision.executionRoute.kind,
      observability: result.observability,
    });
  }

  private qaEligible(
    cue: CoachConversationHumanContext['turnCue'],
    message: string,
  ): boolean {
    const trivialCues = new Set<CoachConversationHumanContext['turnCue']>([
      'GREETING',
      'THANKS',
      'AFFIRMATION',
      'NEGATION',
      'FAREWELL',
    ]);
    if (!trivialCues.has(cue)) return true;
    const lexicalParts = message
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .split(/[^a-zA-Z0-9]+/u)
      .filter(Boolean);
    return lexicalParts.length > 3;
  }

  private unsupportedReason(
    kind: ConversationRoutingDecision['executionRoute']['kind'],
  ): string {
    switch (kind) {
      case 'NUTRITION_PLAN_GENERATION':
      case 'WORKOUT_PLAN_GENERATION':
      case 'COMBINED_PLAN_GENERATION':
      case 'NUTRITION_PLAN_UPDATE':
      case 'WORKOUT_PLAN_UPDATE':
        return 'SIDE_EFFECT_ROUTE_REQUIRES_LEGACY_SINGLE_EXECUTION';
      case 'PROFILE_ACQUISITION':
        return 'PROFILE_ACQUISITION_NOT_CONNECTED';
      case 'CURRENT_PLAN_PRESENTATION':
      case 'PLAN_STATUS':
        return 'READ_OR_GUIDANCE_EXECUTOR_NOT_CONNECTED';
      case 'LEGACY_FALLBACK':
        return 'ROUTER_REQUESTED_LEGACY_FALLBACK';
      case 'ANSWER_MESSAGE':
      case 'PROGRESS_REVIEW':
      case 'NUTRITION_GUIDANCE':
      case 'CONFIRMATION':
      case 'SAFETY_RESPONSE':
        return 'SUPPORTED_ROUTE_WITHOUT_PAYLOAD';
    }
  }
}
