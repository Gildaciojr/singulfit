import { ConversationPublicAnswerBoundaryService } from '../../conversation/runtime/conversation-public-answer-boundary.service';
import type {
  WorkoutActivityV2,
  WorkoutPublicExerciseIdentity,
} from './workout-plan-v2.contract';
import type { WorkoutEquipment } from './workout-planning-context.contract';
import { workoutPublicTextIssues } from './workout-public-text.policy';

interface NameGrammar {
  readonly noun: RegExp;
  readonly patterns: readonly WorkoutActivityV2['movementPattern'][];
  readonly regions?: readonly WorkoutPublicExerciseIdentity['targetRegion'][];
  readonly positions?: readonly WorkoutPublicExerciseIdentity['bodyPosition'][];
  readonly plane?: WorkoutPublicExerciseIdentity['plane'];
  readonly equipment?: WorkoutEquipment;
}

// Presentation families only: never choose exercises, loads, sets or programming.
const grammars: readonly NameGrammar[] = [
  {
    noun: /^agachamento(?: (?:livre|controlado|frontal|sumo|bulgaro|goblet|com apoio e scaling))?$/u,
    patterns: ['SQUAT'],
    regions: ['HIPS', 'KNEES', 'WHOLE_BODY'],
    positions: ['STANDING'],
  },
  {
    noun: /^(?:levantamento (?:terra(?: romeno)?|romeno)|terra(?: romeno)?)$/u,
    patterns: ['HINGE'],
    regions: ['HIPS', 'WHOLE_BODY'],
    positions: ['STANDING'],
  },
  {
    noun: /^supino(?: (?:reto|inclinado|declinado))?$/u,
    patterns: ['PUSH'],
    regions: ['CHEST'],
    plane: 'HORIZONTAL',
    positions: ['LYING', 'INCLINED'],
  },
  {
    noun: /^remada(?: (?:baixa|unilateral|curvada|apoiada|leve))?$/u,
    patterns: ['PULL'],
    regions: ['BACK'],
    plane: 'HORIZONTAL',
  },
  {
    noun: /^leg press(?: (?:horizontal|inclinado))?$/u,
    patterns: ['SQUAT'],
    regions: ['HIPS', 'KNEES'],
    positions: ['SEATED', 'INCLINED'],
    equipment: 'MACHINE',
  },
  {
    noun: /^prancha(?: frontal)?$/u,
    patterns: ['CORE'],
    regions: ['TRUNK'],
    positions: ['PRONE', 'LYING'],
  },
  {
    noun: /^prancha lateral$/u,
    patterns: ['CORE'],
    regions: ['TRUNK'],
    positions: ['SIDE_LYING'],
  },
  {
    noun: /^dead bug$/u,
    patterns: ['CORE'],
    regions: ['TRUNK'],
    positions: ['LYING'],
  },
  {
    noun: /^woodchop$/u,
    patterns: ['ROTATION'],
    regions: ['TRUNK', 'WHOLE_BODY'],
  },
  {
    noun: /^desenvolvimento(?: (?:em pe|sentado|de ombros))?$/u,
    patterns: ['PUSH'],
    regions: ['SHOULDERS'],
    plane: 'VERTICAL',
    positions: ['STANDING', 'SEATED'],
  },
  {
    noun: /^(?:barra fixa|puxada(?: (?:frontal|neutra))?)$/u,
    patterns: ['PULL'],
    regions: ['BACK'],
    plane: 'VERTICAL',
  },
  {
    noun: /^thruster$/u,
    patterns: ['SQUAT', 'PUSH'],
    regions: ['WHOLE_BODY', 'HIPS', 'SHOULDERS'],
  },
  {
    noun: /^clean(?: tecnico)?$/u,
    patterns: ['HINGE'],
    regions: ['WHOLE_BODY', 'HIPS'],
  },
];
const equipmentSuffixes: readonly (readonly [string, WorkoutEquipment])[] = [
  ['com barra', 'BARBELL'],
  ['com halter', 'DUMBBELL'],
  ['com halteres', 'DUMBBELL'],
  ['com kettlebell', 'KETTLEBELL'],
  ['na maquina', 'MACHINE'],
  ['no cabo', 'CABLE'],
  ['na polia', 'CABLE'],
  ['com elastico', 'RESISTANCE_BAND'],
];
const boundary = new ConversationPublicAnswerBoundaryService();

export function projectWorkoutHumanName(
  activity: WorkoutActivityV2,
): string | null {
  const text = activity.name.trim().replace(/\s+/gu, ' ');
  if (
    activity.kind === 'ENDURANCE' ||
    text.length > 80 ||
    boundary.projectStructuredText(text) === null
  )
    return null;
  const value = text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  if (
    /\b(?:indisponivel|nao disponivel|substituir|nao definido|placeholder|escolher|escolha|use)\b/u.test(
      value,
    )
  )
    return null;
  if (
    workoutPublicTextIssues(
      text,
      {
        authorizedEquipment: activity.equipment,
        intensityPolicy: {
          exactLoadAllowed: false,
          exactPaceAllowed: false,
          exactPowerAllowed: false,
        },
      },
      activity.activityKey,
    ).length
  )
    return null;
  const suffix = equipmentSuffixes.find(([phrase]) =>
    value.endsWith(` ${phrase}`),
  );
  if (suffix && !activity.equipment.includes(suffix[1])) return null;
  const stem = suffix ? value.slice(0, -(suffix[0].length + 1)) : value;
  const grammar = grammars.find(({ noun }) => noun.test(stem));
  if (!grammar || !grammar.patterns.includes(activity.movementPattern))
    return null;
  if (grammar.equipment && !activity.equipment.includes(grammar.equipment))
    return null;
  if (stem === 'barra fixa' && !activity.equipment.includes('PULL_UP_BAR'))
    return null;
  const identity = activity.publicIdentity;
  if (identity) {
    if (
      (grammar.regions && !grammar.regions.includes(identity.targetRegion)) ||
      (grammar.positions &&
        !grammar.positions.includes(identity.bodyPosition)) ||
      (grammar.plane && grammar.plane !== identity.plane)
    )
      return null;
    if (
      (/\binclinado\b/u.test(stem) && identity.bodyPosition !== 'INCLINED') ||
      (/\breto\b/u.test(stem) && identity.bodyPosition !== 'LYING') ||
      (/\bsentado\b/u.test(stem) && identity.bodyPosition !== 'SEATED') ||
      (/\bem pe\b/u.test(stem) && identity.bodyPosition !== 'STANDING')
    )
      return null;
  }
  return text;
}
