import { Injectable } from '@nestjs/common';
import { ConversationUnderstandingValidator } from '../validators/conversation-understanding.validator';
import { isWorkoutCurrentPlanRead } from '../../workout/v2/workout-current-plan-read.policy';
import { isWorkoutExpenditureTopic } from './daily-query.policy';
import type {
  ConversationUnderstandingInput,
  ConversationUnderstandingResult,
} from '../contracts/conversation-understanding.contract';
import { ConversationUnderstandingEngineService } from './conversation-understanding-engine.service';

@Injectable()
export class ConversationUnderstandingService {
  constructor(
    private readonly engine: ConversationUnderstandingEngineService,
  ) {}

  async understand(
    input: ConversationUnderstandingInput,
  ): Promise<ConversationUnderstandingResult> {
    const original = await Promise.resolve(this.engine.understand(input));
    if (
      original.safety.requiresSafeResponse ||
      isWorkoutCurrentPlanRead(input.text) ||
      input.continuity.activeProfileField !== null ||
      input.continuity.pendingConfirmation ||
      !['WORKOUT', 'GENERAL', 'UNKNOWN'].includes(original.domain) ||
      !['ANSWER', 'NONE', 'GENERATE_PLAN', 'PROVIDE_GUIDANCE'].includes(
        original.operation,
      ) ||
      ['EMPTY_MESSAGE', 'INVALID_RESULT', 'UNSUPPORTED_CONTENT'].includes(
        original.failure ?? '',
      )
    )
      return original;
    const resolution = original.metadata.workoutModalityResolution;
    if (!resolution) return original;
    if (resolution.action === 'AMBIGUOUS')
      return {
        ...original,
        status: 'FAILED',
        failure: 'AMBIGUOUS',
        intent: 'UNKNOWN',
        operation: 'NONE',
        domain: 'UNKNOWN',
        confidence: 'LOW',
        entities: [],
        references: [],
        ambiguity: {
          present: true,
          codes: ['CONFLICTING_GOALS'],
          clarificationRequired: true,
        },
        metadata: {
          ...original.metadata,
          workoutModalityResolution: resolution,
        },
      };
    if (
      !resolution.modality ||
      isWorkoutExpenditureTopic(input.text) ||
      !['PLAN_REQUEST', 'MODALITY_CHANGE'].includes(resolution.action)
    )
      return original;
    const result: ConversationUnderstandingResult = {
      ...original,
      status: 'UNDERSTOOD',
      failure: null,
      intent: 'WORKOUT_PLAN_REQUEST',
      operation: 'GENERATE_PLAN',
      domain: 'WORKOUT',
      confidence: resolution.confidence,
      entities: [
        ...original.entities.filter(
          (entity) => entity.kind !== 'WORKOUT_MODALITY',
        ),
        { kind: 'WORKOUT_MODALITY', value: resolution.modality },
      ],
      references: [],
      ambiguity: { present: false, codes: [], clarificationRequired: false },
      metadata: {
        ...original.metadata,
        source: resolution.source === 'SEMANTIC' ? 'HYBRID' : 'DETERMINISTIC',
        workoutModalityResolution: resolution,
      },
    };
    new ConversationUnderstandingValidator().assertValid(result);
    return result;
  }
}
