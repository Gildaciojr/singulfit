import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import {
  CoachProfileAcquisitionCycle,
  CoachProfileAcquisitionCycleStatus,
  CoachProfileValueSource,
  MessageDirection,
  MessageType,
  OutboundMessageStatus,
  ResponseType,
} from '@prisma/client';
import { EventBusService } from '../../event-bus/event-bus.service';
import { INTERNAL_EVENT } from '../../event-bus/event-bus.constants';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PROFILE_ACQUISITION_INTENT,
  type ProfileAcquisitionIntent,
} from '../coach-adaptive-profile-collector.contract';
import {
  CoachProfileMutationCommandFactoryService,
  CoachProfileMutationService,
} from './coach-profile-mutation.service';
import { ProfileAcquisitionCycleService } from './profile-acquisition-cycle.service';
import type {
  ProfileAcquisitionCaptureResult,
  ProfileAcquisitionRolloutReason,
  ProfileAcquisitionRolloutResult,
} from './profile-acquisition-internal-rollout.contract';
import { ProfileAcquisitionInternalEligibilityService } from './profile-acquisition-internal-eligibility.service';
import { ProfileAcquisitionOperationalConfigService } from './profile-acquisition-operational-config.service';
import { ProfileAcquisitionRuntimeService } from './profile-acquisition-runtime.service';
import {
  PROFILE_ACQUISITION_MODE,
  type ProfileAcquisitionMode,
  type ProfileQuestionSpecification,
  type RecognizedProfileAnswer,
} from './profile-acquisition.contract';
import { ProfileAnswerRecognizerService } from './profile-answer-recognizer.service';
import {
  ProfileQuestionRealizerService,
  ProfileQuestionSpecificationService,
} from './profile-question.service';

const ROLLOUT_ORIGIN = 'INTERNAL_PROFILE_ACQUISITION_ROLLOUT';
const WORKOUT_V2_ORIGIN = 'WORKOUT_V2_PRODUCTIVE_GENERATION';

type ActiveCycle = CoachProfileAcquisitionCycle | null;

