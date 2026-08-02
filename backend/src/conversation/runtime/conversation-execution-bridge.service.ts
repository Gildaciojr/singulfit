import { Injectable } from '@nestjs/common';
import type { ConversationRoutingDecision } from '../contracts/conversation-execution-route.contract';
import type { ConversationBridgeResult } from '../contracts/conversation-runtime.contract';
import type { CoachConversationHumanContext } from '../../context/coach-conversation-human-context.contract';
import { ConversationLanguageRealizerService } from './conversation-language-realizer.service';
import { ConversationResponseFormatterService } from './conversation-response-formatter.service';
import { ConversationResponsePayloadBuilder } from './conversation-response-payload.builder';
import { ConversationResponseValidatorService } from './conversation-response-validator.service';

@Injectable()
export class ConversationExecutionBridgeService {
  constructor(
    private readonly payloadBuilder: ConversationResponsePayloadBuilder,
    private readonly realizer: ConversationLanguageRealizerService,
    private readonly formatter: ConversationResponseFormatterService,
    private readonly validator: ConversationResponseValidatorService,
  ) {}

  execute(
    decision: ConversationRoutingDecision,
    humanContext: CoachConversationHumanContext | null = null,
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
      case 'PROGRESS_REVIEW':
      case 'NUTRITION_GUIDANCE':
        return 'READ_OR_GUIDANCE_EXECUTOR_NOT_CONNECTED';
      case 'LEGACY_FALLBACK':
        return 'ROUTER_REQUESTED_LEGACY_FALLBACK';
      case 'ANSWER_MESSAGE':
      case 'CONFIRMATION':
      case 'SAFETY_RESPONSE':
        return 'SUPPORTED_ROUTE_WITHOUT_PAYLOAD';
    }
  }
}
