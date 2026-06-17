import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MealSource, MediaType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const MEAL_INCLUDE = {
  mediaFile: true,
  analysis: {
    include: {
      items: {
        orderBy: {
          id: 'asc' as const,
        },
      },
      aiJob: {
        include: {
          usage: {
            orderBy: {
              createdAt: 'asc' as const,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.MealInclude;

@Injectable()
export class NutritionService {
  constructor(private readonly prisma: PrismaService) {}

  async createMealFromMedia(
    mediaFileId: string,
    source: MealSource = MealSource.WHATSAPP,
  ) {
    const existingMeal = await this.prisma.meal.findUnique({
      where: {
        mediaFileId,
      },
      include: MEAL_INCLUDE,
    });

    if (existingMeal) {
      return existingMeal;
    }

    const mediaFile = await this.prisma.mediaFile.findUnique({
      where: {
        id: mediaFileId,
      },
    });

    if (!mediaFile) {
      throw new NotFoundException('Mídia da refeição não encontrada');
    }

    if (mediaFile.mediaType !== MediaType.IMAGE) {
      throw new BadRequestException(
        'Somente imagens podem originar uma refeição',
      );
    }

    try {
      return await this.prisma.meal.create({
        data: {
          userId: mediaFile.userId,
          conversationId: mediaFile.conversationId,
          messageId: mediaFile.messageId,
          mediaFileId: mediaFile.id,
          source,
          analysis: {
            create: {},
          },
        },
        include: MEAL_INCLUDE,
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const concurrentMeal = await this.prisma.meal.findUnique({
          where: {
            mediaFileId,
          },
          include: MEAL_INCLUDE,
        });

        if (concurrentMeal) {
          return concurrentMeal;
        }
      }

      throw error;
    }
  }

  async getMeal(mealId: string) {
    const meal = await this.prisma.meal.findUnique({
      where: {
        id: mealId,
      },
      include: MEAL_INCLUDE,
    });

    if (!meal) {
      throw new NotFoundException('Refeição não encontrada');
    }

    return meal;
  }
}
