import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateCheckInDto } from './dto/create-check-in.dto';

@Injectable()
export class CheckInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async create(userId: string, data: CreateCheckInDto) {
    await this.subscriptionsService.getProfileSubscription(userId);
    const profile = await this.requireProfile(userId);

    return this.prisma.fitnessCheckIn.create({
      data: {
        userId,
        profileId: profile.id,
        mood: data.mood.trim(),
        energyLevel: data.energyLevel,
        adherenceScore: data.adherenceScore,
        notes: data.notes?.trim(),
      },
    });
  }

  async list(userId: string) {
    await this.subscriptionsService.getProfileSubscription(userId);

    return this.prisma.fitnessCheckIn.findMany({
      where: {
        userId,
      },
      orderBy: [
        {
          createdAt: 'desc',
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
      },
    });

    if (!profile) {
      throw new NotFoundException(
        'Complete o perfil fitness antes de registrar um check-in',
      );
    }

    return profile;
  }
}
