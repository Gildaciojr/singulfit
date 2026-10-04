import { Injectable } from '@nestjs/common';
import { presentWorkoutSeconds } from './workout-duration.presenter';
import type {
  WorkoutActivityV2,
  WorkoutPlanV2,
  WorkoutSessionV2,
} from './workout-plan-v2.contract';
import type {
  WorkoutEnvironment,
  WorkoutObjective,
} from './workout-planning-context.contract';
import type { WorkoutModality } from './workout-planning-artifact.contract';
import { ConversationPublicAnswerBoundaryService } from '../../conversation/runtime/conversation-public-answer-boundary.service';

@Injectable()
export class WorkoutPlanV2Formatter {
  private readonly publicBoundary =
    new ConversationPublicAnswerBoundaryService();
  format(
    plan: WorkoutPlanV2,
    context: {
      readonly preferredName?: string | null;
      readonly weekdays?: readonly (string | null)[];
    } = {},
  ): readonly string[] {
    const messages: string[] = [];
    const secondary = plan.secondaryObjectives?.length
      ? `\nObjetivos complementares: ${plan.secondaryObjectives.map((objective) => this.objective(objective)).join(', ')}`
      : '';
    const environments: Readonly<Record<WorkoutEnvironment, string>> = {
      FULL_GYM: 'academia completa',
      LIMITED_GYM: 'academia com equipamentos limitados',
      CROSSFIT_BOX: 'box de CrossFit',
      HOME: 'em casa',
      OUTDOOR: 'ao ar livre',
      STREET: 'rua',
      TRACK: 'pista',
      TRAIL: 'trilha',
      ROAD: 'estrada',
      INDOOR: 'ambiente interno',
      INDOOR_BIKE: 'bicicleta indoor',
      OUTDOOR_BIKE: 'bicicleta ao ar livre',
      NO_EQUIPMENT: 'sem equipamentos',
    };
    const environment =
      plan.strategy.environment.status === 'CONFIRMED'
        ? `\n📍 *Ambiente:* ${environments[plan.strategy.environment.value]}`
        : '';
    const header = `🏋️ *${this.publicText(plan.title)}*\n\n🎯 *Objetivo:* ${this.objective(plan.objective)}\n🏃 *Modalidade:* ${this.modality(plan.modality)}${environment}\n📅 *Frequência:* ${plan.sessions.length}x por semana${secondary}`;
    if (plan.sessions.length === 0)
      return Object.freeze([this.publicText(header)]);
    const duration =
      plan.strategy.sessionDurationMinutes.status !== 'NOT_SET'
        ? `, com cerca de ${plan.strategy.sessionDurationMinutes.value} min por sessão`
        : '';
    messages.push(
      this.publicText(
        `${context.preferredName ? `${this.publicText(context.preferredName)}, preparei` : 'Preparei'} ${plan.sessions.length} ${plan.sessions.length === 1 ? 'sessão' : 'sessões'} para sua semana${duration}. Veja a sequência e as orientações abaixo.\n\n${header}`,
      ),
    );
    for (const [index, session] of plan.sessions.entries()) {
      const days: Readonly<Record<string, string>> = {
        MONDAY: 'Segunda',
        TUESDAY: 'Terça',
        WEDNESDAY: 'Quarta',
        THURSDAY: 'Quinta',
        FRIDAY: 'Sexta',
        SATURDAY: 'Sábado',
        SUNDAY: 'Domingo',
      };
      messages.push(
        `${index > 0 ? '━━━━━━━━━━━━━━\n\n' : ''}${this.formatSession(
          session,
          ' — ',
          days[context.weekdays?.[index] ?? ''],
        )}`,
      );
    }
    return Object.freeze(messages);
  }

