import type { WorkoutModality } from './workout-planning-artifact.contract';
import type { WorkoutEquipment } from './workout-planning-context.contract';

export interface WorkoutQualityCase {
  readonly id: string;
  readonly text: string;
  readonly modality: WorkoutModality;
  readonly count: number;
  readonly experience: 'BEGINNER' | 'INTERMEDIATE';
  readonly duration?: number;
  readonly equipment?: readonly WorkoutEquipment[];
  readonly days?: readonly string[];
}
export const WORKOUT_V10_QUALITY_CORPUS: readonly WorkoutQualityCase[] = [
  {
    id: 'A',
    text: 'Monte Crossfit 3x para iniciante',
    modality: 'CROSSFIT',
    count: 3,
    experience: 'BEGINNER',
  },
  {
    id: 'B',
    text: 'Monte Crossfit 4x para intermediário',
    modality: 'CROSSFIT',
    count: 4,
    experience: 'INTERMEDIATE',
  },
  {
    id: 'C',
    text: 'Monte Crossfit 4x considerando meu perfil',
    modality: 'CROSSFIT',
    count: 4,
    experience: 'INTERMEDIATE',
    days: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
  },
  {
    id: 'D',
    text: 'Monte Crossfit 3x, segunda, quarta e sexta',
    modality: 'CROSSFIT',
    count: 3,
    experience: 'INTERMEDIATE',
    days: ['MONDAY', 'WEDNESDAY', 'FRIDAY'],
  },
  {
    id: 'E',
    text: 'Monte musculação 3x para iniciante',
    modality: 'GYM_STRENGTH',
    count: 3,
    experience: 'BEGINNER',
  },
  {
    id: 'F',
    text: 'Monte musculação 4x para intermediário',
    modality: 'GYM_STRENGTH',
    count: 4,
    experience: 'INTERMEDIATE',
  },
  {
    id: 'G',
    text: 'Monte musculação 5x para hipertrofia',
    modality: 'GYM_STRENGTH',
    count: 5,
    experience: 'INTERMEDIATE',
  },
  {
    id: 'H',
    text: 'Monte musculação 3x com meus equipamentos disponíveis',
    modality: 'GYM_STRENGTH',
    count: 3,
    experience: 'INTERMEDIATE',
    equipment: ['DUMBBELL'],
  },
  {
    id: 'I',
    text: 'Monte corrida de rua 3x para iniciante',
    modality: 'RUNNING',
    count: 3,
    experience: 'BEGINNER',
  },
  {
    id: 'J',
    text: 'Monte corrida de rua 4x para correr 10 km',
    modality: 'RUNNING',
    count: 4,
    experience: 'INTERMEDIATE',
  },
  {
    id: 'K',
    text: 'Monte corrida de rua 3x, estou voltando depois de uma pausa',
    modality: 'RUNNING',
    count: 3,
    experience: 'INTERMEDIATE',
  },
  {
    id: 'L',
    text: 'Monte corrida de rua 3x para prova de 10 km em 2026-12-20',
    modality: 'RUNNING',
    count: 3,
    experience: 'INTERMEDIATE',
  },
  {
    id: 'M',
    text: 'Monte treino em casa 3x só com peso corporal',
    modality: 'HOME_WORKOUT',
    count: 3,
    experience: 'BEGINNER',
    equipment: ['BODYWEIGHT'],
  },
  {
    id: 'N',
    text: 'Monte treino em casa 3x com halteres',
    modality: 'HOME_WORKOUT',
    count: 3,
    experience: 'INTERMEDIATE',
    equipment: ['DUMBBELL'],
  },
  {
    id: 'O',
    text: 'Monte treino em casa 3x de 20 minutos',
    modality: 'HOME_WORKOUT',
    count: 3,
    experience: 'BEGINNER',
    duration: 20,
    equipment: ['BODYWEIGHT'],
  },
  {
    id: 'P',
    text: 'Monte caminhada 5x, sem corrida ou trote',
    modality: 'WALKING',
    count: 5,
    experience: 'BEGINNER',
  },
];
