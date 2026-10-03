import { Injectable } from '@nestjs/common';
import type {
  WorkoutActivityV2,
  WorkoutPlanV2,
  WorkoutSessionV2,
} from './workout-plan-v2.contract';
import type { WorkoutObjective } from './workout-planning-context.contract';
import type { WorkoutModality } from './workout-planning-artifact.contract';
import { ConversationPublicAnswerBoundaryService } from '../../conversation/runtime/conversation-public-answer-boundary.service';

@Injectable()
export class WorkoutPlanV2Formatter {
  private readonly publicBoundary =
    new ConversationPublicAnswerBoundaryService();
  format(plan: WorkoutPlanV2): readonly string[] {
    const messages: string[] = [];
    const secondary = plan.secondaryObjectives?.length
      ? `\nObjetivos complementares: ${plan.secondaryObjectives.map((objective) => this.objective(objective)).join(', ')}`
      : '';
    const header = `*${plan.title}*\nModalidade: ${this.modality(plan.modality)}\nObjetivo: ${this.objective(plan.objective)}${secondary}`;
    if (plan.sessions.length === 0)
      return Object.freeze([this.publicText(header)]);
    for (const session of plan.sessions) {
      messages.push(
        this.publicText(`${header}\n\n${this.formatSession(session, ' — ')}`),
      );
    }
    return Object.freeze(messages);
  }

  formatSession(session: WorkoutSessionV2, separator = ': '): string {
    return this.publicText(
      [
        `*Sessão ${session.sequence}${separator}${session.label}*\n${session.estimatedDurationMinutes} min`,
        ...session.blocks.flatMap((block) => [
          `\n*${block.title}*`,
          ...block.activities.map((activity) => this.formatActivity(activity)),
        ]),
      ].join('\n'),
    );
  }

  formatActivity(activity: WorkoutActivityV2): string {
    return this.publicText(
      [
        `\n*${activity.name}*\n${this.parameters(activity)}`,
        ...(activity.instruction.trim() ? [activity.instruction] : []),
        ...(activity.alerts.length > 0
          ? [`Atenção: ${activity.alerts.join('; ')}`]
          : []),
      ].join('\n'),
    );
  }

  private publicText(text: string): string {
    return (
      this.publicBoundary.projectText(text) ??
      'Não consegui apresentar esse trecho do treino com segurança. Tente consultar seu treino novamente.'
    );
  }

  private objective(value: WorkoutObjective): string {
    const labels: Readonly<Record<WorkoutObjective, string>> = {
      WEIGHT_LOSS: 'emagrecimento',
      HYPERTROPHY: 'hipertrofia',
      STRENGTH: 'força',
      CONDITIONING: 'condicionamento',
      GENERAL_HEALTH: 'saúde e bem-estar',
      MOBILITY: 'mobilidade',
      ACTIVE_RECOVERY: 'recuperação ativa',
      COMPLETE_DISTANCE: 'completar a distância desejada',
    };
    return labels[value];
  }

  private modality(value: WorkoutModality): string {
    const labels: Readonly<Record<WorkoutModality, string>> = {
      GYM_STRENGTH: 'musculação',
      HOME_WORKOUT: 'treino em casa',
      CROSSFIT: 'CrossFit',
      RUNNING: 'corrida',
      CYCLING: 'ciclismo',
      WALKING: 'caminhada',
      FUNCTIONAL: 'treino funcional',
      MOBILITY: 'mobilidade',
      GENERAL_FITNESS: 'condicionamento geral',
      OUTDOOR_WORKOUT: 'treino ao ar livre',
      CALISTHENICS: 'calistenia',
      CARDIO_CONDITIONING: 'condicionamento cardiovascular',
      ACTIVE_RECOVERY: 'recuperação ativa',
    };
    return labels[value];
  }

  private parameters(activity: WorkoutActivityV2): string {
    if (activity.kind === 'STRENGTH')
      return `${activity.sets} × ${activity.repetitions}\nDescanso: ${activity.restSeconds} s\nEquipamento: ${this.equipment(activity.equipment)}\nIntensidade: ${this.intensity(activity.intensity)}`;
    if (activity.kind === 'TIMED')
      return `${activity.rounds} rodada(s) · ${activity.durationSeconds} s no total${activity.workSeconds === null ? '' : `\nTrabalho: ${activity.workSeconds} s`}${activity.recoverySeconds === null ? '' : ` · Recuperação: ${activity.recoverySeconds} s`}\nEquipamento: ${this.equipment(activity.equipment)}\nIntensidade: ${this.intensity(activity.intensity)}`;
    if (activity.kind === 'ENDURANCE')
      return `${activity.durationMinutes} min${activity.distanceKm === null ? '' : ` · ${activity.distanceKm} km`}\nIntensidade: ${this.intensity(activity.intensity)}`;
    return activity.durationSeconds !== null
      ? `${activity.durationSeconds}s.`
      : activity.holdSeconds !== null
        ? `sustentar ${activity.holdSeconds}s.`
        : `${activity.repetitions ?? 'movimento controlado'}.`;
  }

  private equipment(values: readonly string[]): string {
    const labels: Readonly<Record<string, string>> = Object.freeze({
      BARBELL: 'barra',
      DUMBBELL: 'halteres',
      KETTLEBELL: 'kettlebell',
      MACHINE: 'máquina',
      CABLE: 'cabo/crossover',
      BENCH: 'banco',
      PULL_UP_BAR: 'barra fixa',
      RESISTANCE_BAND: 'elástico',
      BODYWEIGHT: 'peso corporal',
      BIKE: 'bicicleta',
      TREADMILL: 'esteira',
      ROW_ERGOMETER: 'remo ergométrico',
    });
    return values.length > 0
      ? values.map((value) => labels[value] ?? value).join(' + ')
      : 'nenhum';
  }

  private intensity(value: string): string {
    return value === 'LIGHT'
      ? 'leve'
      : value === 'HIGH'
        ? 'alta'
        : value === 'CONVERSATIONAL'
          ? 'ritmo conversacional'
          : 'moderada';
  }
}
