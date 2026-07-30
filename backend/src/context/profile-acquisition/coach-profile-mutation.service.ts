import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import {
  CoachProfileAcquisitionField,
  CoachProfileConfirmationState,
  CoachProfileValueSource,
  CoachProfileValueStatus,
  CoachProfileValueType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CoachProfileFieldRegistryService } from './coach-profile-field-registry.service';
import { ProfileAcquisitionOperationalConfigService } from './profile-acquisition-operational-config.service';
import {
  CoachProfileMutationCommand,
  PROFILE_ACQUISITION_MODE,
  ProfilePendingConfirmationCommand,
  ProfileMutationReason,
  ProfileMutationResult,
  RecognizedProfileAnswer,
  RecognizedProfileValue,
} from './profile-acquisition.contract';

export interface ProfileMutationCommandFactoryInput {
  readonly userId: string;
  readonly answer: RecognizedProfileAnswer;
  readonly source: CoachProfileValueSource;
  readonly referenceDate: string;
  readonly sourceOperationKey: string;
  readonly reason: ProfileMutationReason;
}

interface SerializedValue {
  readonly textValue: string | null;
  readonly integerValue: number | null;
  readonly booleanValue: boolean | null;
  readonly textListValue: Prisma.InputJsonValue | typeof Prisma.DbNull;
  readonly fingerprint: string | null;
}

const EMPTY_SERIALIZED: SerializedValue = Object.freeze({
  textValue: null,
  integerValue: null,
  booleanValue: null,
  textListValue: Prisma.DbNull,
  fingerprint: null,
});

@Injectable()
export class CoachProfileMutationCommandFactoryService {
  constructor(private readonly registry: CoachProfileFieldRegistryService) {}

  create(
    input: ProfileMutationCommandFactoryInput,
  ): CoachProfileMutationCommand | null {
    const definition = this.registry.get(input.answer.field);
    const referenceDate = new Date(input.referenceDate);
    if (Number.isNaN(referenceDate.getTime())) return null;

    if (input.answer.disposition === 'DECLINED') {
      return this.noValue(input, CoachProfileValueStatus.DECLINED);
    }
    if (
      input.answer.disposition === 'DEFERRED' ||
      input.answer.disposition === 'UNKNOWN'
    ) {
      return this.noValue(input, CoachProfileValueStatus.DEFERRED);
    }
    if (
      input.answer.disposition !== 'RECOGNIZED' ||
      input.answer.value === undefined
    ) {
      return null;
    }

    const confirmation = input.answer.confirmationRequired
      ? CoachProfileConfirmationState.PENDING
      : CoachProfileConfirmationState.CONFIRMED;
    return Object.freeze({
      action: 'SET',
      userId: input.userId,
      field: input.answer.field,
      value: this.freezeValue(input.answer.value),
      source: input.source,
      confirmation,
      status: input.answer.confirmationRequired
        ? CoachProfileValueStatus.ANSWERED_UNCONFIRMED
        : CoachProfileValueStatus.CONFIRMED,
      referenceDate: referenceDate.toISOString(),
      operationKey: this.operationKey(
        input,
        this.fingerprint(input.answer.value),
        definition.definitionVersion,
      ),
      reason: input.reason,
      definitionVersion: definition.definitionVersion,
    });
  }

  private noValue(
    input: ProfileMutationCommandFactoryInput,
    status:
      | typeof CoachProfileValueStatus.DECLINED
      | typeof CoachProfileValueStatus.DEFERRED,
  ): CoachProfileMutationCommand {
    const definition = this.registry.get(input.answer.field);
    return Object.freeze({
      action: 'NO_VALUE',
      userId: input.userId,
      field: input.answer.field,
      source: input.source,
      confirmation: CoachProfileConfirmationState.NOT_REQUIRED,
      status,
      referenceDate: new Date(input.referenceDate).toISOString(),
      operationKey: this.operationKey(
        input,
        status,
        definition.definitionVersion,
      ),
      reason: input.reason,
      definitionVersion: definition.definitionVersion,
    });
  }