  formatSession(
    session: WorkoutSessionV2,
    separator = ': ',
    weekday?: string,
  ): string {
    let ordinal = 0;
    const labels: Readonly<Record<string, string>> = {
      WARM_UP: '🔥 *Aquecimento*',
      MOBILITY: '🧩 *Mobilidade*',
      STRENGTH: '💪 *Força principal*',
      ENDURANCE: '🏃 *Condicionamento*',
      CONDITIONING: '🏃 *Condicionamento*',
      TECHNIQUE: '🧩 *Técnica*',
      RECOVERY: '🧘 *Recuperação*',
      COOLDOWN: '🧘 *Finalização*',
    };
    return [
      this.publicText(
        `📅 *${weekday ?? `Sessão ${session.sequence}`}${separator}${this.publicText(session.label)}*\n⏱️ *Duração estimada:* ~${session.estimatedDurationMinutes} min`,
      ),
      ...session.blocks
        .filter((block) => block.activities.length > 0)
        .map((block) =>
          [
            this.publicText(
              labels[block.type] ?? `💪 *${this.publicText(block.title)}*`,
            ),
            ...block.activities.map((activity) =>
              this.formatActivity(activity, ++ordinal),
            ),
          ].join('\n\n'),
        ),
    ].join('\n\n');
  }

  formatActivity(activity: WorkoutActivityV2, ordinal?: number): string {
    return this.publicText(
      [
        `*${ordinal === undefined ? '' : `${ordinal}. `}${this.publicText(activity.name)}*\n${this.parameters(activity)}`,
        ...(activity.instruction.trim()
          ? [`💡 ${this.publicText(activity.instruction)}`]
          : []),
        ...(activity.alerts.length > 0
          ? [
              `⚠️ ${activity.alerts.map((alert) => this.publicText(alert)).join('; ')}`,
            ]
          : []),
      ].join('\n\n'),
    );
  }

  private publicText(text: string): string {
    return (
      this.publicBoundary.projectStructuredText(text) ??
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
    const common = `• Equipamento: ${this.equipment(activity.equipment)}\n• Intensidade: ${this.intensity('intensity' in activity ? activity.intensity : 'LIGHT')}`;
    const repetitions = (value: string): string => {
      const normalized = value.replace(/(?<=\d)\s*-\s*(?=\d)/gu, '–');
      return /repetiç|reps/iu.test(normalized) ||
        !/^\d+(?:\s*[-–a]\s*\d+)?(?:\s*por lado)?$/iu.test(normalized)
        ? normalized
        : normalized.replace(
            /^(\d+(?:\s*[-–a]\s*\d+)?)(\s*por lado)?$/iu,
            (_match: string, count: string, side: string | undefined) =>
              `${count} ${count === '1' ? 'repetição' : 'repetições'}${side ?? ''}`,
          );
    };
    if (activity.kind === 'STRENGTH')
      return `• ${activity.sets} ${activity.sets === 1 ? 'série' : 'séries'} × ${repetitions(activity.repetitions)}\n• Descanso: ${presentWorkoutSeconds(activity.restSeconds)}\n${common}`;
    if (activity.kind === 'TIMED')
      return [
        ...(activity.workSeconds !== null
          ? [
              activity.rounds > 1
                ? `• ${activity.rounds} rodadas × ${presentWorkoutSeconds(activity.workSeconds)} de trabalho`
                : `• Trabalho: ${presentWorkoutSeconds(activity.workSeconds)}`,
            ]
          : activity.rounds > 1
            ? [`• ${activity.rounds} rodadas`]
            : []),
        ...(activity.rounds > 1 && activity.recoverySeconds !== null
          ? [
              `• Recuperação: ${presentWorkoutSeconds(activity.recoverySeconds)} entre rodadas`,
            ]
          : []),
        `• Tempo total: ${presentWorkoutSeconds(activity.durationSeconds)}`,
        ...(activity.rounds > 1 &&
        (activity.workSeconds === null || activity.recoverySeconds === null)
          ? [
              '⚠️ Prescrição intervalada incompleta: confirme trabalho e recuperação antes de executar.',
            ]
          : []),
        common,
      ].join('\n');
    if (activity.kind === 'ENDURANCE')
      return `• Tempo: ${activity.durationMinutes} min${activity.distanceKm === null ? '' : `\n• Distância: ${activity.distanceKm} km`}\n• Intensidade: ${this.intensity(activity.intensity)}`;
    return (
      [
        ...(activity.durationSeconds !== null
          ? [
              `• Tempo total: ${presentWorkoutSeconds(activity.durationSeconds)}`,
            ]
          : []),
        ...(activity.holdSeconds !== null
          ? [
              `• Sustentação: ${presentWorkoutSeconds(activity.holdSeconds)} por posição`,
            ]
          : []),
        ...(activity.repetitions !== null
          ? [`• Repetições: ${repetitions(activity.repetitions)}`]
          : []),
      ].join('\n') || 'Movimento controlado.'
    );
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
