import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SnapshotService } from '../progress/snapshot.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateMeasurementDto } from './dto/create-measurement.dto';
import { CreateProfileDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { OnboardingService } from './onboarding.service';

const PROFILE_INCLUDE = {
  foodRestrictions: {
    orderBy: {
      id: 'asc' as const,
    },
  },
  injuryRestrictions: {
    orderBy: {
      id: 'asc' as const,
    },
  },
} satisfies Prisma.FitnessProfileInclude;

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly onboardingService: OnboardingService,
    private readonly snapshotService: SnapshotService,
  ) {}

  async get(userId: string) {
    await this.subscriptionsService.getProfileSubscription(userId);

    const profile = await this.prisma.fitnessProfile.findUnique({
      where: {
        userId,
      },
      include: PROFILE_INCLUDE,
    });

    if (!profile) {
      throw new NotFoundException('Perfil fitness não encontrado');
    }

    return profile;
  }

  async create(userId: string, data: CreateProfileDto) {
    await this.subscriptionsService.getProfileSubscription(userId);
    const birthDate = this.parsePastDate(data.birthDate, 'Data de nascimento');

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const profile = await transaction.fitnessProfile.create({
          data: {
            userId,
            gender: data.gender,
            birthDate,
            heightCm: data.heightCm,
            currentWeightKg: this.decimal(data.currentWeightKg),
            targetWeightKg: this.decimal(data.targetWeightKg),
            activityLevel: data.activityLevel,
            goal: data.goal,
            foodRestrictions: data.foodRestrictions?.length
              ? {
                  create: data.foodRestrictions.map((restriction) => ({
                    type: restriction.type.trim(),
                    description: restriction.description.trim(),
                  })),
                }
              : undefined,
            injuryRestrictions: data.injuryRestrictions?.length
              ? {
                  create: data.injuryRestrictions.map((restriction) => ({
                    description: restriction.description.trim(),
                  })),
                }
              : undefined,
          },
          include: PROFILE_INCLUDE,
        });

        await this.onboardingService.synchronizeInTransaction(
          transaction,
          userId,
        );

        return profile;
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('O usuário já possui um perfil fitness');
      }

      throw error;
    }
  }

  async update(userId: string, data: UpdateProfileDto) {
    await this.subscriptionsService.getProfileSubscription(userId);

    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        'Informe ao menos um campo para atualizar o perfil',
      );
    }

    const profile = await this.prisma.fitnessProfile.findUnique({
      where: {
        userId,
      },
      select: {
        id: true,
      },
    });

    if (!profile) {
      throw new NotFoundException('Perfil fitness não encontrado');
    }

    const birthDate = data.birthDate
      ? this.parsePastDate(data.birthDate, 'Data de nascimento')
      : undefined;

    return this.prisma.$transaction(async (transaction) => {
      if (data.foodRestrictions !== undefined) {
        await transaction.foodRestriction.deleteMany({
          where: {
            profileId: profile.id,
          },
        });

        if (data.foodRestrictions.length > 0) {
          await transaction.foodRestriction.createMany({
            data: data.foodRestrictions.map((restriction) => ({
              profileId: profile.id,
              type: restriction.type.trim(),
              description: restriction.description.trim(),
            })),
          });
        }
      }

      if (data.injuryRestrictions !== undefined) {
        await transaction.injuryRestriction.deleteMany({
          where: {
            profileId: profile.id,
          },
        });

        if (data.injuryRestrictions.length > 0) {
          await transaction.injuryRestriction.createMany({
            data: data.injuryRestrictions.map((restriction) => ({
              profileId: profile.id,
              description: restriction.description.trim(),
            })),
          });
        }
      }

      const updatedProfile = await transaction.fitnessProfile.update({
        where: {
          id: profile.id,
        },
        data: {
          gender: data.gender,
          birthDate,
          heightCm: data.heightCm,
          currentWeightKg:
            data.currentWeightKg === undefined
              ? undefined
              : this.decimal(data.currentWeightKg),
          targetWeightKg:
            data.targetWeightKg === undefined
              ? undefined
              : this.decimal(data.targetWeightKg),
          activityLevel: data.activityLevel,
          goal: data.goal,
        },
        include: PROFILE_INCLUDE,
      });

      await this.onboardingService.synchronizeInTransaction(
        transaction,
        userId,
      );

      return updatedProfile;
    });
  }

  async createMeasurement(userId: string, data: CreateMeasurementDto) {
    await this.subscriptionsService.getProfileSubscription(userId);
    const profile = await this.requireProfile(userId);
    const measuredAt = data.measuredAt
      ? this.parseNotFutureDate(data.measuredAt, 'Data da medição')
      : new Date();
    const snapshotInput = {
      userId,
      profileId: profile.id,
      heightCm: profile.heightCm,
      weightKg: data.weightKg,
      bodyFatPercent: data.bodyFatPercent,
      muscleMassKg: data.muscleMassKg,
      createdAt: measuredAt,
    };
    const preparedSnapshot = await this.snapshotService.prepare(snapshotInput);

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const measurement = await transaction.bodyMeasurement.create({
          data: {
            profileId: profile.id,
            weightKg: this.decimal(data.weightKg),
            bodyFatPercent:
              data.bodyFatPercent === undefined
                ? undefined
                : this.decimal(data.bodyFatPercent),
            muscleMassKg:
              data.muscleMassKg === undefined
                ? undefined
                : this.decimal(data.muscleMassKg),
            measuredAt,
          },
        });

        await transaction.fitnessProfile.update({
          where: {
            id: profile.id,
          },
          data: {
            currentWeightKg: this.decimal(data.weightKg),
          },
        });

        await this.snapshotService.createInTransaction(
          transaction,
          snapshotInput,
          preparedSnapshot,
        );

        return measurement;
      });
    } catch (error: unknown) {
      await this.snapshotService.failPrepared(preparedSnapshot, error);
      throw error;
    }
  }

  async listMeasurements(userId: string) {
    await this.subscriptionsService.getProfileSubscription(userId);
    const profile = await this.requireProfile(userId);

    return this.prisma.bodyMeasurement.findMany({
      where: {
        profileId: profile.id,
      },
      orderBy: [
        {
          measuredAt: 'desc',
        },
        {
          id: 'desc',
        },
      ],
    });
  }

  private async requireProfile(userId: string) {
    const profile = await this.prisma.fitnessProfile.findUnique({
      where: {
        userId,
      },
      select: {
        id: true,
        heightCm: true,
      },
    });

    if (!profile) {
      throw new NotFoundException('Perfil fitness não encontrado');
    }

    return profile;
  }

  private parsePastDate(value: string, label: string): Date {
    const date = new Date(value);

    if (Number.isNaN(date.getTime()) || date >= new Date()) {
      throw new BadRequestException(`${label} deve estar no passado`);
    }

    return date;
  }

  private parseNotFutureDate(value: string, label: string): Date {
    const date = new Date(value);

    if (Number.isNaN(date.getTime()) || date > new Date()) {
      throw new BadRequestException(`${label} não pode estar no futuro`);
    }

    return date;
  }

  private decimal(value: number): Prisma.Decimal {
    return new Prisma.Decimal(value.toFixed(2));
  }
}
