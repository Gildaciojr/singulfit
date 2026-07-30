import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  CoachProfileAcquisitionCycleStatus,
  CoachProfileConfirmationState,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PROFILE_ACQUISITION_MODE,
  ProfileAcquisitionCycleCommand,
  ProfileAcquisitionCycleAskedCommand,
  ProfileAcquisitionCycleAskedResult,
  ProfileAcquisitionCycleCompletionCommand,
  ProfileAcquisitionCycleCompletionResult,
  ProfileAcquisitionCycleResult,
  ProfileAcquisitionResponseClaimCommand,
  ProfileAcquisitionResponseClaimReleaseCommand,
  ProfileAcquisitionResponseClaimResult,
} from './profile-acquisition.contract';
import { ProfileAcquisitionOperationalConfigService } from './profile-acquisition-operational-config.service';

@Injectable()
export class ProfileAcquisitionCycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationalConfig: ProfileAcquisitionOperationalConfigService,
  ) {}

  async prepare(
    command: ProfileAcquisitionCycleCommand,
  ): Promise<ProfileAcquisitionCycleResult> {
    if (
      this.operationalConfig.get().mode !== PROFILE_ACQUISITION_MODE.INTERNAL
    ) {
      return this.result('REJECTED', null, null, 'ACQUISITION_DISABLED');
    }
    const referenceDate = new Date(command.referenceDate);
    const expiresAt = new Date(command.expiresAt);
    if (
      Number.isNaN(referenceDate.getTime()) ||
      Number.isNaN(expiresAt.getTime()) ||
      expiresAt < referenceDate ||
      !Number.isInteger(command.logicalTurn) ||
      command.logicalTurn < 0
    ) {
      return this.result('REJECTED', null, null, 'INVALID_CYCLE_COMMAND');
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const lockKey = 'profile-acquisition-cycle:' + command.userId;
        await transaction.$queryRaw`
          SELECT pg_advisory_xact_lock(hashtext(${lockKey}))
        `;
        const duplicate =
          await transaction.coachProfileAcquisitionCycle.findUnique({
            where: { operationKey: command.operationKey },
          });
        if (duplicate) {
          return this.result(
            'DUPLICATE',
            duplicate.id,
            duplicate.status,
            'DUPLICATE_OPERATION',
          );
        }
        const active = await transaction.coachProfileAcquisitionCycle.findFirst(
          {
            where: { userId: command.userId, active: true },
            orderBy: [{ referenceDate: 'desc' }, { id: 'desc' }],
          },
        );
        let expiredPrevious = false;
        if (active && active.expiresAt <= referenceDate) {
          await transaction.coachProfileAcquisitionCycle.update({
            where: { id: active.id },
            data: {
              active: false,
              status: CoachProfileAcquisitionCycleStatus.EXPIRED,
              completedAt: referenceDate,
              resultCode: 'EXPIRED_WITHOUT_ANSWER',
            },
          });
          expiredPrevious = true;
        } else if (active) {
          return this.result(
            'QUESTION_ALREADY_ACTIVE',
            active.id,
            active.status,
            'QUESTION_ALREADY_ACTIVE',
          );
        }
        const cycle = await transaction.coachProfileAcquisitionCycle.create({
          data: {
            userId: command.userId,
            field: command.specification.field,
            status: CoachProfileAcquisitionCycleStatus.PENDING,
            questionKind: command.specification.questionKind,
            questionVersion: command.specification.version,
            logicalTurn: command.logicalTurn,
            origin: command.origin.slice(0, 100),
            operationKey: command.operationKey,
            active: true,
            confirmationState:
              command.specification.confirmationPolicy === 'EXPLICIT' ||
              command.specification.confirmationPolicy === 'ALWAYS_EXPLICIT'
                ? CoachProfileConfirmationState.PENDING
                : CoachProfileConfirmationState.NOT_REQUIRED,
            referenceDate,
            expiresAt,
            sourceMessageId: command.sourceMessageId,
          },
        });
        await transaction.auditLog.create({
          data: {
            userId: command.userId,
            action: 'PROFILE_ACQUISITION_CYCLE_PREPARED',
            entityType: 'COACH_PROFILE_ACQUISITION_CYCLE',
            entityId: cycle.id,
            metadata: {
              field: cycle.field,
              state: cycle.status,
              questionVersion: cycle.questionVersion,
              operation: createHash('sha256')
                .update(command.operationKey)
                .digest('hex'),
              result: expiredPrevious ? 'EXPIRED_PREVIOUS' : 'CREATED',
            },
          },
        });
        return this.result(
          expiredPrevious ? 'EXPIRED_PREVIOUS' : 'CREATED',
          cycle.id,
          cycle.status,
          expiredPrevious ? 'EXPIRED_PREVIOUS' : 'CYCLE_PREPARED',
        );
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return this.result('DUPLICATE', null, null, 'DUPLICATE_OPERATION');
      }
      throw error;
    }
  }

  async markAsked(
    command: ProfileAcquisitionCycleAskedCommand,
  ): Promise<ProfileAcquisitionCycleAskedResult> {
    if (
      this.operationalConfig.get().mode !== PROFILE_ACQUISITION_MODE.INTERNAL
    ) {
      return this.askedResult('REJECTED', command.cycleId, null);
    }
    const askedAt = new Date(command.askedAt);
    if (Number.isNaN(askedAt.getTime())) {
      return this.askedResult('REJECTED', command.cycleId, null);
    }

    return this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, command.userId);
      const cycle = await transaction.coachProfileAcquisitionCycle.findUnique({
        where: { id: command.cycleId },
      });
      if (!cycle || cycle.userId !== command.userId) {
        return this.askedResult('NOT_FOUND', command.cycleId, null);
      }
      if (cycle.askedAt) {
        return this.askedResult('ALREADY_MARKED', cycle.id, cycle.status);
      }
      if (!cycle.active || cycle.expiresAt <= askedAt) {
        if (cycle.active) {
          await transaction.coachProfileAcquisitionCycle.update({
            where: { id: cycle.id },
            data: {
              active: false,
              status: CoachProfileAcquisitionCycleStatus.EXPIRED,
              completedAt: askedAt,
              resultCode: 'EXPIRED_BEFORE_QUESTION_SENT',
            },
          });
        }
        return this.askedResult(
          'EXPIRED',
          cycle.id,
          CoachProfileAcquisitionCycleStatus.EXPIRED,
        );
      }
      const previous = await transaction.coachProfileAcquisitionCycle.findFirst(
        {
          where: {
            userId: command.userId,
            id: { not: cycle.id },
            askedAt: { not: null },
          },
          orderBy: [{ askedAt: 'desc' }, { id: 'desc' }],
          select: { askedAt: true },
        },
      );
      const millisecondsSincePreviousQuestion = previous?.askedAt
        ? Math.max(0, askedAt.getTime() - previous.askedAt.getTime())
        : null;
      const updated = await transaction.coachProfileAcquisitionCycle.update({
        where: { id: cycle.id },
        data: {
          status: CoachProfileAcquisitionCycleStatus.ASKED,
          askedAt,
        },
      });
      await transaction.auditLog.create({
        data: {
          userId: command.userId,
          action: 'PROFILE_ACQUISITION_QUESTION_SENT',
          entityType: 'COACH_PROFILE_ACQUISITION_CYCLE',
          entityId: cycle.id,
          metadata: {
            field: cycle.field,
            state: updated.status,
            millisecondsSincePreviousQuestion,
          },
        },
      });
      return this.askedResult('MARKED', cycle.id, updated.status);
    });
  }

  async claimResponse(
    command: ProfileAcquisitionResponseClaimCommand,
  ): Promise<ProfileAcquisitionResponseClaimResult> {
    if (
      this.operationalConfig.get().mode !== PROFILE_ACQUISITION_MODE.INTERNAL
    ) {
      return this.claimResult('REJECTED', command.cycleId, null);
    }
    const receivedAt = new Date(command.receivedAt);
    if (Number.isNaN(receivedAt.getTime()) || !command.messageId.trim()) {
      return this.claimResult('REJECTED', command.cycleId, null);
    }
    const token = this.responseToken(command.messageId);
    const claimCode = 'PROCESSING:' + token;

    return this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, command.userId);
      const cycle = await transaction.coachProfileAcquisitionCycle.findUnique({
        where: { id: command.cycleId },
      });
      if (!cycle || cycle.userId !== command.userId) {
        return this.claimResult('NOT_FOUND', command.cycleId, null);
      }
      if (
        cycle.resultCode?.endsWith(token) &&
        !cycle.resultCode.startsWith('PROCESSING:')
      ) {
        return this.claimResult('DUPLICATE', cycle.id, null);
      }
      if (!cycle.active || cycle.expiresAt <= receivedAt) {
        if (cycle.active) {
          await transaction.coachProfileAcquisitionCycle.update({
            where: { id: cycle.id },
            data: {
              active: false,
              status: CoachProfileAcquisitionCycleStatus.EXPIRED,
              completedAt: receivedAt,
              resultCode: 'EXPIRED_WITHOUT_VALID_ANSWER',
            },
          });
        }
        return this.claimResult('EXPIRED', cycle.id, null);
      }
      if (!cycle.askedAt || receivedAt < cycle.askedAt) {
        return this.claimResult('NOT_ASKED', cycle.id, null);
      }
      if (cycle.resultCode?.startsWith('PROCESSING:')) {
        return this.claimResult(
          cycle.resultCode === claimCode ? 'CLAIMED' : 'BUSY',
          cycle.id,
          cycle.resultCode === claimCode ? claimCode : null,
        );
      }
      await transaction.coachProfileAcquisitionCycle.update({
        where: { id: cycle.id },
        data: { resultCode: claimCode },
      });
      return this.claimResult('CLAIMED', cycle.id, claimCode);
    });
  }

  async releaseResponseClaim(
    command: ProfileAcquisitionResponseClaimReleaseCommand,
  ): Promise<void> {
    if (
      this.operationalConfig.get().mode !== PROFILE_ACQUISITION_MODE.INTERNAL
    ) {
      return;
    }
    await this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, command.userId);
      await transaction.coachProfileAcquisitionCycle.updateMany({
        where: {
          id: command.cycleId,
          userId: command.userId,
          active: true,
          resultCode: command.claimCode,
        },
        data: { resultCode: null },
      });
    });
  }

  async complete(
    command: ProfileAcquisitionCycleCompletionCommand,
  ): Promise<ProfileAcquisitionCycleCompletionResult> {
    if (
      this.operationalConfig.get().mode !== PROFILE_ACQUISITION_MODE.INTERNAL
    ) {
      return Object.freeze({
        status: 'REJECTED',
        cycleId: command.cycleId,
        cycleStatus: null,
      });
    }
    const referenceDate = new Date(command.referenceDate);
    const cooldownUntil = command.cooldownUntil
      ? new Date(command.cooldownUntil)
      : null;
    if (
      Number.isNaN(referenceDate.getTime()) ||
      (cooldownUntil !== null && Number.isNaN(cooldownUntil.getTime()))
    ) {
      return Object.freeze({
        status: 'REJECTED',
        cycleId: command.cycleId,
        cycleStatus: null,
      });
    }
    return this.prisma.$transaction(async (transaction) => {
      const lockKey = 'profile-acquisition-cycle:' + command.userId;
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtext(${lockKey}))
      `;
      const cycle = await transaction.coachProfileAcquisitionCycle.findUnique({
        where: { id: command.cycleId },
      });
      if (!cycle || cycle.userId !== command.userId) {
        return Object.freeze({
          status: 'NOT_FOUND',
          cycleId: command.cycleId,
          cycleStatus: null,
        });
      }
      if (!cycle.active) {
        return Object.freeze({
          status: 'ALREADY_CLOSED',
          cycleId: cycle.id,
          cycleStatus: cycle.status,
        });
      }
      const expired = cycle.expiresAt <= referenceDate;
      const confirmationPending =
        !expired &&
        command.outcome === 'ANSWERED' &&
        cycle.confirmationState === CoachProfileConfirmationState.PENDING;
      const status = expired
        ? CoachProfileAcquisitionCycleStatus.EXPIRED
        : confirmationPending
          ? CoachProfileAcquisitionCycleStatus.CONFIRMATION_PENDING
          : this.completedStatus(command.outcome);
      const active = confirmationPending;
      await transaction.coachProfileAcquisitionCycle.update({
        where: { id: cycle.id },
        data: {
          status,
          active,
          resultCode: command.resultCode.slice(0, 100),
          answeredAt:
            command.outcome === 'ANSWERED' || command.outcome === 'CONFIRMED'
              ? referenceDate
              : cycle.answeredAt,
          completedAt: active ? null : referenceDate,
          cooldownUntil,
          confirmationState:
            command.outcome === 'CONFIRMED'
              ? CoachProfileConfirmationState.CONFIRMED
              : cycle.confirmationState,
        },
      });
      await transaction.auditLog.create({
        data: {
          userId: command.userId,
          action: 'PROFILE_ACQUISITION_CYCLE_COMPLETED',
          entityType: 'COACH_PROFILE_ACQUISITION_CYCLE',
          entityId: cycle.id,
          metadata: {
            field: cycle.field,
            state: status,
            result: command.resultCode.slice(0, 100),
            confirmation: command.outcome === 'CONFIRMED',
          },
        },
      });
      return Object.freeze({
        status: expired
          ? 'EXPIRED'
          : confirmationPending
            ? 'CONFIRMATION_PENDING'
            : 'COMPLETED',
        cycleId: cycle.id,
        cycleStatus: status,
      });
    });
  }

  private completedStatus(
    outcome: ProfileAcquisitionCycleCompletionCommand['outcome'],
  ): CoachProfileAcquisitionCycleStatus {
    switch (outcome) {
      case 'ANSWERED':
        return CoachProfileAcquisitionCycleStatus.ANSWERED;
      case 'DECLINED':
        return CoachProfileAcquisitionCycleStatus.DECLINED;
      case 'DEFERRED':
        return CoachProfileAcquisitionCycleStatus.DEFERRED;
      case 'CANCELLED':
        return CoachProfileAcquisitionCycleStatus.CANCELLED;
      default:
        return CoachProfileAcquisitionCycleStatus.COMPLETED;
    }
  }

  private lock(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<unknown> {
    const lockKey = 'profile-acquisition-cycle:' + userId;
    return transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtext(${lockKey}))
    `;
  }

  private responseToken(messageId: string): string {
    return createHash('sha256').update(messageId.trim()).digest('hex');
  }

  private askedResult(
    status: ProfileAcquisitionCycleAskedResult['status'],
    cycleId: string,
    cycleStatus: CoachProfileAcquisitionCycleStatus | null,
  ): ProfileAcquisitionCycleAskedResult {
    return Object.freeze({ status, cycleId, cycleStatus });
  }

  private claimResult(
    status: ProfileAcquisitionResponseClaimResult['status'],
    cycleId: string,
    claimCode: string | null,
  ): ProfileAcquisitionResponseClaimResult {
    return Object.freeze({ status, cycleId, claimCode });
  }

  private result(
    status: ProfileAcquisitionCycleResult['status'],
    cycleId: string | null,
    cycleStatus: CoachProfileAcquisitionCycleStatus | null,
    reasonCode: string,
  ): ProfileAcquisitionCycleResult {
    return Object.freeze({ status, cycleId, cycleStatus, reasonCode });
  }
}
