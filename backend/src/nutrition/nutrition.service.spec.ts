import { BadRequestException } from '@nestjs/common';
import { MealSource, MediaType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NutritionService } from './nutrition.service';

describe('NutritionService', () => {
  function createSubject() {
    const createdMeal = {
      id: 'meal-id',
      mediaFileId: 'media-id',
      analysis: {
        id: 'analysis-id',
        items: [],
      },
    };
    const prisma = {
      meal: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(createdMeal),
      },
      mediaFile: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'media-id',
          userId: 'user-id',
          conversationId: 'conversation-id',
          messageId: 'message-id',
          mediaType: MediaType.IMAGE,
        }),
      },
    };
    const service = new NutritionService(prisma as unknown as PrismaService);

    return {
      service,
      prisma,
      createdMeal,
    };
  }

  it('creates a WhatsApp meal and its pending analysis from stored media', async () => {
    const subject = createSubject();

    const result = await subject.service.createMealFromMedia('media-id');

    expect(result).toBe(subject.createdMeal);
    expect(subject.prisma.meal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          userId: 'user-id',
          conversationId: 'conversation-id',
          messageId: 'message-id',
          mediaFileId: 'media-id',
          source: MealSource.WHATSAPP,
          analysis: {
            create: {},
          },
        },
      }),
    );
  });

  it('returns the existing meal without creating a duplicate', async () => {
    const subject = createSubject();
    subject.prisma.meal.findUnique.mockResolvedValue(subject.createdMeal);

    await expect(subject.service.createMealFromMedia('media-id')).resolves.toBe(
      subject.createdMeal,
    );
    expect(subject.prisma.mediaFile.findUnique).not.toHaveBeenCalled();
    expect(subject.prisma.meal.create).not.toHaveBeenCalled();
  });

  it('rejects non-image media', async () => {
    const subject = createSubject();
    subject.prisma.mediaFile.findUnique.mockResolvedValue({
      id: 'media-id',
      userId: 'user-id',
      conversationId: 'conversation-id',
      messageId: 'message-id',
      mediaType: MediaType.AUDIO,
    });

    await expect(
      subject.service.createMealFromMedia('media-id'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(subject.prisma.meal.create).not.toHaveBeenCalled();
  });
});
