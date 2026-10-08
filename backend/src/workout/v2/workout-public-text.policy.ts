import type { WorkoutEquipment } from './workout-planning-context.contract';
import type {
  GeneratedWorkoutPlanV2Candidate,
  WorkoutPlanValidationIssue,
} from './workout-plan-v2.contract';
import type { WorkoutPlanningStrategy } from './workout-planning-strategy.contract';
import { workoutPrescriptionTextConstraints } from './workout-prescription.policy';

/** Equipment vocabulary only: this policy never selects movements or programming. */
const aliases: Readonly<Record<WorkoutEquipment, readonly string[]>> = {
  BARBELL: [
    'barra',
    'barras',
    'barra olimpica',
    'barra com anilhas',
    'barra de musculacao',
    'barbell',
  ],
  DUMBBELL: ['halter', 'halteres', 'dumbbell', 'dumbbells'],
  KETTLEBELL: ['kettlebell', 'kettlebells', 'kb'],
  MACHINE: ['maquina', 'maquinas', 'machine'],
  CABLE: ['cabo', 'cabos', 'crossover', 'pulley'],
  BENCH: ['banco', 'bancos', 'bench'],
  PULL_UP_BAR: ['barra fixa', 'barras fixas', 'pull up bar'],
  RESISTANCE_BAND: [
    'elastico',
    'elasticos',
    'faixa elastica',
    'band',
    'bands',
    'resistance band',
  ],
  BODYWEIGHT: ['peso corporal', 'bodyweight'],
  BIKE: [
    'bike',
    'bikes',
    'bicicleta',
    'bicicletas',
    'air bike',
    'assault bike',
    'bicicleta ergometrica',
  ],
  TREADMILL: ['esteira', 'esteiras', 'treadmill'],
  ROW_ERGOMETER: ['remo', 'remador', 'rower', 'ergometro de remo'],
};
const vocabulary = Object.entries(aliases)
  .flatMap(([equipment, words]) =>
    words.map((word) => ({ word, equipment: equipment as WorkoutEquipment })),
  )
  .sort((a, b) => b.word.length - a.word.length);
