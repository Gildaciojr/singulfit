import { Injectable } from '@nestjs/common';
import { presentWorkoutMetric } from './workout-prescription.policy';
import {
  projectWorkoutActivity,
  projectWorkoutHeading,
  projectWorkoutProgression,
} from './workout-public-projection';
import {
  workoutCandidatePublicTextIssues,
  workoutPublicTextIssues,
  type WorkoutPublicTextConstraints,
} from './workout-public-text.policy';
import { presentWorkoutSeconds } from './workout-duration.presenter';
import type {
  WorkoutActivityV2,
  WorkoutPlanV2,
  WorkoutSessionV2,
  WorkoutMetricPrescription,
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
    if (workoutCandidatePublicTextIssues(plan, plan.strategy).length)
      return Object.freeze([
        'Não consegui apresentar esse treino com segurança. Peça uma nova orientação.',
      ]);
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
    const header = `🏋️ *${this.publicHeading(plan.title, 'Sua semana de treino')}*\n\n🎯 *Objetivo:* ${this.objective(plan.objective)}\n🏃 *Modalidade:* ${this.modality(plan.modality)}${environment}\n📅 *Frequência:* ${plan.sessions.length}x por semana${secondary}`;
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
          plan.strategy,
        )}`,
      );
    }
    const progression = [
      ...new Set(
        plan.progression.flatMap((rule) => {
          const text = projectWorkoutProgression(rule, plan.strategy);
          return text ? [text] : [];
        }),
      ),
    ];
    if (progression.length)
      messages.push(
        this.publicText(
          `📈 *Progressão*\n\n${progression.map((text) => `• ${text}`).join('\n')}`,
        ),
      );
    return Object.freeze(messages);
  }

  formatSession(
    session: WorkoutSessionV2,
    separator = ': ',
    weekday?: string,
    constraints?: WorkoutPublicTextConstraints,
  ): string {
    const boundary = constraints ?? {
      authorizedEquipment: [
        ...new Set(
          session.blocks.flatMap((block) =>
            block.activities.flatMap((activity) => activity.equipment),
          ),
        ),
      ],
      intensityPolicy: {
        exactLoadAllowed: false,
        exactPaceAllowed: false,
        exactPowerAllowed: false,
      },
    };
    if (
      workoutPublicTextIssues(
        [session.label, ...session.blocks.map((block) => block.title)].join(
          '\n',
        ),
        boundary,
        session.sessionKey,
      ).length
    )
      return 'Não consegui apresentar essa sessão com segurança.';
    let ordinal = 0;
    const labels: Readonly<Record<string, string>> = {
      WARM_UP: '🔥 *Aquecimento*',
      MOBILITY: '🧩 *Mobilidade*',
      STRENGTH: '💪 *Força principal*',
      HYPERTROPHY: '💪 *Acessórios*',
      CORE: '🧱 *Core*',
      ENDURANCE: '🏃 *Condicionamento*',
      CONDITIONING: '🏃 *Condicionamento*',
      TECHNIQUE: '🧩 *Técnica*',
      GYMNASTICS: '🧩 *Ginástica*',
      WEIGHTLIFTING: '🏋️ *Levantamento olímpico — técnica*',
      RECOVERY: '🧘 *Recuperação*',
      COOLDOWN: '🧘 *Finalização*',
    };
    return [
      this.publicText(
        `📅 *${weekday ?? `Sessão ${session.sequence}`}${separator}${this.publicHeading(session.label, 'Treino programado', session.sequence)}*\n⏱️ *Duração estimada:* ~${session.estimatedDurationMinutes} min`,
      ),
      ...session.blocks
        .filter((block) => block.activities.length > 0)
        .map((block) =>
          [
            this.publicText(
              labels[block.type] ??
                `💪 *${this.publicHeading(block.title, 'Bloco de treino')}*`,
            ),
            ...(block.work &&
            !(
              (block.type === 'WARM_UP' || block.type === 'COOLDOWN') &&
              block.work.format === 'CONTINUOUS' &&
              block.work.rounds === 1
            )
              ? [
                  `*${this.workFormat(block.work.format)}* · ${presentWorkoutSeconds(block.work.durationSeconds)}${block.work.rounds !== null && !(block.work.format === 'CONTINUOUS' && block.work.rounds === 1) ? ` · ${block.work.rounds} ${block.work.rounds === 1 ? 'rodada' : 'rodadas'}` : ''}${block.work.intervalSeconds !== null ? ` · intervalos de ${presentWorkoutSeconds(block.work.intervalSeconds)}` : ''}`,
                  ...(block.work.format === 'EMOM'
                    ? ['Alterne os movimentos na ordem abaixo, um por minuto.']
                    : []),
                ]
              : []),
            ...(block.work
              ? block.work.movementActivityKeys.flatMap((key) =>
                  block.activities.filter(
                    (activity) => activity.activityKey === key,
                  ),
                )
              : block.activities
            ).map((activity) =>
              this.formatActivity(activity, ++ordinal, boundary),
            ),
          ].join('\n\n'),
        ),
    ].join('\n\n');
  }

  formatActivity(
    activity: WorkoutActivityV2,
    ordinal?: number,
    constraints?: WorkoutPublicTextConstraints,
  ): string {
    const boundary = constraints ?? {
      authorizedEquipment: activity.equipment,
      intensityPolicy: {
        exactLoadAllowed: false,
        exactPaceAllowed: false,
        exactPowerAllowed: false,
      },
    };
    if (
      activity.equipment.some(
        (equipment) => !boundary.authorizedEquipment.includes(equipment),
      )
    )
      return 'Não consegui apresentar essa atividade com segurança.';
    const projected = projectWorkoutActivity(activity);
    const presentationUnsafe = [
      activity.name,
      activity.instruction,
      ...activity.alerts,
    ].some((text) => this.publicBoundary.projectStructuredText(text) === null);
    return this.publicText(
      [
        `*${ordinal === undefined ? '' : `${ordinal}. `}${projected.displayName}*\n${this.parameters(activity, projected.repetitions)}`,
        ...(activity.prescription?.load
          ? [this.metricLine(activity.prescription.load)]
          : []),
        ...(activity.prescription?.enduranceMetrics.map((metric) =>
          this.metricLine(metric),
        ) ?? []),
        ...(activity.prescription?.effort
          ? [
              `• Esforço: ${activity.prescription.effort.kind === 'TECHNICAL_FAILURE' ? 'até a falha técnica' : activity.prescription.effort.kind === 'MAXIMUM_TECHNICAL_REPS' ? 'máximo de repetições mantendo técnica' : `${activity.prescription.effort.kind} ${activity.prescription.effort.value}`}`,
            ]
          : []),
        ...(projected.instruction.trim()
          ? [`💡 ${projected.instruction}`]
          : []),
        ...(projected.alerts.length > 0
          ? [`⚠️ ${projected.alerts.join('; ')}`]
          : []),
        ...(presentationUnsafe
          ? [
              'Não consegui apresentar o texto original com segurança; mantive os dados estruturados.',
            ]
          : []),
      ].join('\n\n'),
    );
  }

  private metricLine(metric: WorkoutMetricPrescription): string {
    const label =
      metric.basis === 'USER_REPORTED'
        ? 'Referência informada por você'
        : metric.basis === 'OBSERVED'
          ? 'Referência registrada'
          : ['LOAD_KG', 'PERCENT_1RM'].includes(metric.kind)
            ? 'Carga sugerida'
            : 'Meta sugerida';
    return `• ${label}: ${presentWorkoutMetric(metric)}`;
  }

  private publicText(text: string): string {
    return (
      this.publicBoundary.projectStructuredText(text) ??
      'Não consegui apresentar esse trecho do treino com segurança. Tente consultar seu treino novamente.'
    );
  }

  private publicHeading(
    text: string,
    fallback: string,
    sequence?: number,
  ): string {
    return this.publicBoundary.projectStructuredText(text) === null
      ? 'Não consegui apresentar esse trecho com segurança.'
      : projectWorkoutHeading(text, fallback, sequence);
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

  private parameters(
    activity: WorkoutActivityV2,
    publicRepetitions: string | null,
  ): string {
    const common = `• Equipamento: ${this.equipment(activity.equipment)}\n• Intensidade: ${this.intensity('intensity' in activity ? activity.intensity : 'LIGHT')}`;
    const repetitions = (value: string): string => {
      const normalized = value.replace(/(?<=\d)\s*-\s*(?=\d)/gu, '–');
      return /repetiç|reps/iu.test(normalized) ||
        !/^\d+(?:\s*[-–a]\s*\d+)?(?:\s*por (?:lado|perna|braco))?$/iu.test(
          normalized,
        )
        ? normalized
        : normalized.replace(
            /^(\d+(?:\s*[-–a]\s*\d+)?)(\s*por (?:lado|perna|braco))?$/iu,
            (_match: string, count: string, side: string | undefined) =>
              `${count} ${count === '1' ? 'repetição' : 'repetições'}${side ?? ''}`,
          );
    };
    if (activity.kind === 'STRENGTH')
      return `• ${activity.sets} ${activity.sets === 1 ? 'série' : 'séries'}${publicRepetitions ? ` × ${repetitions(publicRepetitions)}` : ''}\n• Descanso: ${presentWorkoutSeconds(activity.restSeconds)}\n${common}`;
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
        ...(publicRepetitions !== null
          ? [`• Repetições: ${repetitions(publicRepetitions)}`]
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
      ? values
          .map((value) => labels[value] ?? 'equipamento não confirmado')
          .join(' + ')
      : 'nenhum';
  }

  private workFormat(
    format: NonNullable<
      import('./workout-plan-v2.contract').WorkoutBlockV2['work']
    >['format'],
  ): string {
    const labels = {
      AMRAP: 'AMRAP',
      EMOM: 'EMOM',
      FOR_TIME: 'Por tempo',
      INTERVAL: 'Intervalado',
      ROUNDS: 'Circuito por rodadas',
      CHIPPER: 'Circuito em sequência',
      CONTINUOUS: 'Circuito contínuo',
      OTHER: 'Bloco de trabalho',
    } as const;
    return labels[format];
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
