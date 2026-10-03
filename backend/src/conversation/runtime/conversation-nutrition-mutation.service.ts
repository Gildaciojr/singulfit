import { Injectable } from '@nestjs/common';
import { CoachProfileSnapshotBuilder } from '../../context/coach-profile-snapshot.builder';
import type { ConversationGoalDecision } from '../../context/conversation-goal-planner.contract';
import { CurrentNutritionPlanReaderService } from '../../diet/current-nutrition-plan-reader.service';
import { NutritionApplicationExecutorService } from '../../diet/v2/execution/nutrition-application-executor.service';
import {
  ConversationPlanReferenceService,
  type ConversationPlanReferenceInput,
} from '../understanding/conversation-plan-reference.service';
import { CoachProactiveSchedulePolicy } from '../../automation/coach-proactive-schedule.policy';
import { ConversationEntityRecognizerService } from '../understanding/conversation-entity-recognizer.service';
import { ConversationMessageNormalizerService } from '../understanding/conversation-message-normalizer.service';
import type { NutritionMutationTarget } from '../../diet/v2/nutrition-targeted-mutation.policy';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ConversationNutritionMutationService {
  constructor(
    private readonly reader: CurrentNutritionPlanReaderService,
    private readonly snapshots: CoachProfileSnapshotBuilder,
    private readonly references: ConversationPlanReferenceService,
    private readonly executor: NutritionApplicationExecutorService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: ConversationPlanReferenceInput & {
      readonly decision: ConversationGoalDecision;
    },
  ): Promise<Readonly<{ content: string; completed: boolean }>> {
    const clarify = (content: string) =>
      Object.freeze({ content, completed: false });
    if (
      input.decision.goal !== 'UPDATE_DIET_PLAN' ||
      input.decision.targetPlan !== 'DIET' ||
      !input.decision.canExecute
    )
      return clarify(
        'Preciso confirmar o pedido antes de alterar seu plano alimentar.',
      );
    const message = await this.prisma.message.findFirst({
      where: {
        id: input.messageId,
        conversationId: input.conversationId,
        conversation: { userId: input.userId },
        direction: 'INBOUND',
        type: 'TEXT',
      },
      select: {
        id: true,
        content: true,
        timestamp: true,
        conversation: { select: { id: true, userId: true } },
      },
    });
    if (
      !message ||
      message.id !== input.messageId ||
      message.conversation.userId !== input.userId ||
      message.conversation.id !== input.conversationId ||
      message.timestamp > input.referenceDate
    )
      return clarify('Não consegui identificar o pedido com segurança.');
    const normalized = new ConversationMessageNormalizerService().normalize(
      message.content,
    );
    if (normalized.question)
      return clarify(
        'Você quer apenas uma orientação ou quer aplicar essa troca no plano?',
      );
    const current = await this.reader.getCurrent(input.userId);
    if (
      !current ||
      current.userId !== input.userId ||
      current.implementation !== 'V2'
    )
      return clarify(
        'Não tenho um plano alimentar atual compatível com essa troca.',
      );
    const snapshot = await this.snapshots.build(
      input.userId,
      input.referenceDate,
    );
    if (
      !('value' in snapshot.identity.userId) ||
      snapshot.identity.userId.value !== input.userId
    )
      return clarify('Não consegui consultar seu perfil com segurança.');
    const text = normalized.folded;
    const recognition = new ConversationEntityRecognizerService().recognize(
      normalized,
    );
    const names = recognition.entities
      .filter((entity) => entity.kind === 'MEAL')
      .map((entity) => entity.name);
    const clock = new CoachProactiveSchedulePolicy();
    const timezone = clock.timezone(
      'value' in snapshot.conversation.timezone
        ? snapshot.conversation.timezone.value
        : undefined,
    );
    const local = clock.parts(input.referenceDate, timezone);
    const labels = [
      'domingo',
      'segunda',
      'terca',
      'quarta',
      'quinta',
      'sexta',
      'sabado',
    ];
    const weekday =
      labels[
        new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay()
      ];
    const fold = (value: string) =>
      new ConversationMessageNormalizerService().normalize(value).folded;
    let days = current.document.days;
    if (/\bhoje\b/u.test(text)) {
      const labelled = days.filter(
        (day) => fold(day.label).replace(/ feira$/u, '') === weekday,
      );
      days =
        labelled.length === 1
          ? labelled
          : current.document.artifactType === 'DAILY_STRUCTURE' &&
              days.length === 1
            ? days
            : [];
    } else if (/\b(amanha|ontem|semana passada)\b/u.test(text)) {
      return clarify('Qual dia e refeição do plano você quer alterar?');
    }
    let meals = days.flatMap((day) => day.meals.map((meal) => ({ day, meal })));
    if (names.length) {
      const periods: Readonly<Record<string, string>> = {
        almoço: 'LUNCH',
        jantar: 'DINNER',
        'café da manhã': 'BREAKFAST',
        ceia: 'EVENING_SNACK',
      };
      meals = meals.filter(({ meal }) =>
        names.some(
          (name) =>
            name &&
            (meal.period === periods[name] ||
              fold(meal.name).includes(fold(name))),
        ),
      );
    }
    const sourceText = text.split(/\bpor\b/u)[0];
    const foodNames = recognition.entities
      .filter((entity) => entity.kind === 'FOOD')
      .map((entity) => fold(entity.name))
      .filter((name) => sourceText.includes(name));
    const itemMatches = meals.flatMap((entry) =>
      entry.meal.items
        .filter(
          (item) =>
            sourceText.includes(fold(item.foodName)) ||
            foodNames.some((name) =>
              fold(item.foodName).split(' ').includes(name),
            ),
        )
        .map((item) => ({ ...entry, item })),
    );
    const recent = await this.references.recentAssistant(input);
    const presented = recent
      ? meals.filter(
          ({ meal }) =>
            fold(recent).includes(fold(meal.name)) &&
            meal.items.every((item) =>
              fold(recent).includes(fold(item.foodName)),
            ),
        )
      : [];
    const scopedItems =
      itemMatches.length > 1 && presented.length === 1
        ? itemMatches.filter(
            (entry) =>
              entry.meal.mealKey === presented[0].meal.mealKey &&
              entry.day.dayNumber === presented[0].day.dayNumber,
          )
        : itemMatches;
    const targetMeal =
      scopedItems.length === 1
        ? scopedItems[0]
        : names.length && meals.length === 1
          ? meals[0]
          : presented.length === 1
            ? presented[0]
            : null;
    const requestedMeal = text.replace(
      /^(?:troque|trocar|substitua|substituir)\s+(?:(?:meu|minha|o|a|esse|essa|este|esta)\s+)?/u,
      '',
    );
    const wholeMealNamed = names.some(
      (name) => name && requestedMeal.startsWith(fold(name)),
    );
    if (
      /\b(?:esse|este|essa|esta) (?:alimento|item)\b/u.test(text) &&
      scopedItems.length !== 1
    )
      return clarify('Qual alimento dessa refeição você quer substituir?');
    if (
      !targetMeal ||
      scopedItems.length > 1 ||
      (scopedItems.length === 0 &&
        !wholeMealNamed &&
        !/\b(?:essa|esta) refeicao\b|\btroque isso\b|\bme de outra opcao\b/u.test(
          text,
        )) ||
      (foodNames.length > 0 && scopedItems.length !== 1)
    )
      return clarify(
        'Qual refeição e dia do plano você quer alterar? Diga também o alimento, se a troca for só de um item.',
      );
    const target: NutritionMutationTarget = {
      dayNumber: targetMeal.day.dayNumber,
      mealKey: targetMeal.meal.mealKey,
      itemKey: scopedItems.length === 1 ? scopedItems[0].item.itemKey : null,
      request: message.content,
      sourcePlanId: current.id,
    };
    try {
      const result = await this.executor.execute({
        ownership: { userId: input.userId, profileId: current.profileId },
        correlationId: input.messageId,
        continuationOperationKey: `nutrition-mutation:${input.userId}:${input.messageId}`,
        generationInput: {
          userId: input.userId,
          decision: input.decision,
          snapshot,
          referenceDate: input.referenceDate,
          previousPlan: current.document,
          mutationTarget: target,
          explicitArtifactType: target.itemKey
            ? 'FOOD_SUBSTITUTION'
            : 'PLAN_ADAPTATION',
          requestedChangeReason: 'USER_REQUEST',
        },
      });
      if (result.kind !== 'PLAN')
        return clarify('Não foi possível aplicar essa troca com segurança.');
      const updated = result.document.days
        .find((day) => day.dayNumber === target.dayNumber)
        ?.meals.find((meal) => meal.mealKey === target.mealKey);
      if (!updated)
        return clarify('Não consegui confirmar o resultado da troca.');
      return Object.freeze({
        completed: true,
        content: `Atualizei *${updated.name}*: ${updated.items.map((item) => `${item.quantity} de ${item.foodName}`).join(', ')}.`,
      });
    } catch {
      return clarify(
        'Não consegui aplicar essa troca com segurança. Confira suas restrições e o plano atual antes de tentar novamente.',
      );
    }
  }
}
