import { Injectable } from '@nestjs/common';
import type {
  WorkoutPlanV2,
  WorkoutActivityV2,
} from './workout-plan-v2.contract';
import { CurrentWorkoutPlanReaderService } from './current-workout-plan-reader.service';
import {
  WORKOUT_ARTIFACT_TYPE,
  type WorkoutModality,
} from './workout-planning-artifact.contract';
import type { WorkoutRecognizedContext } from './workout-planning-context.contract';

export type WorkoutPlanMutationResolution =
  | Readonly<{ status: 'NOT_A_MUTATION' }>
  | Readonly<{ status: 'CLARIFICATION'; message: string }>
  | Readonly<{ status: 'NO_CURRENT_PLAN'; message: string }>
  | Readonly<{
      status: 'READY';
      previousPlan: WorkoutPlanV2;
      recognizedContext: WorkoutRecognizedContext;
    }>;

@Injectable()
export class WorkoutPlanMutationResolverService {
  constructor(private readonly reader: CurrentWorkoutPlanReaderService) {}

  async resolve(
    userId: string,
    message: string | undefined,
    declared: WorkoutRecognizedContext,
  ): Promise<WorkoutPlanMutationResolution> {
    const text = this.normalize(message ?? '');
    const kind = this.kind(text);
    if (!kind) return Object.freeze({ status: 'NOT_A_MUTATION' });
    const current = await this.reader.read(userId);
    if (current.status !== 'AVAILABLE') {
      return Object.freeze({
        status: 'NO_CURRENT_PLAN',
        message:
          'Você não tem um plano Workout V2 ativo que eu possa alterar com segurança. Posso criar um novo plano quando você pedir.',
      });
    }
    if (kind === 'AMBIGUOUS_MODALITY') {
      return Object.freeze({
        status: 'CLARIFICATION',
        message:
          'Você quer adaptar o plano atual para incluir corrida ou criar um novo plano de corrida?',
      });
    }
    if (kind === 'ADAPTATION') {
      const reason = this.adaptationReason(declared);
      if (!reason) {
        return Object.freeze({
          status: 'CLARIFICATION',
          message:
            'Qual mudança você quer fazer no plano atual: duração, frequência, foco muscular ou modalidade?',
        });
      }
      return Object.freeze({
        status: 'READY',
        previousPlan: current.plan.document,
        recognizedContext: Object.freeze({
          ...declared,
          artifactType: WORKOUT_ARTIFACT_TYPE.PLAN_ADAPTATION,
          modality: this.modality(current.plan.document.modality),
          purpose: 'ADAPTATION',
          mutation: Object.freeze({
            kind: 'PLAN_ADAPTATION',
            sourceActivityKey: null,
            sourceActivityName: null,
            reason,
          }),
        }),
      });
    }

    const target = this.substitutionTarget(current.plan.document, text);
    if (target.status !== 'RESOLVED') {
      return Object.freeze({
        status: 'CLARIFICATION',
        message:
          target.status === 'AMBIGUOUS'
            ? 'Encontrei mais de um exercício possível. Qual exercício exato você quer trocar?'
            : 'Não encontrei esse exercício no plano atual. Diga o nome como aparece na sessão para eu não inventar uma substituição.',
      });
    }
    const reason = this.substitutionReason(text);
    const equipment =
      reason === 'EQUIPMENT'
        ? Object.freeze({
            status: 'CONFIRMED' as const,
            value: Object.freeze(
              current.plan.document.strategy.authorizedEquipment.filter(
                (item) => item !== 'MACHINE',
              ),
            ),
          })
        : declared.equipment;
    return Object.freeze({
      status: 'READY',
      previousPlan: current.plan.document,
      recognizedContext: Object.freeze({
        ...declared,
        artifactType: WORKOUT_ARTIFACT_TYPE.EXERCISE_SUBSTITUTION,
        modality: this.modality(current.plan.document.modality),
        equipment,
        purpose: 'ADAPTATION',
        mutation: Object.freeze({
          kind: 'EXERCISE_SUBSTITUTION',
          sourceActivityKey: target.activity.activityKey,
          sourceActivityName: target.activity.name,
          reason,
        }),
      }),
    });
  }

  private kind(
    text: string,
  ): 'ADAPTATION' | 'SUBSTITUTION' | 'AMBIGUOUS_MODALITY' | null {
    if (/\bnovo plano\b/u.test(text)) return null;
    if (
      /\b(vou comecar a correr|quero comecar a correr)\b/u.test(text) &&
      !/\b(adapte|adapta|ajuste|ajusta|inclua|incluir)\b/u.test(text)
    ) {
      return 'AMBIGUOUS_MODALITY';
    }
    if (
      /\b(troque|trocar|substitua|substituir|nao posso fazer|nao tenho essa maquina|sem essa maquina)\b/u.test(
        text,
      )
    ) {
      return 'SUBSTITUTION';
    }
    if (
      /\b(agora|adapte|adapta|ajuste|ajusta|inclua|incluir|so tenho|so vou treinar|vou treinar so|focar mais)\b/u.test(
        text,
      ) &&
      /\b(minutos?|vezes?|dias?|semana|foco|focar|peito|costas|pernas?|corrida|correr|modalidade)\b/u.test(
        text,
      )
    ) {
      return 'ADAPTATION';
    }
    return null;
  }

  private adaptationReason(
    context: WorkoutRecognizedContext,
  ): NonNullable<WorkoutRecognizedContext['mutation']>['reason'] | null {
    if (context.sessionDurationMinutes) return 'DURATION';
    if (context.weeklyFrequency) return 'FREQUENCY';
    if (context.muscleFocus) return 'MUSCLE_FOCUS';
    if (context.modality) return 'MODALITY';
    return null;
  }

  private substitutionTarget(
    plan: WorkoutPlanV2,
    text: string,
  ):
    | Readonly<{ status: 'RESOLVED'; activity: WorkoutActivityV2 }>
    | Readonly<{ status: 'MISSING' | 'AMBIGUOUS' }> {
    if (/\b(esse|este) exercicio\b/u.test(text)) {
      return Object.freeze({ status: 'MISSING' });
    }
    const activities = plan.sessions.flatMap((session) =>
      session.blocks.flatMap((block) => block.activities),
    );
    let matches = activities.filter((activity) =>
      text.includes(this.normalize(activity.name)),
    );
    if (
      /\b(essa maquina|sem essa maquina|nao tenho essa maquina)\b/u.test(text)
    ) {
      matches = activities.filter((activity) =>
        activity.equipment.includes('MACHINE'),
      );
    }
    if (matches.length === 0) return Object.freeze({ status: 'MISSING' });
    if (matches.length > 1) return Object.freeze({ status: 'AMBIGUOUS' });
    return Object.freeze({ status: 'RESOLVED', activity: matches[0] });
  }

  private substitutionReason(
    text: string,
  ): NonNullable<WorkoutRecognizedContext['mutation']>['reason'] {
    if (/\b(maquina|equipamento)\b/u.test(text)) return 'EQUIPMENT';
    return /\b(dor|lesao|nao posso)\b/u.test(text)
      ? 'LIMITATION'
      : 'PREFERENCE';
  }

  private modality(value: WorkoutModality) {
    return Object.freeze({ status: 'CONFIRMED' as const, value });
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }
}
