import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PilotCohortStatus,
  PilotParticipantStatus,
  Prisma,
  Severity,
} from '@prisma/client';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { AddPilotParticipantsDto } from './dto/add-pilot-participants.dto';
import { CreatePilotCohortDto } from './dto/create-pilot-cohort.dto';
import { ListPilotCohortsDto } from './dto/list-pilot-cohorts.dto';
import { RecordPilotCheckDto } from './dto/record-pilot-check.dto';
import { PILOT_EVENT, PILOT_SOURCE } from './pilot.constants';

@Injectable()
export class PilotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventService,
  ) {}

  async create(input: CreatePilotCohortDto) {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);

    if (endsAt <= startsAt) {
      throw new BadRequestException(
        'O término da coorte deve ser posterior ao início',
      );
    }

    if (
      input.status === PilotCohortStatus.COMPLETED ||
      input.status === PilotCohortStatus.CANCELED
    ) {
      throw new BadRequestException('Status inicial da coorte inválido');
    }

    return this.prisma.$transaction(async (transaction) => {
      const cohort = await transaction.pilotCohort.create({
        data: {
          name: input.name.trim(),
          description: input.description.trim(),
          status: input.status,
          startsAt,
          endsAt,
        },
      });
      await this.events.recordInTransaction(transaction, {
        source: PILOT_SOURCE,
        severity: Severity.INFO,
        eventType: PILOT_EVENT.COHORT_CREATED,
        message: 'Coorte piloto criada',
        metadata: {
          cohortId: cohort.id,
          status: cohort.status,
          startsAt: cohort.startsAt.toISOString(),
          endsAt: cohort.endsAt.toISOString(),
        },
      });

      return cohort;
    });
  }

  async list(query: ListPilotCohortsDto) {
    const records = await this.prisma.pilotCohort.findMany({
      where: { status: query.status },
      include: {
        _count: {
          select: { participants: true, manualChecks: true },
        },
      },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : undefined,
      take: query.limit + 1,
    });
    const hasMore = records.length > query.limit;
    const items = hasMore ? records.slice(0, query.limit) : records;

    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async get(id: string) {
    const cohort = await this.prisma.pilotCohort.findUnique({
      where: { id },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phoneE164: true,
                createdAt: true,
              },
            },
          },
          orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
        },
        manualChecks: {
          orderBy: [{ checkType: 'asc' }, { checkedAt: 'desc' }],
        },
      },
    });

    if (!cohort) {
      throw new NotFoundException('Coorte piloto não encontrada');
    }

    return cohort;
  }

  async addParticipants(id: string, input: AddPilotParticipantsDto) {
    const userIds = [...new Set(input.userIds)];

    return this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, id);
      const cohort = await transaction.pilotCohort.findUnique({
        where: { id },
      });

      if (!cohort) {
        throw new NotFoundException('Coorte piloto não encontrada');
      }

      if (
        cohort.status === PilotCohortStatus.COMPLETED ||
        cohort.status === PilotCohortStatus.CANCELED
      ) {
        throw new ConflictException(
          'Não é possível adicionar participantes à coorte encerrada',
        );
      }

      const users = await transaction.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true },
      });
      const existingIds = new Set(users.map((user) => user.id));
      const missing = userIds.filter((userId) => !existingIds.has(userId));

      if (missing.length > 0) {
        throw new BadRequestException(
          `Usuários não encontrados: ${missing.join(', ')}`,
        );
      }

      const existingParticipants = await transaction.pilotParticipant.findMany({
        where: { cohortId: id, userId: { in: userIds } },
        select: { userId: true },
      });
      const existingParticipantIds = new Set(
        existingParticipants.map((participant) => participant.userId),
      );
      await transaction.pilotParticipant.createMany({
        data: userIds.map((userId) => ({
          cohortId: id,
          userId,
          status:
            cohort.status === PilotCohortStatus.ACTIVE
              ? PilotParticipantStatus.ACTIVE
              : PilotParticipantStatus.INVITED,
          notes: input.notes?.trim() || null,
        })),
        skipDuplicates: true,
      });
      const participants = await transaction.pilotParticipant.findMany({
        where: { cohortId: id, userId: { in: userIds } },
        orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      });

      for (const participant of participants.filter(
        (candidate) => !existingParticipantIds.has(candidate.userId),
      )) {
        await this.events.recordInTransaction(transaction, {
          source: PILOT_SOURCE,
          severity: Severity.INFO,
          eventType: PILOT_EVENT.PARTICIPANT_ADDED,
          message: 'Participante adicionado à coorte piloto',
          metadata: {
            cohortId: id,
            participantId: participant.id,
            userId: participant.userId,
          },
        });
      }

      return participants;
    });
  }

  async recordManualCheck(
    cohortId: string,
    checkedByUserId: string,
    input: RecordPilotCheckDto,
    checkedAt = new Date(),
  ) {
    return this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, cohortId);
      const cohort = await transaction.pilotCohort.findUnique({
        where: { id: cohortId },
        select: { id: true },
      });

      if (!cohort) {
        throw new NotFoundException('Coorte piloto não encontrada');
      }

      return transaction.pilotManualCheck.upsert({
        where: {
          cohortId_checkType: {
            cohortId,
            checkType: input.checkType,
          },
        },
        update: {
          status: input.status,
          notes: input.notes?.trim() || null,
          checkedAt,
          checkedByUserId,
        },
        create: {
          cohortId,
          checkType: input.checkType,
          status: input.status,
          notes: input.notes?.trim() || null,
          checkedAt,
          checkedByUserId,
        },
      });
    });
  }

  async complete(id: string, completedAt = new Date()) {
    return this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, id);
      const cohort = await transaction.pilotCohort.findUnique({
        where: { id },
      });

      if (!cohort) {
        throw new NotFoundException('Coorte piloto não encontrada');
      }

      if (cohort.status === PilotCohortStatus.CANCELED) {
        throw new ConflictException('Coorte piloto cancelada');
      }

      if (cohort.status === PilotCohortStatus.COMPLETED) {
        return cohort;
      }

      await transaction.pilotParticipant.updateMany({
        where: {
          cohortId: id,
          status: { not: PilotParticipantStatus.DROPPED },
        },
        data: {
          status: PilotParticipantStatus.COMPLETED,
          completedAt,
        },
      });
      const completed = await transaction.pilotCohort.update({
        where: { id },
        data: { status: PilotCohortStatus.COMPLETED },
      });
      await this.events.recordInTransaction(transaction, {
        source: PILOT_SOURCE,
        severity: Severity.INFO,
        eventType: PILOT_EVENT.COHORT_COMPLETED,
        message: 'Coorte piloto concluída',
        metadata: {
          cohortId: id,
          completedAt: completedAt.toISOString(),
        },
      });

      return completed;
    });
  }

  private lock(transaction: Prisma.TransactionClient, cohortId: string) {
    return transaction.$queryRaw`
      WITH advisory_lock AS (
        SELECT pg_advisory_xact_lock(hashtext(${`pilot:${cohortId}`}))
      )
      SELECT true AS "locked"
      FROM advisory_lock
    `;
  }
}