@Injectable()
export class ProfileAcquisitionInternalRolloutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly config: ProfileAcquisitionOperationalConfigService,
    private readonly eligibility: ProfileAcquisitionInternalEligibilityService,
    private readonly runtime: ProfileAcquisitionRuntimeService,
    private readonly questionSpecifications: ProfileQuestionSpecificationService,
    private readonly questionRealizer: ProfileQuestionRealizerService,
    private readonly answerRecognizer: ProfileAnswerRecognizerService,
    private readonly mutationFactory: CoachProfileMutationCommandFactoryService,
    private readonly mutationService: CoachProfileMutationService,
    private readonly cycleService: ProfileAcquisitionCycleService,
  ) {}

  async requestWorkoutClarification(input: {
    readonly userId: string;
    readonly sourceMessageId: string;
    readonly referenceDate: Date;
    readonly originalRequestMessageId?: string;
  }): Promise<ProfileAcquisitionRolloutResult> {
    const source = await this.prisma.message.findFirst({
      where: {
        id: input.sourceMessageId,
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        conversation: { userId: input.userId },
      },
      select: { id: true, conversationId: true },
    });
    if (!source) {
      return this.rolloutResult(
        true,
        false,
        'MESSAGE_NOT_FOUND',
        this.config.get().mode,
      );
    }
    return this.dispatchQuestion(
      {
        userId: input.userId,
        conversationId: source.conversationId,
        sourceMessageId: source.id,
        sentAt: input.referenceDate,
      },
      this.config.get().mode,
      PROFILE_ACQUISITION_INTENT.WORKOUT_PLAN_REQUEST,
      `${WORKOUT_V2_ORIGIN}:${input.originalRequestMessageId ?? input.sourceMessageId}`,
    );
  }

  async authorizeQuestionSend(outboundMessageId: string): Promise<boolean> {
    const operational = this.config.get();
    const outbound = await this.prisma.outboundMessage.findUnique({
      where: { id: outboundMessageId },
      select: {
        id: true,
        userId: true,
        sourceMessageId: true,
        responseType: true,
      },
    });
    if (
      !outbound ||
      outbound.responseType !== ResponseType.PROFILE_ACQUISITION
    ) {
      return false;
    }
    const productiveCycle =
      await this.prisma.coachProfileAcquisitionCycle.findFirst({
        where: {
          userId: outbound.userId,
          sourceMessageId: outbound.sourceMessageId,
          active: true,
          origin: { startsWith: `${WORKOUT_V2_ORIGIN}:` },
        },
        select: { id: true },
      });
    if (productiveCycle) return true;
    const access =
      operational.mode === PROFILE_ACQUISITION_MODE.INTERNAL
        ? await this.eligibility.evaluate(outbound.userId)
        : null;
    const authorized = access?.internal === true && access.eligible;
    if (authorized) return true;

    const cancelledAt = new Date();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.outboundMessage.updateMany({
        where: {
          id: outbound.id,
          status: {
            in: [OutboundMessageStatus.PENDING, OutboundMessageStatus.FAILED],
          },
        },
        data: {
          status: OutboundMessageStatus.FAILED,
          failedAt: cancelledAt,
          leaseExpiresAt: null,
          errorMessage: 'PROFILE_ACQUISITION_DISABLED',
        },
      });
      await transaction.coachProfileAcquisitionCycle.updateMany({
        where: {
          userId: outbound.userId,
          sourceMessageId: outbound.sourceMessageId,
          active: true,
          askedAt: null,
        },
        data: {
          active: false,
          status: CoachProfileAcquisitionCycleStatus.CANCELLED,
          completedAt: cancelledAt,
          resultCode: 'ROLLOUT_DISABLED_BEFORE_SEND',
        },
      });
    });
    return false;
  }

  async afterOutboundSent(
    outboundMessageId: string,
  ): Promise<ProfileAcquisitionRolloutResult> {
    const operational = this.config.get();
    try {
      const outbound = await this.prisma.outboundMessage.findUnique({
        where: { id: outboundMessageId },
        select: {
          id: true,
          userId: true,
          conversationId: true,
          sourceMessageId: true,
          responseType: true,
          status: true,
          sentAt: true,
        },
      });
      if (!outbound) {
        return this.rolloutResult(
          true,
          false,
          'OUTBOUND_NOT_FOUND',
          operational.mode,
        );
      }
      if (
        (outbound.status !== OutboundMessageStatus.SENT &&
          outbound.status !== OutboundMessageStatus.DELIVERED) ||
        !outbound.sentAt
      ) {
        return this.rolloutResult(
          true,
          false,
          'OUTBOUND_NOT_SENT',
          operational.mode,
        );
      }
      const sentAt = outbound.sentAt;
      const sentOutbound = Object.freeze({ ...outbound, sentAt });
      const productiveCycle =
        await this.prisma.coachProfileAcquisitionCycle.findFirst({
          where: {
            userId: outbound.userId,
            sourceMessageId: outbound.sourceMessageId,
            active: true,
            origin: { startsWith: `${WORKOUT_V2_ORIGIN}:` },
          },
          select: { id: true },
        });
      if (!productiveCycle) {
        if (operational.mode !== PROFILE_ACQUISITION_MODE.INTERNAL) {
          return this.rolloutResult(false, false, 'MODE_OFF', operational.mode);
        }
        const access = await this.eligibility.evaluate(outbound.userId);
        if (!access.internal) {
          return this.rolloutResult(
            true,
            false,
            'USER_NOT_INTERNAL',
            operational.mode,
          );
        }
        if (!access.eligible) {
          return this.rolloutResult(
            true,
            false,
            'USER_NOT_ELIGIBLE',
            operational.mode,
          );
        }
      }

      if (outbound.responseType === ResponseType.PROFILE_ACQUISITION) {
        return this.markPromptSent(sentOutbound, operational.mode);
      }
      if (outbound.responseType !== ResponseType.NUTRITION_ANALYSIS) {
        return this.rolloutResult(
          true,
          false,
          'OUTBOUND_NOT_ELIGIBLE',
          operational.mode,
        );
      }

      return this.dispatchQuestion(sentOutbound, operational.mode);
    } catch {
      return this.rolloutResult(
        true,
        false,
        'ROLLOUT_FAILURE',
        operational.mode,
      );
    }
  }

  async afterCoachResponseSent(input: {
    readonly userId: string;
    readonly sourceMessageId: string;
    readonly intent: 'DIET' | 'WORKOUT' | 'BOTH' | 'UNKNOWN';
    readonly sentAt: Date;
  }): Promise<ProfileAcquisitionRolloutResult> {
    const operational = this.config.get();
    if (operational.mode !== PROFILE_ACQUISITION_MODE.INTERNAL) {
      return this.rolloutResult(false, false, 'MODE_OFF', operational.mode);
    }
    try {
      const intent = this.profileIntent(input.intent);
      if (!intent) {
        return this.rolloutResult(
          true,
          false,
          'OUTBOUND_NOT_ELIGIBLE',
          operational.mode,
        );
      }
      const access = await this.eligibility.evaluate(input.userId);
      if (!access.internal) {
        return this.rolloutResult(
          true,
          false,
          'USER_NOT_INTERNAL',
          operational.mode,
        );
      }
      if (!access.eligible) {
        return this.rolloutResult(
          true,
          false,
          'USER_NOT_ELIGIBLE',
          operational.mode,
        );
      }
      const source = await this.prisma.message.findFirst({
        where: {
          id: input.sourceMessageId,
          direction: MessageDirection.INBOUND,
          type: MessageType.TEXT,
          conversation: { userId: input.userId },
        },
        select: {
          id: true,
          conversationId: true,
        },
      });
      if (!source) {
        return this.rolloutResult(
          true,
          false,
          'MESSAGE_NOT_FOUND',
          operational.mode,
        );
      }
      return this.dispatchQuestion(
        {
          userId: input.userId,
          conversationId: source.conversationId,
          sourceMessageId: source.id,
          sentAt: input.sentAt,
        },
        operational.mode,
        intent,
      );
    } catch {
      return this.rolloutResult(
        true,
        false,
        'ROLLOUT_FAILURE',
        operational.mode,
      );
    }
  }

  async captureActiveResponse(input: {
    readonly userId: string;
    readonly messageId: string;
  }): Promise<ProfileAcquisitionCaptureResult> {
    const operational = this.config.get();
    const productiveCycle =
      await this.prisma.coachProfileAcquisitionCycle.findFirst({
        where: {
          userId: input.userId,
          active: true,
          origin: { startsWith: `${WORKOUT_V2_ORIGIN}:` },
        },
        orderBy: [{ referenceDate: 'desc' }, { id: 'desc' }],
      });
    if (
      !productiveCycle &&
      operational.mode !== PROFILE_ACQUISITION_MODE.INTERNAL
    ) {
      return this.captureResult(false, false, false, 'MODE_OFF');
    }

    try {
      if (!productiveCycle) {
        const access = await this.eligibility.evaluate(input.userId);
        if (!access.internal) {
          return this.captureResult(false, false, false, 'USER_NOT_INTERNAL');
        }
        if (!access.eligible) {
          return this.captureResult(false, false, false, 'USER_NOT_ELIGIBLE');
        }
      }
      const message = await this.prisma.message.findFirst({
        where: {
          id: input.messageId,
          direction: MessageDirection.INBOUND,
          type: MessageType.TEXT,
          conversation: { userId: input.userId },
        },
        select: {
          id: true,
          content: true,
          timestamp: true,
          conversationId: true,
        },
      });
      if (!message) {
        return this.captureResult(false, false, false, 'MESSAGE_NOT_FOUND');
      }
      const token = this.responseToken(message.id);
      const cycle =
        productiveCycle ?? (await this.findActiveCycle(input.userId));
      if (!cycle) {
        const duplicate =
          await this.prisma.coachProfileAcquisitionCycle.findFirst({
            where: {
              userId: input.userId,
              resultCode: { endsWith: token },
            },
            select: { id: true, field: true },
          });
        return duplicate
          ? this.captureResult(
              true,
              true,
              true,
              'DUPLICATE',
              duplicate.id,
              duplicate.field,
            )
          : this.captureResult(false, false, false, 'NO_ACTIVE_QUESTION');
      }
      if (!cycle.askedAt) {
        return this.captureResult(
          false,
          false,
          false,
          'QUESTION_NOT_SENT',
          cycle.id,
          cycle.field,
        );
      }
      if (cycle.expiresAt <= message.timestamp) {
        await this.cycleService.complete({
          userId: input.userId,
          cycleId: cycle.id,
          outcome: 'CANCELLED',
          resultCode: 'EXPIRED:' + token,
          referenceDate: message.timestamp.toISOString(),
        });
        await this.audit(input.userId, cycle.id, {
          event: 'QUESTION_EXPIRED',
          field: cycle.field,
        });
        return this.captureResult(
          false,
          false,
          false,
          'QUESTION_EXPIRED',
          cycle.id,
          cycle.field,
        );
      }
      if (cycle.resultCode?.endsWith(token)) {
        return this.captureResult(
          true,
          true,
          true,
          'DUPLICATE',
          cycle.id,
          cycle.field,
        );
      }

      return cycle.status ===
        CoachProfileAcquisitionCycleStatus.CONFIRMATION_PENDING
        ? this.captureConfirmation(cycle, message)
        : this.captureAnswer(cycle, message);
    } catch {
      return this.captureResult(false, false, false, 'ROLLOUT_FAILURE');
    }
  }

  private async dispatchQuestion(
    outbound: {
      readonly userId: string;
      readonly conversationId: string;
      readonly sourceMessageId: string;
      readonly sentAt: Date;
    },
    mode: ProfileAcquisitionMode,
    intent: ProfileAcquisitionIntent = PROFILE_ACQUISITION_INTENT.DIET_PLAN_REQUEST,
    origin = ROLLOUT_ORIGIN,
  ): Promise<ProfileAcquisitionRolloutResult> {
    const active = await this.findActiveCycle(outbound.userId);
    if (active) {
      if (
        active.sourceMessageId === outbound.sourceMessageId &&
        !active.askedAt
      ) {
        const specification = this.questionSpecifications.forField(
          active.field,
          'MISSING_CONTEXTUAL_FIELD',
        );
        const question = this.questionRealizer.realize(specification);
        await this.publishQuestion({
          userId: outbound.userId,
          conversationId: outbound.conversationId,
          sourceMessageId: outbound.sourceMessageId,
          content: question.text,
        });
        return this.rolloutResult(
          true,
          true,
          'QUESTION_RESUMED',
          mode,
          active.id,
          active.field,
        );
      }
      await this.audit(outbound.userId, active.id, {
        event: 'QUESTION_IGNORED',
        field: active.field,
        reason: 'QUESTION_ALREADY_ACTIVE',
      });
      return this.rolloutResult(
        true,
        false,
        'QUESTION_ALREADY_ACTIVE',
        mode,
        active.id,
        active.field,
      );
    }

    const runtime = await this.runtime.evaluate(
      outbound.userId,
      outbound.sentAt,
      intent,
    );
    if (!runtime.evaluation.canAsk || !runtime.specification) {
      const reason = this.runtimeReason(runtime.evaluation.reason);
      await this.audit(outbound.userId, null, {
        event: 'QUESTION_IGNORED',
        reason,
      });
      return this.rolloutResult(true, false, reason, mode);
    }
    const specification = runtime.specification;
    const question = this.questionRealizer.realize(specification);
    const operationKey = this.operationKey([
      origin,
      outbound.userId,
      outbound.sourceMessageId,
      specification.field,
      String(specification.version),
    ]);
    const expiresAt = new Date(
      outbound.sentAt.getTime() +
        this.config.get().questionExpirationHours * 60 * 60 * 1_000,
    );
    const prepared = await this.cycleService.prepare({
      userId: outbound.userId,
      specification,
      logicalTurn: runtime.evaluation.logicalTurn,
      origin,
      operationKey,
      referenceDate: outbound.sentAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      sourceMessageId: outbound.sourceMessageId,
    });
    if (
      !prepared.cycleId ||
      (prepared.status !== 'CREATED' &&
        prepared.status !== 'EXPIRED_PREVIOUS' &&
        prepared.status !== 'DUPLICATE')
    ) {
      return this.rolloutResult(
        true,
        false,
        prepared.status === 'QUESTION_ALREADY_ACTIVE'
          ? 'QUESTION_ALREADY_ACTIVE'
          : 'ROLLOUT_FAILURE',
        mode,
        prepared.cycleId,
        specification.field,
      );
    }

    try {
      await this.publishQuestion({
        userId: outbound.userId,
        conversationId: outbound.conversationId,
        sourceMessageId: outbound.sourceMessageId,
        content: question.text,
      });
    } catch (error: unknown) {
      await this.cycleService.complete({
        userId: outbound.userId,
        cycleId: prepared.cycleId,
        outcome: 'CANCELLED',
        resultCode: 'OUTBOUND_PERSISTENCE_FAILED',
        referenceDate: outbound.sentAt.toISOString(),
      });
      throw error;
    }

    return this.rolloutResult(
      true,
      true,
      'QUESTION_PREPARED',
      mode,
      prepared.cycleId,
      specification.field,
    );
  }

  private async markPromptSent(
    outbound: {
      readonly userId: string;
      readonly sourceMessageId: string;
      readonly sentAt: Date;
    },
    mode: ProfileAcquisitionMode,
  ): Promise<ProfileAcquisitionRolloutResult> {
    const cycle = await this.findActiveCycle(outbound.userId);
    if (!cycle) {
      return this.rolloutResult(true, false, 'NO_ACTIVE_QUESTION', mode);
    }
    if (
      cycle.status ===
        CoachProfileAcquisitionCycleStatus.CONFIRMATION_PENDING &&
      cycle.sourceMessageId !== outbound.sourceMessageId
    ) {
      await this.audit(outbound.userId, cycle.id, {
        event: 'CONFIRMATION_QUESTION_SENT',
        field: cycle.field,
      });
      return this.rolloutResult(
        true,
        false,
        'CONFIRMATION_REQUESTED',
        mode,
        cycle.id,
        cycle.field,
      );
    }
    await this.cycleService.markAsked({
      userId: outbound.userId,
      cycleId: cycle.id,
      askedAt: outbound.sentAt.toISOString(),
    });
    return this.rolloutResult(
      true,
      false,
      'QUESTION_PREPARED',
      mode,
      cycle.id,
      cycle.field,
    );
  }

  private async captureAnswer(
    cycle: NonNullable<ActiveCycle>,
    message: {
      readonly id: string;
      readonly content: string;
      readonly timestamp: Date;
      readonly conversationId: string;
    },
  ): Promise<ProfileAcquisitionCaptureResult> {
    const specification = this.questionSpecifications.forField(
      cycle.field,
      'MISSING_CONTEXTUAL_FIELD',
    );
    const answer = this.answerRecognizer.recognize(
      specification,
      message.content,
    );
    if (
      answer.disposition === 'INVALID' ||
      answer.disposition === 'UNRELATED' ||
      answer.disposition === 'UNKNOWN'
    ) {
      await this.audit(cycle.userId, cycle.id, {
        event: 'ANSWER_IGNORED',
        field: cycle.field,
        reason: answer.reasonCode,
        responseMilliseconds: this.responseMilliseconds(cycle, message),
      });
      return this.captureResult(
        false,
        false,
        false,
        answer.disposition === 'UNRELATED'
          ? 'ANSWER_UNRELATED'
          : 'ANSWER_INVALID',
        cycle.id,
        cycle.field,
      );
    }
    const claim = await this.cycleService.claimResponse({
      userId: cycle.userId,
      cycleId: cycle.id,
      messageId: message.id,
      receivedAt: message.timestamp.toISOString(),
    });
    if (claim.status === 'DUPLICATE') {
      return this.captureResult(
        true,
        true,
        true,
        'DUPLICATE',
        cycle.id,
        cycle.field,
      );
    }
    if (claim.status !== 'CLAIMED' || !claim.claimCode) {
      return this.captureResult(
        claim.status === 'BUSY',
        false,
        false,
        claim.status === 'BUSY'
          ? 'CONCURRENT_RESPONSE'
          : claim.status === 'EXPIRED'
            ? 'QUESTION_EXPIRED'
            : 'QUESTION_NOT_SENT',
        cycle.id,
        cycle.field,
      );
    }

    try {
      const command = this.mutationFactory.create({
        userId: cycle.userId,
        answer,
        source: CoachProfileValueSource.USER_REPORTED,
        referenceDate: message.timestamp.toISOString(),
        sourceOperationKey: message.id,
        reason: 'INITIAL_ANSWER',
      });
      if (!command) {
        await this.cycleService.releaseResponseClaim({
          userId: cycle.userId,
          cycleId: cycle.id,
          claimCode: claim.claimCode,
        });
        return this.captureResult(
          false,
          false,
          false,
          'ANSWER_INVALID',
          cycle.id,
          cycle.field,
        );
      }
      const mutation = await this.mutationService.execute(command);
      if (mutation.status === 'CONFLICT' || mutation.status === 'REJECTED') {
        await this.cycleService.releaseResponseClaim({
          userId: cycle.userId,
          cycleId: cycle.id,
          claimCode: claim.claimCode,
        });
        await this.audit(cycle.userId, cycle.id, {
          event: mutation.status,
          field: cycle.field,
          reason: mutation.reasonCode,
        });
        return this.captureResult(
          true,
          false,
          false,
          mutation.status === 'CONFLICT' ? 'CONFLICT' : 'ANSWER_INVALID',
          cycle.id,
          cycle.field,
        );
      }
      const token = this.responseToken(message.id);
      const outcome =
        answer.disposition === 'DECLINED'
          ? 'DECLINED'
          : answer.disposition === 'DEFERRED'
            ? 'DEFERRED'
            : 'ANSWERED';
      const reason =
        answer.disposition === 'DECLINED'
          ? 'ANSWER_DECLINED'
          : answer.disposition === 'DEFERRED'
            ? 'ANSWER_DEFERRED'
            : mutation.status === 'REQUIRES_CONFIRMATION'
              ? 'CONFIRMATION_REQUESTED'
              : 'ANSWER_PERSISTED';
      await this.cycleService.complete({
        userId: cycle.userId,
        cycleId: cycle.id,
        outcome,
        resultCode: outcome + ':' + token,
        referenceDate: message.timestamp.toISOString(),
      });
      await this.audit(cycle.userId, cycle.id, {
        event: reason,
        field: cycle.field,
        responseMilliseconds: this.responseMilliseconds(cycle, message),
      });
      if (
        mutation.status === 'REQUIRES_CONFIRMATION' &&
        answer.disposition === 'RECOGNIZED' &&
        answer.value !== undefined
      ) {
        await this.publishConfirmation(cycle, message, specification, answer);
      } else {
        await this.refreshRuntime(cycle.userId, message.timestamp);
      }
      return this.captureResult(
        true,
        false,
        true,
        reason,
        cycle.id,
        cycle.field,
        reason === 'ANSWER_PERSISTED' &&
          cycle.origin.startsWith(`${WORKOUT_V2_ORIGIN}:`)
          ? message.id
          : undefined,
        this.workoutOriginalRequest(cycle.origin),
      );
    } catch (error: unknown) {
      await this.cycleService.releaseResponseClaim({
        userId: cycle.userId,
        cycleId: cycle.id,
        claimCode: claim.claimCode,
      });
      throw error;
    }
  }

  private async captureConfirmation(
    cycle: NonNullable<ActiveCycle>,
    message: {
      readonly id: string;
      readonly content: string;
      readonly timestamp: Date;
      readonly conversationId: string;
    },
  ): Promise<ProfileAcquisitionCaptureResult> {
    const confirmation = this.answerRecognizer.recognizeConfirmation(
      message.content,
    );
    if (
      confirmation.disposition === 'INVALID' ||
      confirmation.disposition === 'UNRELATED'
    ) {
      await this.audit(cycle.userId, cycle.id, {
        event: 'CONFIRMATION_IGNORED',
        field: cycle.field,
        reason: confirmation.reasonCode,
      });
      return this.captureResult(
        false,
        false,
        false,
        'ANSWER_UNRELATED',
        cycle.id,
        cycle.field,
      );
    }
    const claim = await this.cycleService.claimResponse({
      userId: cycle.userId,
      cycleId: cycle.id,
      messageId: message.id,
      receivedAt: message.timestamp.toISOString(),
    });
    if (claim.status !== 'CLAIMED' || !claim.claimCode) {
      return this.captureResult(
        claim.status === 'DUPLICATE' || claim.status === 'BUSY',
        claim.status === 'DUPLICATE',
        claim.status === 'DUPLICATE',
        claim.status === 'DUPLICATE' ? 'DUPLICATE' : 'CONCURRENT_RESPONSE',
        cycle.id,
        cycle.field,
      );
    }

    try {
      const token = this.responseToken(message.id);
      if (confirmation.disposition === 'DEFERRED') {
        await this.cycleService.complete({
          userId: cycle.userId,
          cycleId: cycle.id,
          outcome: 'DEFERRED',
          resultCode: 'DEFERRED:' + token,
          referenceDate: message.timestamp.toISOString(),
        });
        return this.captureResult(
          true,
          false,
          false,
          'ANSWER_DEFERRED',
          cycle.id,
          cycle.field,
        );
      }
      const mutation = await this.mutationService.resolvePendingConfirmation({
        userId: cycle.userId,
        field: cycle.field,
        action: confirmation.disposition === 'CONFIRMED' ? 'CONFIRM' : 'REJECT',
        referenceDate: message.timestamp.toISOString(),
        sourceOperationKey: message.id,
      });
      if (mutation.status === 'CONFLICT' || mutation.status === 'REJECTED') {
        await this.cycleService.releaseResponseClaim({
          userId: cycle.userId,
          cycleId: cycle.id,
          claimCode: claim.claimCode,
        });
        await this.audit(cycle.userId, cycle.id, {
          event: 'CONFIRMATION_CONFLICT',
          field: cycle.field,
          reason: mutation.reasonCode,
        });
        return this.captureResult(
          true,
          false,
          false,
          mutation.status === 'CONFLICT' ? 'CONFLICT' : 'ANSWER_INVALID',
          cycle.id,
          cycle.field,
        );
      }
      const confirmed = confirmation.disposition === 'CONFIRMED';
      await this.cycleService.complete({
        userId: cycle.userId,
        cycleId: cycle.id,
        outcome: confirmed ? 'CONFIRMED' : 'CANCELLED',
        resultCode: (confirmed ? 'CONFIRMED:' : 'REJECTED:') + token,
        referenceDate: message.timestamp.toISOString(),
      });
      await this.audit(cycle.userId, cycle.id, {
        event: confirmed ? 'CONFIRMATION_COMPLETED' : 'CONFIRMATION_REJECTED',
        field: cycle.field,
        responseMilliseconds: this.responseMilliseconds(cycle, message),
      });
      await this.refreshRuntime(cycle.userId, message.timestamp);
      return this.captureResult(
        true,
        false,
        confirmed,
        confirmed ? 'CONFIRMATION_COMPLETED' : 'CONFIRMATION_REJECTED',
        cycle.id,
        cycle.field,
        confirmed && cycle.origin.startsWith(`${WORKOUT_V2_ORIGIN}:`)
          ? message.id
          : undefined,
        this.workoutOriginalRequest(cycle.origin),
      );
    } catch (error: unknown) {
      await this.cycleService.releaseResponseClaim({
        userId: cycle.userId,
        cycleId: cycle.id,
        claimCode: claim.claimCode,
      });
      throw error;
    }
  }

  private async publishConfirmation(
    cycle: NonNullable<ActiveCycle>,
    message: {
      readonly id: string;
      readonly conversationId: string;
    },
    specification: ProfileQuestionSpecification,
    answer: RecognizedProfileAnswer,
  ): Promise<void> {
    if (answer.value === undefined) return;
    const question = this.questionRealizer.realizeConfirmation(
      specification,
      answer.value,
    );
    await this.publishQuestion({
      userId: cycle.userId,
      conversationId: message.conversationId,
      sourceMessageId: message.id,
      content: question.text,
    });
  }

  private async publishQuestion(input: {
    readonly userId: string;
    readonly conversationId: string;
    readonly sourceMessageId: string;
    readonly content: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.outboundMessage.findUnique({
        where: {
          sourceMessageId_responseType: {
            sourceMessageId: input.sourceMessageId,
            responseType: ResponseType.PROFILE_ACQUISITION,
          },
        },
      });
      if (
        existing &&
        (existing.userId !== input.userId ||
          existing.conversationId !== input.conversationId ||
          existing.content !== input.content)
      ) {
        throw new Error(
          'Outbound idempotente de aquisição possui conteúdo divergente',
        );
      }
      const outbound =
        existing ??
        (await transaction.outboundMessage.create({
          data: {
            userId: input.userId,
            conversationId: input.conversationId,
            sourceMessageId: input.sourceMessageId,
            responseType: ResponseType.PROFILE_ACQUISITION,
            content: input.content,
          },
        }));
      await this.eventBus.publish(
        {
          eventType: INTERNAL_EVENT.OUTBOUND_MESSAGE_REQUESTED,
          aggregateType: 'OUTBOUND_MESSAGE',
          aggregateId: outbound.id,
          payload: {
            outboundMessageId: outbound.id,
            userId: outbound.userId,
            conversationId: outbound.conversationId,
            sourceMessageId: outbound.sourceMessageId,
            responseType: outbound.responseType,
          },
        },
        transaction,
      );
    });
  }

  private findActiveCycle(userId: string) {
    return this.prisma.coachProfileAcquisitionCycle.findFirst({
      where: { userId, active: true },
      orderBy: [{ referenceDate: 'desc' }, { id: 'desc' }],
    });
  }

  private async refreshRuntime(
    userId: string,
    referenceDate: Date,
  ): Promise<void> {
    try {
      await this.runtime.evaluate(userId, referenceDate);
    } catch {
      await this.audit(userId, null, {
        event: 'SNAPSHOT_REFRESH_FAILED',
      });
    }
  }

  private async audit(
    userId: string,
    cycleId: string | null,
    metadata: Readonly<Record<string, string | number | null>>,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'PROFILE_ACQUISITION_INTERNAL_ROLLOUT',
        entityType: 'COACH_PROFILE_ACQUISITION_CYCLE',
        entityId: cycleId ?? userId,
        metadata: {
          ...metadata,
          mode: PROFILE_ACQUISITION_MODE.INTERNAL,
        },
      },
    });
  }

  private responseMilliseconds(
    cycle: NonNullable<ActiveCycle>,
    message: { readonly timestamp: Date },
  ): number | null {
    return cycle.askedAt
      ? Math.max(0, message.timestamp.getTime() - cycle.askedAt.getTime())
      : null;
  }

  private responseToken(messageId: string): string {
    return createHash('sha256').update(messageId.trim()).digest('hex');
  }

  private operationKey(parts: readonly string[]): string {
    return (
      'profile-acquisition-cycle:' +
      createHash('sha256').update(parts.join(':')).digest('hex')
    );
  }

  private profileIntent(
    intent: 'DIET' | 'WORKOUT' | 'BOTH' | 'UNKNOWN',
  ): ProfileAcquisitionIntent | null {
    switch (intent) {
      case 'DIET':
        return PROFILE_ACQUISITION_INTENT.DIET_PLAN_REQUEST;
      case 'WORKOUT':
        return PROFILE_ACQUISITION_INTENT.WORKOUT_PLAN_REQUEST;
      case 'BOTH':
        return PROFILE_ACQUISITION_INTENT.COMBINED_PLAN_REQUEST;
      default:
        return null;
    }
  }

  private runtimeReason(
    reason:
      | 'NO_ELIGIBLE_FIELD'
      | 'PLANNER_DID_NOT_REQUEST_ACQUISITION'
      | 'QUESTION_MAPPING_UNAVAILABLE'
      | 'READY',
  ): ProfileAcquisitionRolloutReason {
    return reason === 'READY' ? 'QUESTION_PREPARED' : reason;
  }

  private rolloutResult(
    executed: boolean,
    questionCreated: boolean,
    reason: ProfileAcquisitionRolloutReason,
    mode: ProfileAcquisitionMode,
    cycleId: string | null = null,
    field: ProfileAcquisitionRolloutResult['field'] = null,
  ): ProfileAcquisitionRolloutResult {
    return Object.freeze({
      executed,
      questionCreated,
      reason,
      mode,
      cycleId,
      field,
    });
  }

  private captureResult(
    handled: boolean,
    duplicated: boolean,
    persisted: boolean,
    reason: ProfileAcquisitionRolloutReason,
    cycleId: string | null = null,
    field: ProfileAcquisitionCaptureResult['field'] = null,
    continuationMessageId?: string,
    originalRequestMessageId?: string,
  ): ProfileAcquisitionCaptureResult {
    return Object.freeze({
      handled,
      duplicated,
      persisted,
      reason,
      cycleId,
      field,
      continuationMessageId,
      originalRequestMessageId,
    });
  }

  private workoutOriginalRequest(origin: string): string | undefined {
    const prefix = `${WORKOUT_V2_ORIGIN}:`;
    return origin.startsWith(prefix) ? origin.slice(prefix.length) : undefined;
  }
}