  private operationKey(
    input: ProfileMutationCommandFactoryInput,
    valueFingerprint: string,
    definitionVersion: number,
  ): string {
    const digest = createHash('sha256')
      .update(
        [
          input.userId,
          input.answer.field,
          input.sourceOperationKey,
          valueFingerprint,
          String(definitionVersion),
        ].join(':'),
      )
      .digest('hex');
    return 'profile-acquisition:' + digest;
  }

  private fingerprint(value: RecognizedProfileValue): string {
    const normalized = Array.isArray(value) ? [...value].sort() : value;
    return createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex');
  }

  private freezeValue(value: RecognizedProfileValue): RecognizedProfileValue {
    return Array.isArray(value) ? Object.freeze([...value]) : value;
  }
}

@Injectable()
export class CoachProfileMutationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CoachProfileFieldRegistryService,
    private readonly operationalConfig: ProfileAcquisitionOperationalConfigService,
  ) {}

  async execute(
    command: CoachProfileMutationCommand,
  ): Promise<ProfileMutationResult> {
    if (
      this.operationalConfig.get().mode !== PROFILE_ACQUISITION_MODE.INTERNAL
    ) {
      return this.result(
        'REJECTED',
        command.field,
        null,
        null,
        'ACQUISITION_DISABLED',
      );
    }
    const definition = this.registry.get(command.field);
    const referenceDate = new Date(command.referenceDate);
    if (
      Number.isNaN(referenceDate.getTime()) ||
      command.definitionVersion !== definition.definitionVersion ||
      !command.userId.trim() ||
      !command.operationKey.trim()
    ) {
      return this.result(
        'REJECTED',
        command.field,
        null,
        null,
        'INVALID_COMMAND',
      );
    }
    const serialized =
      command.action === 'SET'
        ? this.serialize(
            command.value,
            definition.valueType,
            definition.allowedOptions,
            definition.minimum,
            definition.maximum,
          )
        : EMPTY_SERIALIZED;
    if (!serialized) {
      return this.result(
        'REJECTED',
        command.field,
        null,
        null,
        'UNSUPPORTED_FIELD_VALUE',
      );
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const lockKey =
          'profile-acquisition:' + command.userId + ':' + command.field;
        await transaction.$queryRaw`
          SELECT pg_advisory_xact_lock(hashtext(${lockKey}))
        `;
        const duplicate = await transaction.coachProfileFieldValue.findUnique({
          where: { operationKey: command.operationKey },
        });
        if (duplicate) {
          return this.result(
            'DUPLICATE',
            command.field,
            duplicate.id,
            duplicate.valueFingerprint,
            'DUPLICATE_OPERATION',
          );
        }
        const current = await transaction.coachProfileFieldValue.findFirst({
          where: {
            userId: command.userId,
            field: command.field,
            isActive: true,
          },
          orderBy: [{ referenceDate: 'desc' }, { id: 'desc' }],
        });
        const staleReference =
          command.previousValueFingerprint !== undefined &&
          current?.valueFingerprint !== command.previousValueFingerprint;
        if (staleReference) {
          const created = await transaction.coachProfileFieldValue.create({
            data: this.createData(
              command,
              serialized,
              command.action === 'SET'
                ? CoachProfileValueStatus.CONFLICTED
                : command.status,
              false,
              current?.id,
              referenceDate,
            ),
          });
          await this.audit(
            transaction,
            command,
            created.id,
            'STALE_PREVIOUS_VALUE',
          );
          return this.result(
            'CONFLICT',
            command.field,
            created.id,
            current?.valueFingerprint ?? null,
            'STALE_PREVIOUS_VALUE',
          );
        }
        const conflict =
          command.action === 'SET' &&
          current?.status === CoachProfileValueStatus.CONFIRMED &&
          current.valueFingerprint !== serialized.fingerprint &&
          command.confirmation !== CoachProfileConfirmationState.CONFIRMED;

        if (conflict) {
          const created = await transaction.coachProfileFieldValue.create({
            data: this.createData(
              command,
              serialized,
              CoachProfileValueStatus.CONFLICTED,
              false,
              current.id,
              referenceDate,
            ),
          });
          await this.audit(transaction, command, created.id, 'VALUE_CONFLICT');
          return this.result(
            'CONFLICT',
            command.field,
            created.id,
            current.valueFingerprint,
            'VALUE_CONFLICT',
          );
        }

        if (
          command.action === 'SET' &&
          current?.valueFingerprint === serialized.fingerprint &&
          current.status === command.status
        ) {
          const operation = await transaction.coachProfileFieldValue.create({
            data: this.createData(
              command,
              serialized,
              command.status,
              false,
              current.id,
              referenceDate,
            ),
          });
          await this.audit(
            transaction,
            command,
            operation.id,
            'VALUE_UNCHANGED',
          );
          return this.result(
            'UNCHANGED',
            command.field,
            current.id,
            current.valueFingerprint,
            'VALUE_UNCHANGED',
          );
        }

        const replacesCurrent =
          !current ||
          command.action === 'SET' ||
          command.status === CoachProfileValueStatus.INVALIDATED ||
          command.status === CoachProfileValueStatus.NOT_APPLICABLE;
        if (current && replacesCurrent) {
          await transaction.coachProfileFieldValue.update({
            where: { id: current.id },
            data: { isActive: false, invalidatedAt: referenceDate },
          });
          if (command.status === CoachProfileValueStatus.CONFIRMED) {
            await transaction.coachProfileFieldValue.updateMany({
              where: {
                userId: command.userId,
                field: command.field,
                status: CoachProfileValueStatus.CONFLICTED,
                isActive: false,
              },
              data: {
                status: CoachProfileValueStatus.INVALIDATED,
                invalidatedAt: referenceDate,
              },
            });
          }
        }
        const created = await transaction.coachProfileFieldValue.create({
          data: this.createData(
            command,
            serialized,
            command.status,
            replacesCurrent,
            current?.id,
            referenceDate,
          ),
        });
        await this.updateCanonicalPreferences(transaction, command, serialized);
        await this.audit(transaction, command, created.id, 'MUTATION_APPLIED');
        const requiresConfirmation =
          command.status === CoachProfileValueStatus.ANSWERED_UNCONFIRMED;
        return this.result(
          requiresConfirmation
            ? 'REQUIRES_CONFIRMATION'
            : current && replacesCurrent
              ? 'UPDATED'
              : 'CREATED',
          command.field,
          created.id,
          created.valueFingerprint,
          requiresConfirmation ? 'CONFIRMATION_REQUIRED' : 'MUTATION_APPLIED',
        );
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return this.result(
          'DUPLICATE',
          command.field,
          null,
          null,
          'DUPLICATE_OPERATION',
        );
      }
      throw error;
    }
  }

  async resolvePendingConfirmation(
    input: ProfilePendingConfirmationCommand,
  ): Promise<ProfileMutationResult> {
    if (
      this.operationalConfig.get().mode !== PROFILE_ACQUISITION_MODE.INTERNAL
    ) {
      return this.result(
        'REJECTED',
        input.field,
        null,
        null,
        'ACQUISITION_DISABLED',
      );
    }
    const referenceDate = new Date(input.referenceDate);
    if (
      Number.isNaN(referenceDate.getTime()) ||
      !input.userId.trim() ||
      !input.sourceOperationKey.trim()
    ) {
      return this.result(
        'REJECTED',
        input.field,
        null,
        null,
        'INVALID_CONFIRMATION_COMMAND',
      );
    }
    const current = await this.prisma.coachProfileFieldValue.findFirst({
      where: {
        userId: input.userId,
        field: input.field,
        isActive: true,
        status: CoachProfileValueStatus.ANSWERED_UNCONFIRMED,
      },
      orderBy: [{ referenceDate: 'desc' }, { id: 'desc' }],
    });
    if (!current || !current.valueFingerprint) {
      return this.result(
        'REJECTED',
        input.field,
        null,
        null,
        'PENDING_CONFIRMATION_NOT_FOUND',
      );
    }
    const definition = this.registry.get(input.field);
    const operationKey = this.pendingConfirmationOperationKey(
      input,
      current.valueFingerprint,
      definition.definitionVersion,
    );
    if (input.action === 'REJECT') {
      const command: CoachProfileMutationCommand = Object.freeze({
        action: 'NO_VALUE',
        userId: input.userId,
        field: input.field,
        source: CoachProfileValueSource.USER_CONFIRMED,
        confirmation: CoachProfileConfirmationState.CONFIRMED,
        status: CoachProfileValueStatus.INVALIDATED,
        referenceDate: referenceDate.toISOString(),
        operationKey,
        previousValueFingerprint: current.valueFingerprint,
        reason: 'INVALIDATION',
        definitionVersion: definition.definitionVersion,
      });
      return this.execute(command);
    }
    const value = this.storedValue(current);
    if (value === undefined) {
      return this.result(
        'REJECTED',
        input.field,
        current.id,
        current.valueFingerprint,
        'PENDING_VALUE_INVALID',
      );
    }
    const command: CoachProfileMutationCommand = Object.freeze({
      action: 'SET',
      userId: input.userId,
      field: input.field,
      value,
      source: CoachProfileValueSource.USER_CONFIRMED,
      confirmation: CoachProfileConfirmationState.CONFIRMED,
      status: CoachProfileValueStatus.CONFIRMED,
      referenceDate: referenceDate.toISOString(),
      operationKey,
      previousValueFingerprint: current.valueFingerprint,
      reason: 'CONFIRMATION',
      definitionVersion: definition.definitionVersion,
    });
    return this.execute(command);
  }

  private createData(
    command: CoachProfileMutationCommand,
    serialized: SerializedValue,
    status: CoachProfileValueStatus,
    isActive: boolean,
    previousValueId: string | undefined,
    referenceDate: Date,
  ): Prisma.CoachProfileFieldValueUncheckedCreateInput {
    return {
      userId: command.userId,
      field: command.field,
      valueType: this.registry.get(command.field).valueType,
      textValue: serialized.textValue,
      integerValue: serialized.integerValue,
      booleanValue: serialized.booleanValue,
      textListValue: serialized.textListValue,
      valueFingerprint: serialized.fingerprint,
      status,
      source: command.source,
      confirmationState: command.confirmation,
      definitionVersion: command.definitionVersion,
      referenceDate,
      operationKey: command.operationKey,
      previousValueId,
      isActive,
      confirmedAt:
        command.confirmation === CoachProfileConfirmationState.CONFIRMED
          ? referenceDate
          : null,
      invalidatedAt:
        status === CoachProfileValueStatus.INVALIDATED ? referenceDate : null,
    };
  }

  private storedValue(record: {
    valueType: CoachProfileValueType;
    textValue: string | null;
    integerValue: number | null;
    booleanValue: boolean | null;
    textListValue: Prisma.JsonValue;
  }): RecognizedProfileValue | undefined {
    if (
      record.valueType === CoachProfileValueType.TEXT &&
      record.textValue !== null
    ) {
      return record.textValue;
    }
    if (
      record.valueType === CoachProfileValueType.INTEGER &&
      record.integerValue !== null
    ) {
      return record.integerValue;
    }
    if (
      record.valueType === CoachProfileValueType.BOOLEAN &&
      record.booleanValue !== null
    ) {
      return record.booleanValue;
    }
    if (
      record.valueType === CoachProfileValueType.TEXT_LIST &&
      Array.isArray(record.textListValue) &&
      record.textListValue.every((value) => typeof value === 'string')
    ) {
      return Object.freeze([...record.textListValue]);
    }
    return undefined;
  }

  private pendingConfirmationOperationKey(
    input: ProfilePendingConfirmationCommand,
    valueFingerprint: string,
    definitionVersion: number,
  ): string {
    return (
      'profile-acquisition:' +
      createHash('sha256')
        .update(
          [
            input.userId,
            input.field,
            input.action,
            input.sourceOperationKey,
            valueFingerprint,
            String(definitionVersion),
          ].join(':'),
        )
        .digest('hex')
    );
  }

  private serialize(
    value: RecognizedProfileValue,
    valueType: CoachProfileValueType,
    options: readonly string[],
    minimum?: number,
    maximum?: number,
  ): SerializedValue | null {
    if (valueType === CoachProfileValueType.TEXT && typeof value === 'string') {
      const normalized = value.trim();
      if (
        !normalized ||
        (options.length > 0 && !options.includes(normalized))
      ) {
        return null;
      }
      return this.serialized(normalized, null, null, Prisma.DbNull);
    }
    if (
      valueType === CoachProfileValueType.INTEGER &&
      typeof value === 'number' &&
      Number.isInteger(value) &&
      (minimum === undefined || value >= minimum) &&
      (maximum === undefined || value <= maximum)
    ) {
      return this.serialized(null, value, null, Prisma.DbNull);
    }
    if (
      valueType === CoachProfileValueType.BOOLEAN &&
      typeof value === 'boolean'
    ) {
      return this.serialized(null, null, value, Prisma.DbNull);
    }
    if (
      valueType === CoachProfileValueType.TEXT_LIST &&
      Array.isArray(value) &&
      value.every(
        (item) =>
          typeof item === 'string' &&
          item.trim().length > 0 &&
          (options.length === 0 || options.includes(item)),
      )
    ) {
      const normalized = [...new Set(value.map((item) => item.trim()))].sort();
      return this.serialized(null, null, null, normalized);
    }
    return null;
  }

  private serialized(
    textValue: string | null,
    integerValue: number | null,
    booleanValue: boolean | null,
    textListValue: Prisma.InputJsonValue | typeof Prisma.DbNull,
  ): SerializedValue {
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          textValue,
          integerValue,
          booleanValue,
          textListValue: textListValue === Prisma.DbNull ? null : textListValue,
        }),
      )
      .digest('hex');
    return Object.freeze({
      textValue,
      integerValue,
      booleanValue,
      textListValue,
      fingerprint,
    });
  }

  private async updateCanonicalPreferences(
    transaction: Prisma.TransactionClient,
    command: CoachProfileMutationCommand,
    serialized: SerializedValue,
  ): Promise<void> {
    if (
      command.action !== 'SET' ||
      command.status !== CoachProfileValueStatus.CONFIRMED
    ) {
      return;
    }
    if (
      command.field === CoachProfileAcquisitionField.TRAINING_TIME &&
      serialized.textValue
    ) {
      await transaction.userPreferences.upsert({
        where: { userId: command.userId },
        update: { preferredTrainingTime: serialized.textValue },
        create: {
          userId: command.userId,
          preferredTrainingTime: serialized.textValue,
        },
      });
    }
    if (
      command.field === CoachProfileAcquisitionField.MEAL_TIMES &&
      Array.isArray(serialized.textListValue)
    ) {
      const mealTimes = [...serialized.textListValue];
      await transaction.userPreferences.upsert({
        where: { userId: command.userId },
        update: { preferredMealTimes: mealTimes },
        create: {
          userId: command.userId,
          preferredMealTimes: mealTimes,
        },
      });
    }
  }

  private async audit(
    transaction: Prisma.TransactionClient,
    command: CoachProfileMutationCommand,
    entityId: string,
    result: string,
  ): Promise<void> {
    await transaction.auditLog.create({
      data: {
        userId: command.userId,
        action: 'COACH_PROFILE_FIELD_MUTATION',
        entityType: 'COACH_PROFILE_FIELD_VALUE',
        entityId,
        metadata: {
          field: command.field,
          status: command.status,
          source: command.source,
          confirmation: command.confirmation,
          definitionVersion: command.definitionVersion,
          result,
          reason: command.reason,
          operation: createHash('sha256')
            .update(command.operationKey)
            .digest('hex'),
        },
      },
    });
  }

  private result(
    status: ProfileMutationResult['status'],
    field: CoachProfileAcquisitionField,
    valueId: string | null,
    activeValueFingerprint: string | null,
    reasonCode: string,
  ): ProfileMutationResult {
    return Object.freeze({
      status,
      field,
      valueId,
      activeValueFingerprint,
      reasonCode,
    });
  }
}
