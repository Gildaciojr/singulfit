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
    expected?: Readonly<{ userId: string; messageId: string }>,
  ) {
    const existingMeal = await this.prisma.meal.findUnique({
      where: {
        mediaFileId,
      },
      include: MEAL_INCLUDE,
    });

    if (existingMeal) {
      if (
        expected &&
        (existingMeal.userId !== expected.userId ||
          existingMeal.messageId !== expected.messageId ||
          existingMeal.mediaFileId !== mediaFileId)
      )
        throw new BadRequestException('Meal ownership mismatch');
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
    if (
      mediaFile.id !== mediaFileId ||
      (expected &&
        (mediaFile.userId !== expected.userId ||
          mediaFile.messageId !== expected.messageId))
    )
      throw new BadRequestException('Media ownership mismatch');

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
          if (
            expected &&
            (concurrentMeal.userId !== expected.userId ||
              concurrentMeal.messageId !== expected.messageId ||
              concurrentMeal.mediaFileId !== mediaFileId)
          )
            throw new BadRequestException('Meal ownership mismatch');
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
