import { Injectable } from '@nestjs/common';
import { NUTRITION_ARTIFACT_TYPE } from '../../diet/v2/nutrition-planning-artifact.contract';
import {
  WORKOUT_ARTIFACT_TYPE,
  WORKOUT_MODALITY,
  type WorkoutModality,
} from '../../workout/v2/workout-planning-artifact.contract';
import type { ConversationEntity } from '../contracts/conversation-entity.contract';
import type {
  ConversationEntityRecognition,
  NormalizedConversationMessage,
} from '../contracts/conversation-understanding-pipeline.contract';

const MEALS = Object.freeze([
  Object.freeze({ phrase: 'cafe da manha', name: 'café da manhã' }),
  Object.freeze({ phrase: 'almoco', name: 'almoço' }),
  Object.freeze({ phrase: 'jantar', name: 'jantar' }),
  Object.freeze({ phrase: 'lanche', name: 'lanche' }),
  Object.freeze({ phrase: 'ceia', name: 'ceia' }),
]);

const FOODS = Object.freeze([
  Object.freeze({ phrase: 'whey', name: 'whey' }),
  Object.freeze({ phrase: 'frango', name: 'frango' }),
  Object.freeze({ phrase: 'arroz', name: 'arroz' }),
  Object.freeze({ phrase: 'banana', name: 'banana' }),
  Object.freeze({ phrase: 'creatina', name: 'creatina' }),
]);

const MODALITIES: readonly Readonly<{
  phrase: string;
  modality: WorkoutModality;
}>[] = Object.freeze([
  Object.freeze({
    phrase: 'musculacao',
    modality: WORKOUT_MODALITY.GYM_STRENGTH,
  }),
  Object.freeze({
    phrase: 'academia',
    modality: WORKOUT_MODALITY.GYM_STRENGTH,
  }),
  Object.freeze({ phrase: 'corrida', modality: WORKOUT_MODALITY.RUNNING }),
  Object.freeze({ phrase: 'correr', modality: WORKOUT_MODALITY.RUNNING }),
  Object.freeze({ phrase: 'bike', modality: WORKOUT_MODALITY.CYCLING }),
  Object.freeze({ phrase: 'ciclismo', modality: WORKOUT_MODALITY.CYCLING }),
  Object.freeze({ phrase: 'crossfit', modality: WORKOUT_MODALITY.CROSSFIT }),
  Object.freeze({ phrase: 'caminhada', modality: WORKOUT_MODALITY.WALKING }),
  Object.freeze({
    phrase: 'calistenia',
    modality: WORKOUT_MODALITY.CALISTHENICS,
  }),
  Object.freeze({ phrase: 'mobilidade', modality: WORKOUT_MODALITY.MOBILITY }),
]);

@Injectable()
export class ConversationEntityRecognizerService {
  recognize(
    message: NormalizedConversationMessage,
  ): ConversationEntityRecognition {
    const entities: ConversationEntity[] = [];
    const text = message.folded;

    for (const meal of MEALS) {
      if (this.hasPhrase(text, meal.phrase)) {
        entities.push(
          Object.freeze({ kind: 'MEAL', name: meal.name, time: null }),
        );
      }
    }
    for (const food of FOODS) {
      if (this.hasPhrase(text, food.phrase)) {
        entities.push(Object.freeze({ kind: 'FOOD', name: food.name }));
      }
    }
    for (const item of MODALITIES) {
      if (this.hasPhrase(text, item.phrase)) {
        entities.push(
          Object.freeze({ kind: 'WORKOUT_MODALITY', value: item.modality }),
        );
      }
    }

    this.addArtifacts(text, entities);
    this.addComponents(text, entities);
    this.addConfirmation(text, entities);
    this.addTemporalReference(text, entities);

    return Object.freeze({ entities: this.unique(entities) });
  }

