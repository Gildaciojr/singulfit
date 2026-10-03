import { Injectable, Optional } from '@nestjs/common';
import {
  ConversationPlanReferenceService,
  type ConversationPlanReferenceInput,
} from '../../conversation/understanding/conversation-plan-reference.service';
import { ConversationReferenceResolverService } from '../../conversation/understanding/conversation-reference-resolver.service';
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
import { isFullPlanReplacementRequest } from '../../conversation/understanding/full-plan-replacement.policy';

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
  constructor(
    private readonly reader: CurrentWorkoutPlanReaderService,
    @Optional()
    private readonly recentReferences?: ConversationPlanReferenceService,
  ) {}

  async resolve(
    userId: string,
    message: string | undefined,
    declared: WorkoutRecognizedContext,
    referenceInput?: ConversationPlanReferenceInput,
  ): Promise<WorkoutPlanMutationResolution> {
    const text = this.normalize(message ?? '');
    const kind = this.kind(text);
    if (!kind) return Object.freeze({ status: 'NOT_A_MUTATION' });
    const current = await this.reader.read(userId);
    if (current.status !== 'AVAILABLE' || current.plan.userId !== userId) {
      if (kind === 'SUBSTITUTION_CANDIDATE' || kind === 'AMBIGUOUS_MODALITY') {
        return Object.freeze({ status: 'NOT_A_MUTATION' });
      }
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
          ...this.mergeDefined(
            this.previousContext(current.plan.document),
            declared,
          ),
          artifactType: WORKOUT_ARTIFACT_TYPE.PLAN_ADAPTATION,
          purpose: 'ADAPTATION',
          mutation: Object.freeze({
            kind: 'PLAN_ADAPTATION',
            inheritedProfileFields: this.inheritedFields(declared),
            sourceActivityKey: null,
            sourceActivityName: null,
            reason,
          }),
        }),
      });
    }

    let target = this.substitutionTarget(current.plan.document, text);
    if (
      target.status !== 'RESOLVED' &&
      referenceInput &&
      this.recentReferences
    ) {
      const recent =
        await this.recentReferences.recentAssistant(referenceInput);
      if (recent) {
        const presented = current.plan.document.sessions.filter(
          (session) =>
            this.normalize(recent).includes(this.normalize(session.label)) &&
            session.blocks
              .flatMap((block) => block.activities)
              .some((activity) =>
                this.normalize(recent).includes(this.normalize(activity.name)),
              ),
        );
        if (presented.length === 1) {
          const scoped = { ...current.plan.document, sessions: presented };
          target = this.substitutionTarget(scoped, text);
          const ordinal = new ConversationReferenceResolverService().ordinal(
            text,
          );
          if (
            target.status !== 'RESOLVED' &&
            ordinal !== null &&
            /\b(primeir[oa]|segund[oa]|terceir[oa]|quart[oa]|quint[oa]|sext[oa]|setim[oa])\b/u.test(
              text,
            )
          ) {
            const activity = presented[0].blocks.flatMap(
              (block) => block.activities,
            )[ordinal - 1];
            if (activity)
              target = Object.freeze({ status: 'RESOLVED' as const, activity });
          }
        }
        if (
          target.status !== 'RESOLVED' &&
          /\b(esse|este) exercicio\b/u.test(text)
        ) {
          const mentioned = current.plan.document.sessions
            .flatMap((session) =>
              session.blocks.flatMap((block) => block.activities),
            )
            .filter((activity) =>
              this.normalize(recent).includes(this.normalize(activity.name)),
            );
          if (mentioned.length === 1)
            target = Object.freeze({
              status: 'RESOLVED' as const,
              activity: mentioned[0],
            });
        }
      }
    }
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
                (item) => !target.activity.equipment.includes(item),
              ),
            ),
          })
        : undefined;
    return Object.freeze({
      status: 'READY',
      previousPlan: current.plan.document,
      recognizedContext: Object.freeze({
        ...this.mergeDefined(
          this.previousContext(current.plan.document),
          declared,
        ),
        artifactType: WORKOUT_ARTIFACT_TYPE.EXERCISE_SUBSTITUTION,
        ...(equipment ? { equipment } : {}),
        purpose: 'ADAPTATION',
        mutation: Object.freeze({
          kind: 'EXERCISE_SUBSTITUTION',
          inheritedProfileFields: this.inheritedFields(declared).filter(
            (field) => field !== 'equipment' || !equipment,
          ),
          sourcePlanId: current.plan.aggregateId,
          sourceCalendar: current.plan.calendar,
          sourceActivityKey: target.activity.activityKey,
          sourceActivityName: target.activity.name,
          reason,
        }),
      }),
    });
  }

  private kind(
    text: string,
  ):
    | 'ADAPTATION'
    | 'SUBSTITUTION'
    | 'SUBSTITUTION_CANDIDATE'
    | 'AMBIGUOUS_MODALITY'
    | null {
    if (isFullPlanReplacementRequest(text)) return null;
    if (
      /\b(vou comecar a correr|quero comecar a correr)\b/u.test(text) &&
      !/\b(adapte|adapta|ajuste|ajusta|inclua|incluir)\b/u.test(text)
    ) {
      return 'AMBIGUOUS_MODALITY';
    }
    if (
      /\b(troque|trocar|substitua|substituir|nao posso fazer|nao consigo fazer|nao tenho essa maquina|sem essa maquina|do[i]? (?:meu|o) joelho|doendo (?:meu|o) joelho|outro exercicio)\b/u.test(
        text,
      )
    ) {
      return 'SUBSTITUTION';
    }
    if (/\bnao tenho\b/u.test(text)) return 'SUBSTITUTION_CANDIDATE';
    if (
      /\b(agora|adapte|adapta|adaptar|ajuste|ajusta|inclua|incluir|so tenho|so vou treinar|vou treinar so|focar mais)\b/u.test(
        text,
      ) &&
      /\b(minutos?|vezes?|dias?|semana|foco|focar|peito|costas|pernas?|corrida|correr|modalidade|treino|treinar|plano)\b/u.test(
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
    const activities = plan.sessions.flatMap((session) =>
      session.blocks.flatMap((block) => block.activities),
    );
    let matches = activities.filter((activity) =>
      text.includes(this.normalize(activity.name)),
    );
    if (matches.length === 0) {
      const named =
        /^(?:troque|trocar|substitua|substituir|nao tenho) (?:o |a )?(.+?)(?: por .+)?$/u.exec(
          text,
        )?.[1];
      if (named)
        matches = activities.filter((activity) => {
          const name = this.normalize(activity.name);
          return name === named || name.startsWith(`${named} `);
        });
    }
    if (
      matches.length === 0 &&
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
    if (/\b(maquina|equipamento|nao tenho)\b/u.test(text)) return 'EQUIPMENT';
    return /\b(dor|doi|doendo|lesao|nao posso|nao consigo)\b/u.test(text)
      ? 'LIMITATION'
      : 'PREFERENCE';
  }

  private modality(value: WorkoutModality) {
    return Object.freeze({ status: 'CONFIRMED' as const, value });
  }

  private previousContext(plan: WorkoutPlanV2): WorkoutRecognizedContext {
    return Object.freeze({
      modality: this.modality(plan.modality),
      objective: Object.freeze({ ...plan.strategy.objective }),
      experience: Object.freeze({ ...plan.strategy.experience }),
      weeklyFrequency: Object.freeze({
        status: 'CONFIRMED' as const,
        value: plan.strategy.sessionCount,
      }),
      sessionDurationMinutes: Object.freeze({
        ...plan.strategy.sessionDurationMinutes,
      }),
      environment: Object.freeze({ ...plan.strategy.environment }),
      equipment: Object.freeze({
        status: 'CONFIRMED' as const,
        value: Object.freeze([...plan.strategy.authorizedEquipment]),
      }),
      muscleFocus: Object.freeze({
        status: 'CONFIRMED' as const,
        value: Object.freeze([...plan.strategy.muscleFocus]),
      }),
    });
  }

  private mergeDefined(
    previous: WorkoutRecognizedContext,
    declared: WorkoutRecognizedContext,
  ): WorkoutRecognizedContext {
    return Object.freeze({
      ...previous,
      ...Object.fromEntries(
        Object.entries(declared).filter(([, value]) => value !== undefined),
      ),
    });
  }

  private inheritedFields(
    declared: WorkoutRecognizedContext,
  ): readonly (keyof WorkoutRecognizedContext)[] {
    const fields: readonly (keyof WorkoutRecognizedContext)[] = [
      'modality',
      'objective',
      'experience',
      'weeklyFrequency',
      'sessionDurationMinutes',
      'environment',
      'equipment',
      'muscleFocus',
    ];
    return Object.freeze(
      fields.filter((field) => declared[field] === undefined),
    );
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
