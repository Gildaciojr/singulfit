import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { NutritionIntakeLedgerService } from './nutrition-intake-ledger.service';
import { NutritionConsumptionSummaryService } from './nutrition-consumption-summary.service';
import type { CurrentNutritionPlanReaderService } from '../diet/current-nutrition-plan-reader.service';

const url = process.env.NUTRITION_INTAKE_INTEGRATION_DATABASE_URL;
const integration = url ? describe : describe.skip;
integration('Nutrition intake receipts: isolated PostgreSQL', () => {
  const db = new PrismaClient({ datasources: { db: { url } } });
  const ledger = new NutritionIntakeLedgerService(
    db as unknown as PrismaService,
  );
  let userId: string;
  let conversationId: string;
  const at = new Date('2026-10-11T18:00:00Z');
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['127.0.0.1', 'localhost'].includes(target.hostname) ||
      !target.pathname.includes('macro_consolidated')
    )
      throw new Error('Isolated local PostgreSQL required');
    await db.$connect();
  });
  beforeEach(async () => {
    userId = (
      await db.user.create({
        data: {
          phone: `intake-synthetic-${randomUUID()}`,
          preferences: { create: { timezone: 'America/Sao_Paulo' } },
        },
      })
    ).id;
    conversationId = (
      await db.conversation.create({
        data: {
          userId,
          phoneNumber:
            '+999' +
            BigInt('0x' + randomUUID().replace(/-/gu, '').slice(0, 12))
              .toString()
              .slice(0, 10),
        },
      })
    ).id;
  });
  afterEach(async () => {
    await db.nutritionIntakeRecord.deleteMany({ where: { userId } });
    await db.user.delete({ where: { id: userId } });
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  const source = (content: string, timestamp = at) =>
    db.message.create({
      data: {
        conversationId,
        type: 'TEXT',
        direction: 'INBOUND',
        content,
        timestamp,
        externalMessageId: randomUUID(),
      },
    });
  it('requires explicit clarification instead of silently losing a second volume or water alongside a meal', async () => {
    for (const [text, kind, quote] of [
      ['Bebi 500 ml e depois 300 ml', 'WATER_ADD', '500 ml'],
      ['Almocei arroz e bebi 500 ml', 'MEAL', 'arroz'],
    ]) {
      const message = await source(text);
      await expect(
        db.$transaction((tx) =>
          ledger.record(tx, userId, message.id, { kind, day: 'TODAY', quote }),
        ),
      ).rejects.toThrow('INTAKE_MULTIPLE_FACTS_REQUIRE_CLARIFICATION');
    }
    expect(await db.nutritionIntakeRecord.count({ where: { userId } })).toBe(0);
  });
  it('retains a receipt when its source message is deleted independently', async () => {
    const message = await source('Bebi 500 ml');
    const receipt = await db.$transaction((tx) =>
      ledger.record(tx, userId, message.id, {
        kind: 'WATER_ADD',
        day: 'TODAY',
        quote: '500 ml',
      }),
    );
    await expect(
      db.message.delete({ where: { id: message.id } }),
    ).rejects.toThrow();
    expect(
      await db.nutritionIntakeRecord.findUnique({ where: { id: receipt.id } }),
    ).not.toBeNull();
  });
  it('enforces ownership and immutable facts at the database boundary', async () => {
    const message = await source('Bebi 500 ml');
    const receipt = await db.$transaction((tx) =>
      ledger.record(tx, userId, message.id, {
        kind: 'WATER_ADD',
        day: 'TODAY',
        quote: '500 ml',
      }),
    );
    await expect(
      db.nutritionIntakeRecord.update({
        where: { id: receipt.id },
        data: { volumeMl: 700 },
      }),
    ).rejects.toThrow();
    await expect(
      db.nutritionIntakeRecord.update({
        where: { id: receipt.id },
        data: { voidedAt: at },
      }),
    ).rejects.toThrow();
    const foreign = await db.user.create({
      data: { phone: `foreign-synthetic-${randomUUID()}` },
    });
    try {
      await expect(
        db.nutritionIntakeRecord.create({
          data: {
            userId: foreign.id,
            sourceMessageId: message.id,
            operationKey: randomUUID(),
            kind: 'WATER_ADD',
            volumeMl: 500,
            occurredAt: at,
            reportedAt: at,
            evidence: {},
          },
        }),
      ).rejects.toThrow();
    } finally {
      await db.user.delete({ where: { id: foreign.id } });
    }
    expect(
      await db.nutritionIntakeRecord.findUnique({ where: { id: receipt.id } }),
    ).toMatchObject({ volumeMl: 500, voidedAt: null });
  });
  it('preserves ADD versus TOTAL and replays the same receipt under concurrency', async () => {
    const message = await source('Bebi 500 ml de água');
    const evidence = { kind: 'WATER_ADD', day: 'TODAY', quote: '500 ml' };
    await Promise.all(
      [0, 1].map(() =>
        db.$transaction((tx) =>
          ledger.record(tx, userId, message.id, evidence),
        ),
      ),
    );
    const total = await source(
      'Já bebi 1 litro hoje ao todo',
      new Date(at.getTime() + 1000),
    );
    await db.$transaction((tx) =>
      ledger.record(tx, userId, total.id, {
        kind: 'WATER_TOTAL',
        day: 'TODAY',
        quote: '1 litro',
      }),
    );
    const addition = await source(
      'Agora foram mais 300 ml',
      new Date(at.getTime() + 2000),
    );
    await db.$transaction((tx) =>
      ledger.record(tx, userId, addition.id, {
        kind: 'WATER_ADD',
        day: 'TODAY',
        quote: '300 ml',
      }),
    );
    expect(
      await ledger.water(
        userId,
        new Date(at.getTime() + 3000),
        'America/Sao_Paulo',
      ),
    ).toMatchObject({ volumeMl: 1300, recordCount: 3 });
    expect(await db.aIJob.count({ where: { userId } })).toBe(0);
    expect(await db.usageEvent.count({ where: { userId } })).toBe(0);
  });
  it('records an incomplete meal with null macros on the reported yesterday', async () => {
    const message = await source('Ontem comi uma pizza');
    const receipt = await db.$transaction((tx) =>
      ledger.record(tx, userId, message.id, {
        kind: 'MEAL',
        day: 'YESTERDAY',
        quote: 'uma pizza',
      }),
    );
    expect(receipt.occurredAt).toEqual(new Date('2026-10-10T03:00:00Z'));
    const meal = await db.meal.findUniqueOrThrow({
      where: { id: receipt.mealId! },
      include: { analysis: true },
    });
    expect(meal.analysis).toBeNull();
    const summary = new NutritionConsumptionSummaryService(
      db as unknown as PrismaService,
    );
    expect(
      await summary.summarize({
        userId,
        period: 'TODAY',
        referenceDate: at,
        timezone: 'America/Sao_Paulo',
      }),
    ).toMatchObject({ mealCount: 0 });
    expect(
      await summary.summarize({
        userId,
        period: 'TODAY',
        referenceDate: new Date('2026-10-10T23:00:00Z'),
        knownAt: at,
        timezone: 'America/Sao_Paulo',
      }),
    ).toMatchObject({ mealCount: 1, calories: null, incompleteMealCount: 1 });
  });
  it('fences ownership and invented evidence before any mutation', async () => {
    const message = await source('Bebi água');
    await expect(
      db.$transaction((tx) =>
        ledger.record(tx, 'other-user', message.id, {
          kind: 'WATER_ADD',
          day: 'TODAY',
          quote: '500 ml',
        }),
      ),
    ).rejects.toThrow('INTAKE_SOURCE_NOT_OWNED');
    await expect(
      db.$transaction((tx) =>
        ledger.record(tx, userId, message.id, {
          kind: 'WATER_ADD',
          day: 'TODAY',
          quote: '500 ml',
        }),
      ),
    ).rejects.toThrow('INTAKE_EVIDENCE_INVALID');
    expect(await db.nutritionIntakeRecord.count({ where: { userId } })).toBe(0);
  });
  it('rolls back the ledger if publication fails in the same transaction', async () => {
    const message = await source('Bebi 500 ml');
    await expect(
      db.$transaction(async (tx) => {
        await ledger.record(tx, userId, message.id, {
          kind: 'WATER_ADD',
          day: 'TODAY',
          quote: '500 ml',
        });
        throw new Error('PUBLICATION_FAILED');
      }),
    ).rejects.toThrow('PUBLICATION_FAILED');
    expect(await db.nutritionIntakeRecord.count({ where: { userId } })).toBe(0);
  });
  it('corrects and deletes a reported meal without erasing its audit trail or double counting', async () => {
    const first = await source('Almocei arroz e frango');
    const original = await db.$transaction((tx) =>
      ledger.record(tx, userId, first.id, {
        kind: 'MEAL',
        day: 'TODAY',
        quote: 'arroz e frango',
        meal: 'LUNCH',
      }),
    );
    const second = await source(
      'Corrige o almoço: comi menos arroz',
      new Date(at.getTime() + 1000),
    );
    const corrected = await db.$transaction((tx) =>
      ledger.record(tx, userId, second.id, {
        kind: 'MEAL',
        day: 'TODAY',
        quote: 'menos arroz',
        action: 'CORRECT',
        targetRecordId: original.id,
        meal: 'LUNCH',
      }),
    );
    const summary = new NutritionConsumptionSummaryService(
      db as unknown as PrismaService,
    );
    expect(
      await summary.summarize({
        userId,
        period: 'TODAY',
        referenceDate: new Date(at.getTime() + 2000),
        timezone: 'America/Sao_Paulo',
      }),
    ).toMatchObject({ mealCount: 1, calories: null });
    const third = await source(
      'Apaga aquele almoço, registrei errado',
      new Date(at.getTime() + 3000),
    );
    const remove = {
      kind: 'VOID',
      day: 'TODAY',
      quote: 'Apaga aquele almoço',
      action: 'DELETE',
      targetRecordId: corrected.id,
    };
    await db.$transaction((tx) => ledger.record(tx, userId, third.id, remove));
    await db.$transaction((tx) => ledger.record(tx, userId, third.id, remove));
    expect(
      await summary.summarize({
        userId,
        period: 'TODAY',
        referenceDate: new Date(at.getTime() + 4000),
        timezone: 'America/Sao_Paulo',
      }),
    ).toMatchObject({ mealCount: 0 });
    expect(await db.nutritionIntakeRecord.count({ where: { userId } })).toBe(3);
    expect(
      await db.nutritionIntakeRecord.findUnique({ where: { id: original.id } }),
    ).toMatchObject({ voidedAt: second.timestamp });
  });
  it('retains the original reservation-free water correction, explicit zero and consented goal', async () => {
    const first = await source('Bebi 500 ml');
    const original = await db.$transaction((tx) =>
      ledger.record(tx, userId, first.id, {
        kind: 'WATER_ADD',
        day: 'TODAY',
        quote: '500 ml',
      }),
    );
    const correction = await source(
      'Corrige: foram 300 ml',
      new Date(at.getTime() + 1000),
    );
    await db.$transaction((tx) =>
      ledger.record(tx, userId, correction.id, {
        kind: 'WATER_ADD',
        day: 'TODAY',
        quote: '300 ml',
        action: 'CORRECT',
        targetRecordId: original.id,
      }),
    );
    const goal = await source(
      'Minha meta de água é 2 litros',
      new Date(at.getTime() + 2000),
    );
    await db.$transaction((tx) =>
      ledger.record(tx, userId, goal.id, {
        kind: 'WATER_GOAL',
        day: 'TODAY',
        quote: '2 litros',
      }),
    );
    expect(
      await ledger.water(userId, new Date(at.getTime() + 3000)),
    ).toMatchObject({ volumeMl: 300, recordCount: 1 });
    expect(await ledger.goal(userId, new Date(at.getTime() + 3000))).toEqual({
      volumeMl: 2000,
    });
    expect(await ledger.water(userId, at)).toMatchObject({
      volumeMl: 500,
      recordCount: 1,
    });
    expect(await ledger.goal(userId, at)).toBeNull();
    expect(await db.usageEvent.count({ where: { userId } })).toBe(0);
  });
  it('reuses a referenced meal across another text or projected audio instead of counting a second meal', async () => {
    const first = await source('Almocei arroz');
    const original = await db.$transaction((tx) =>
      ledger.record(tx, userId, first.id, {
        kind: 'MEAL',
        day: 'TODAY',
        quote: 'arroz',
        meal: 'LUNCH',
      }),
    );
    const second = await source(
      'Também comi feijão',
      new Date(at.getTime() + 1000),
    );
    await db.message.update({
      where: { id: second.id },
      data: { replyToExternalMessageId: first.externalMessageId },
    });
    const linked = await db.$transaction((tx) =>
      ledger.record(tx, userId, second.id, {
        kind: 'MEAL',
        day: 'TODAY',
        quote: 'feijão',
        meal: 'LUNCH',
      }),
    );
    expect(linked.mealId).toBe(original.mealId);
    expect(await db.meal.count({ where: { userId } })).toBe(1);
  });
  it('counts image estimates only after an owned actual-consumption confirmation and links subsequent reports once', async () => {
    const image = await db.message.create({
      data: {
        conversationId,
        direction: 'INBOUND',
        type: 'IMAGE',
        content: 'Uma refeição',
        timestamp: at,
        externalMessageId: randomUUID(),
      },
    });
    const media = await db.mediaFile.create({
      data: {
        userId,
        conversationId,
        messageId: image.id,
        mediaType: 'IMAGE',
        storageProvider: 'LOCAL',
        originalFileName: 'synthetic.jpg',
        mimeType: 'image/jpeg',
        fileSize: 4,
        checksum: createHash('sha256')
          .update(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
          .digest('hex'),
        storagePath: 'synthetic/never-read.jpg',
      },
    });
    const meal = await db.meal.create({
      data: {
        userId,
        conversationId,
        messageId: image.id,
        mediaFileId: media.id,
        source: 'WHATSAPP',
        analysis: {
          create: {
            status: 'COMPLETED',
            rawResponse: {
              source: 'CONTROLLED_PROVIDER',
              foods: ['arroz', 'frango'],
            },
            confidence: 0.9,
            totalCalories: 400,
            totalProtein: 30,
            totalCarbs: 45,
            totalFat: 11,
          },
        },
      },
    });
    const summary = new NutritionConsumptionSummaryService(
      db as unknown as PrismaService,
    );
    expect(
      await summary.summarize({
        userId,
        period: 'TODAY',
        referenceDate: at,
        timezone: 'America/Sao_Paulo',
        confirmedOnly: true,
      }),
    ).toMatchObject({ mealCount: 0 });
    const report = await source(
      'Comi essa refeição no almoço',
      new Date(at.getTime() + 1000),
    );
    await db.message.update({
      where: { id: report.id },
      data: { replyToExternalMessageId: image.externalMessageId },
    });
    const receipt = await db.$transaction((tx) =>
      ledger.record(tx, userId, report.id, {
        kind: 'MEAL',
        day: 'TODAY',
        quote: 'essa refeição',
        meal: 'LUNCH',
      }),
    );
    expect(receipt.mealId).toBe(meal.id);
    expect(
      await summary.summarize({
        userId,
        period: 'TODAY',
        referenceDate: new Date(at.getTime() + 2000),
        timezone: 'America/Sao_Paulo',
        confirmedOnly: true,
      }),
    ).toMatchObject({
      mealCount: 1,
      calories: 400,
      protein: 30,
      carbs: 45,
      fat: 11,
    });
    expect(await db.meal.count({ where: { userId } })).toBe(1);
    expect(await db.usageEvent.count({ where: { userId } })).toBe(0);
  });
  it('uses only the persisted portions of one exact historical plan meal and leaves unknown reports incomplete', async () => {
    const plans = {
      getApplicableAt: jest.fn().mockResolvedValue({
        id: 'historical-plan',
        implementation: 'LEGACY',
        userId,
        meals: [
          {
            name: 'Almoço',
            items: [
              {
                quantity: '100 g',
                calories: 150,
                protein: 20,
                carbs: 10,
                fat: 3,
              },
            ],
          },
        ],
      }),
    };
    const estimating = new NutritionIntakeLedgerService(
      db as unknown as PrismaService,
      plans as unknown as CurrentNutritionPlanReaderService,
    );
    const first = await source('Almocei exatamente o que estava na dieta');
    const receipt = await db.$transaction((tx) =>
      estimating.record(tx, userId, first.id, {
        kind: 'MEAL',
        day: 'TODAY',
        quote: 'exatamente o que estava na dieta',
        meal: 'LUNCH',
        plannedMeal: true,
      }),
    );
    expect(receipt.evidence).toMatchObject({
      nutrition: {
        calories: 150,
        protein: 20,
        carbs: 10,
        fat: 3,
        sourcePlanId: 'historical-plan',
        provenance: 'PLAN_PORTION_ESTIMATE',
        quantities: ['100 g'],
      },
    });
    const summary = new NutritionConsumptionSummaryService(
      db as unknown as PrismaService,
    );
    expect(
      await summary.summarize({
        userId,
        period: 'TODAY',
        referenceDate: at,
        timezone: 'America/Sao_Paulo',
      }),
    ).toMatchObject({
      calories: 150,
      protein: 20,
      carbs: 10,
      fat: 3,
      mealCount: 1,
    });
    expect(plans.getApplicableAt).toHaveBeenCalledWith(userId, at);
    expect(await db.mealAnalysis.count({ where: { meal: { userId } } })).toBe(
      0,
    );
  });
});