const escape = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const equipmentPattern = new RegExp(
  `(?<![\\p{L}\\p{N}_])(?:${vocabulary.map(({ word }) => escape(word).replace(/ /gu, '\\s+')).join('|')})(?![\\p{L}\\p{N}_])`,
  'gu',
);
const normalize = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export interface WorkoutPublicTextConstraints {
  /** Activity name disambiguates anaphoric equipment references in its cues. */
  readonly equipmentReferenceText?: string;
  readonly authorizedEquipment: readonly WorkoutEquipment[];
  readonly intensityPolicy: {
    readonly exactLoadAllowed: boolean;
    readonly exactPaceAllowed: boolean;
    readonly exactPowerAllowed: boolean;
    /** No confirmed HR target exists in the current planning contract. */
    readonly exactHeartRateAllowed?: boolean;
  };
}
export function workoutPublicTextIssues(
  text: string,
  strategy: WorkoutPublicTextConstraints,
  path: string,
): readonly WorkoutPlanValidationIssue[] {
  const value = normalize(text);
  const referenceContext = normalize(
    `${strategy.equipmentReferenceText ?? ''}\n${text}`,
  );
  const codes = new Set<WorkoutPlanValidationIssue['code']>();
  for (const match of value.matchAll(equipmentPattern)) {
    const reference = vocabulary.find(
      ({ word }) => word === match[0].replace(/\s+/gu, ' '),
    );
    // Resolve an anaphoric "a/na barra" only after an explicit pull-up reference.
    // Qualified Olympic/loaded bars retain their own BARBELL token and permission.
    if (
      reference?.equipment === 'BARBELL' &&
      ['barra', 'barras'].includes(reference.word) &&
      strategy.authorizedEquipment.includes('PULL_UP_BAR') &&
      /\bbarras? fixas?\b/u.test(referenceContext) &&
      /\b(?:a|as|na|nas|da|das)\s+$/u.test(value.slice(0, match.index))
    )
      continue;
    // An inverted bodyweight row names a movement, not a rowing ergometer.
    if (
      reference?.equipment === 'ROW_ERGOMETER' &&
      reference.word === 'remo' &&
      /^\s+invertido\b/u.test(value.slice(match.index + match[0].length))
    )
      continue;
    if (
      reference &&
      !strategy.authorizedEquipment?.includes(reference.equipment)
    )
      codes.add('UNAUTHORIZED_EQUIPMENT_REFERENCE');
  }
  if (
    strategy.intensityPolicy?.exactLoadAllowed !== true &&
    /\b\d+(?:[.,]\d+)?\s*(?:(?:kg|kgs|quilogramas?|quilos?|kilos?|lb|lbs|libras?|pounds?|gramas?|g)\b|%\s*(?:de\s+|do\s+)?(?:1\s*rm\b|(?:seu\s+)?maximo\b))/u.test(
      value,
    )
  )
    codes.add('UNAUTHORIZED_EXACT_LOAD');
  if (
    strategy.intensityPolicy?.exactPaceAllowed !== true &&
    /\b\d+(?::\d{1,2}|[.,]\d+)?\s*(?:(?:min(?:utos?)?\s*)?(?:\/|por)\s*(?:km|quilometros?)|km\s*\/\s*h|m\s*\/\s*s)\b/u.test(
      value,
    )
  )
    codes.add('UNAUTHORIZED_EXACT_PACE');
  if (
    strategy.intensityPolicy?.exactPowerAllowed !== true &&
    /\b\d+(?:[.,]\d+)?\s*(?:w|watts?|kw|quilowatts?)\b/u.test(value)
  )
    codes.add('UNAUTHORIZED_EXACT_POWER');
  if (
    strategy.intensityPolicy?.exactHeartRateAllowed !== true &&
    /\b\d+(?:[.,]\d+)?\s*(?:bpm|batimentos\s+por\s+minuto)\b/u.test(value)
  )
    codes.add('UNAUTHORIZED_EXACT_HEART_RATE');
  return [...codes].map((code) => ({ code, severity: 'ERROR' as const, path }));
}

export function workoutCandidatePublicTextIssues(
  candidate: GeneratedWorkoutPlanV2Candidate,
  strategy: WorkoutPlanningStrategy,
): readonly WorkoutPlanValidationIssue[] {
  const fields: Array<readonly [string, string]> = [
    ['title', candidate.title],
    ...candidate.adaptationRules.map(
      (text, i) => [`adaptationRules.${i}`, text] as const,
    ),
  ];
  for (const session of candidate.sessions) {
    fields.push([session.sessionKey, session.label]);
    for (const block of session.blocks) {
      fields.push([block.blockKey, block.title]);
    }
  }
  for (const rule of candidate.progression)
    fields.push([rule.ruleKey, `${rule.conditionCode}\n${rule.actionCode}`]);
  // Metrics belong to an activity's typed prescription, never arbitrary plan prose.
  const plainText = {
    authorizedEquipment: strategy.authorizedEquipment,
    intensityPolicy: {
      exactLoadAllowed: false,
      exactPaceAllowed: false,
      exactPowerAllowed: false,
    },
  };
  return [
    ...fields.flatMap(([path, text]) =>
      workoutPublicTextIssues(text, plainText, path),
    ),
    ...candidate.sessions.flatMap((session) =>
      session.blocks.flatMap((block) =>
        block.activities.flatMap((activity) =>
          workoutPublicTextIssues(
            [
              activity.name,
              activity.instruction,
              ...activity.alerts,
              ...('repetitions' in activity
                ? [activity.repetitions ?? '']
                : []),
            ].join('\n'),
            {
              ...workoutPrescriptionTextConstraints(activity),
              authorizedEquipment: strategy.authorizedEquipment,
            },
            activity.activityKey,
          ),
        ),
      ),
    ),
  ];
}
