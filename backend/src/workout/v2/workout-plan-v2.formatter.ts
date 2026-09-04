import { Injectable } from '@nestjs/common';
import type {
  WorkoutActivityV2,
  WorkoutPlanV2,
} from './workout-plan-v2.contract';

@Injectable()
export class WorkoutPlanV2Formatter {
  format(plan: WorkoutPlanV2): readonly string[] {
    const messages: string[] = [];
    const secondary = plan.secondaryObjectives?.length
      ? `\nObjetivos complementares: ${plan.secondaryObjectives.join(', ')}`
      : '';
    const header = `*${plan.title}*\nModalidade: ${plan.modality}\nObjetivo: ${plan.objective}${secondary}`;
    if (plan.sessions.length === 0) return Object.freeze([header]);
    for (const session of plan.sessions) {
      const lines = [
        `${header}\n\n*Sessão ${session.sequence} — ${session.label}*\n${session.estimatedDurationMinutes} min`,
      ];
      for (const block of session.blocks) {
        lines.push(`\n*${block.title}*`);
        for (const activity of block.activities) {
          lines.push(`\n*${activity.name}*\n${this.parameters(activity)}`);
          if (activity.instruction.trim()) lines.push(activity.instruction);
          if (activity.alerts.length > 0)
            lines.push(`Atenção: ${activity.alerts.join('; ')}`);
        }
      }
      messages.push(lines.join('\n'));
    }
    return Object.freeze(messages);
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
