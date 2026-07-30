import { Injectable } from '@nestjs/common';
import type {
  WorkoutActivityV2,
  WorkoutPlanV2,
} from './workout-plan-v2.contract';

@Injectable()
export class WorkoutPlanV2Formatter {
  format(plan: WorkoutPlanV2): readonly string[] {
    const messages: string[] = [];
    const header = `${plan.title}\nModalidade: ${plan.modality}\nObjetivo: ${plan.objective}`;
    if (plan.sessions.length === 0) return Object.freeze([header]);
    for (const session of plan.sessions) {
      const lines = [
        `${header}\n\nSessão ${session.sequence}: ${session.label} (${session.estimatedDurationMinutes} min)`,
      ];
      for (const block of session.blocks) {
        lines.push(`\n${block.title}`);
        for (const activity of block.activities) {
          lines.push(`• ${activity.name}: ${this.parameters(activity)}`);
        }
      }
      const text = lines.join('\n');
      messages.push(
        text.length <= 3500 ? text : text.slice(0, 3497).trimEnd() + '...',
      );
    }
    return Object.freeze(messages);
  }

  private parameters(activity: WorkoutActivityV2): string {
    if (activity.kind === 'STRENGTH')
      return `${activity.sets} séries de ${activity.repetitions}, descanso ${activity.restSeconds}s, intensidade ${activity.intensity.toLowerCase()}.`;
    if (activity.kind === 'TIMED')
      return `${activity.rounds} rodada(s), ${activity.durationSeconds}s no total, intensidade ${activity.intensity.toLowerCase()}.`;
    if (activity.kind === 'ENDURANCE')
      return `${activity.durationMinutes} min, intensidade ${activity.intensity.toLowerCase()}${activity.distanceKm === null ? '' : `, ${activity.distanceKm} km`}.`;
    return activity.durationSeconds !== null
      ? `${activity.durationSeconds}s.`
      : activity.holdSeconds !== null
        ? `sustentar ${activity.holdSeconds}s.`
        : `${activity.repetitions ?? 'movimento controlado'}.`;
  }
}