  private addArtifacts(text: string, entities: ConversationEntity[]): void {
    const nutrition = this.nutritionMention(text);
    const workout = this.workoutMention(text);
    if (
      /\b(plano semanal|dieta semanal|semana inteira|cardapio semanal)\b/u.test(
        text,
      )
    ) {
      if (workout) {
        entities.push(
          Object.freeze({
            kind: 'WORKOUT_ARTIFACT',
            value: WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
          }),
        );
      } else if (nutrition) {
        entities.push(
          Object.freeze({
            kind: 'NUTRITION_ARTIFACT',
            value: NUTRITION_ARTIFACT_TYPE.WEEKLY_PLAN,
          }),
        );
      }
    }
    if (
      /\b(plano diario|dieta diaria|estrutura diaria|cardapio do dia)\b/u.test(
        text,
      )
    ) {
      entities.push(
        Object.freeze({
          kind: 'NUTRITION_ARTIFACT',
          value: NUTRITION_ARTIFACT_TYPE.DAILY_STRUCTURE,
        }),
      );
    }
    if (/\b(tro(?:c|qu)\w*|substitu\w*)\b/u.test(text) && nutrition) {
      entities.push(
        Object.freeze({
          kind: 'NUTRITION_ARTIFACT',
          value: NUTRITION_ARTIFACT_TYPE.FOOD_SUBSTITUTION,
        }),
      );
    }
    if (/\b(tro(?:c|qu)\w*|substitu\w*)\b/u.test(text) && workout) {
      entities.push(
        Object.freeze({
          kind: 'WORKOUT_ARTIFACT',
          value: WORKOUT_ARTIFACT_TYPE.EXERCISE_SUBSTITUTION,
        }),
      );
    }
  }

  private addComponents(text: string, entities: ConversationEntity[]): void {
    if (
      /\b(refeicao|refeicoes|cafe da manha|almoco|jantar|lanche|ceia)\b/u.test(
        text,
      )
    ) {
      entities.push(
        Object.freeze({
          kind: 'PLAN_COMPONENT',
          domain: 'NUTRITION',
          component: 'MEAL',
        }),
      );
    }
    if (/\b(alimento|alimentos|comida|ingrediente)\b/u.test(text)) {
      entities.push(
        Object.freeze({
          kind: 'PLAN_COMPONENT',
          domain: 'NUTRITION',
          component: 'FOOD',
        }),
      );
    }
    if (/\b(exercicio|exercicios|movimento)\b/u.test(text)) {
      entities.push(
        Object.freeze({
          kind: 'PLAN_COMPONENT',
          domain: 'WORKOUT',
          component: 'EXERCISE',
        }),
      );
    }
  }

  private addConfirmation(text: string, entities: ConversationEntity[]): void {
    if (
      /^(sim|claro|confirmo|pode|continue|continua|isso mesmo)\b/u.test(text)
    ) {
      entities.push(Object.freeze({ kind: 'CONFIRMATION', value: 'YES' }));
    } else if (/^(nao|cancela|cancelar|pare|para)\b/u.test(text)) {
      entities.push(Object.freeze({ kind: 'CONFIRMATION', value: 'NO' }));
    }
  }

  private addTemporalReference(
    text: string,
    entities: ConversationEntity[],
  ): void {
    const entries: readonly Readonly<{
      pattern: RegExp;
      value:
        | 'TODAY'
        | 'TOMORROW'
        | 'YESTERDAY'
        | 'THIS_WEEK'
        | 'NEXT_WEEK'
        | 'PREVIOUS'
        | 'CURRENT';
    }>[] = [
      { pattern: /\bhoje\b/u, value: 'TODAY' },
      { pattern: /\bamanha\b/u, value: 'TOMORROW' },
      { pattern: /\bontem\b/u, value: 'YESTERDAY' },
      { pattern: /\besta semana\b/u, value: 'THIS_WEEK' },
      { pattern: /\bproxima semana\b/u, value: 'NEXT_WEEK' },
      { pattern: /\b(anterior|ultimo|ultima)\b/u, value: 'PREVIOUS' },
      { pattern: /\b(atual|este|esta|esse|essa)\b/u, value: 'CURRENT' },
    ];
    for (const entry of entries) {
      if (entry.pattern.test(text)) {
        entities.push(
          Object.freeze({ kind: 'TEMPORAL_REFERENCE', value: entry.value }),
        );
        return;
      }
    }
  }

  private nutritionMention(text: string): boolean {
    return /\b(dieta|alimentacao|alimentar|refeicao|refeicoes|alimento|comida|cardapio)\b/u.test(
      text,
    );
  }

  private workoutMention(text: string): boolean {
    return /\b(treino|treinar|exercicio|exercicios|academia|musculacao|corrida|bike|crossfit)\b/u.test(
      text,
    );
  }

  private hasPhrase(text: string, phrase: string): boolean {
    return ` ${text} `.includes(` ${phrase} `);
  }

  private unique(
    entities: readonly ConversationEntity[],
  ): readonly ConversationEntity[] {
    const keys = new Set<string>();
    return Object.freeze(
      entities.filter((entity) => {
        const key = JSON.stringify(entity);
        if (keys.has(key)) return false;
        keys.add(key);
        return true;
      }),
    );
  }
}
