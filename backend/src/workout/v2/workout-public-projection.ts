import type { WorkoutActivityV2 } from './workout-plan-v2.contract';
import { ConversationPublicAnswerBoundaryService } from '../../conversation/runtime/conversation-public-answer-boundary.service';
import { workoutPublicTextIssues } from './workout-public-text.policy';
import { projectWorkoutHumanName } from './workout-human-name.policy';

/** Positive presentation vocabulary, never an exercise selector or equipment detector. */
const normalize = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/gu, ' ');
type CoachingCueKind =
  | 'TECHNIQUE'
  | 'POSTURE'
  | 'BREATHING'
  | 'TEMPO_QUALITATIVE'
  | 'PAIN_SAFETY'
  | 'EFFORT_QUALITATIVE';
const cueGrammars: readonly (readonly [CoachingCueKind, RegExp])[] = [
  [
    'POSTURE',
    /^(?:mantenha|preserve) (?:a |o |as |os )?(?:coluna|postura|tronco|corpo|escapulas|ombros|punhos|joelhos|pes|cotovelos|quadril|abdomen) (?:neutra|neutro|relaxada|relaxado|alinhada|alinhado|alinhadas|alinhados|estavel|estaveis|ereto|firme|firmes|apoiadas|apoiados|proximos ao corpo)$/u,
  ],
  ['POSTURE', /^evite (?:compensar|compensacoes)(?: com| na)? (?:a )?lombar$/u],
  [
    'BREATHING',
    /^(?:mantenha|preserve) (?:a )?respiracao (?:controlada|solta|regular|fluida)$/u,
  ],
  ['BREATHING', /^respire (?:com controle|regularmente|livremente)$/u],
  [
    'TEMPO_QUALITATIVE',
    /^controle (?:a |o )?(?:descida|subida|movimento|execucao)(?: com (?:calma|controle)| sem (?:impulso|balancar o tronco))?$/u,
  ],
  ['TECHNIQUE', /^(?:preserve|mantenha) (?:a )?tecnica$/u],
  ['TECHNIQUE', /^execute com (?:controle|tecnica|cuidado)$/u],
  ['TECHNIQUE', /^nao force (?:a )?amplitude$/u],
  ['PAIN_SAFETY', /^(?:pare|interrompa) se (?:sentir|houver) dor$/u],
  [
    'EFFORT_QUALITATIVE',
    /^(?:mantenha|use|trabalhe em) (?:a |o )?(?:ritmo|movimento|esforco|carga) (?:confortavel|moderado|moderada|leve|conversacional)$/u,
  ],
  ['EFFORT_QUALITATIVE', /^escolha (?:um )?peso que preserve (?:a )?tecnica$/u],
  [
    'TECHNIQUE',
    /^(?:evite|nao) (?:arquear|balancar|girar) (?:a |o )?(?:lombar|tronco|quadril)$/u,
  ],
  [
    'TECHNIQUE',
    /^(?:desca|suba|eleve|flexione|estenda) (?:a |o |as |os )?(?:bracos|cotovelos|joelhos|calcanhares|quadril)(?: com controle| sem impulso)?$/u,
  ],
  [
    'TECHNIQUE',
    /^conduza (?:os )?cotovelos para tras(?: sem balancar o tronco)?$/u,
  ],
  ['POSTURE', /^mantenha (?:o )?peito apoiado$/u],
  [
    'EFFORT_QUALITATIVE',
    /^(?:use|mantenha|trabalhe em) rpe (?:[1-9]|10)(?:\s*[-–a]\s*(?:[1-9]|10))?$/u,
  ],
  [
    'EFFORT_QUALITATIVE',
    /^(?:mantenha|deixe) [1-5](?:\s*[-–a]\s*[1-5])? repeticoes (?:em reserva|na reserva)$/u,
  ],
];
const publicBoundary = new ConversationPublicAnswerBoundaryService();
// Compositional vocabulary for technique, not exercise/equipment selection.
const techniqueWords = new Set(
  'a o as os ao aos do da dos das de com sem para por e na no nas nos ate uma um que se nem mantenha preserve controle evite execute conduza aproxime leve desloque apoie segure toque desca suba eleve estenda flexione alterne reduza aumente comece termine coluna postura tronco corpo escapulas ombros punhos joelhos pes cotovelos quadril abdomen peito pernas bracos calcanhares tornozelos pescoco respiracao amplitude movimento movimentos tecnica execucao descida subida ritmo impulso alinhamento banco apoio barra halteres pesos neutra neutro relaxada relaxado alinhada alinhado alinhadas alinhados estavel estaveis ereto firme firmes apoiado apoiada apoiadas apoiados proximos proximas controlada controlado controladas controlados suavemente suaves leve levemente confortavel confortaveis moderado moderada gradualmente breve pouca baixa livre solta frente tras junto enquanto mantendo perder balancar arquear girar levantar tirar tensionar elevar encolher bater relaxar travar travalos fim altura alto baixo volta pausa resistencia'.split(
    ' ',
  ),
);
const techniqueVerb =
  /^(?:mantenha|preserve|controle|evite|execute|conduza|aproxime|leve|desloque|apoie|segure|toque|desca|suba|eleve|estenda|flexione|alterne|reduza|aumente|comece|termine)\b/u;
const techniqueSubject =
  /\b(?:coluna|postura|tronco|escapulas|ombros|punhos|joelhos|pes|cotovelos|quadril|abdomen|peito|pernas|bracos|calcanhares|respiracao|amplitude|movimento|movimentos|tecnica|descida|subida|ritmo)\b/u;

function projectCoachingCue(
  text: string,
  activity: WorkoutActivityV2,
): string | null {
  if (publicBoundary.projectStructuredText(text) === null) return null;
  const clauses = text
    .trim()
    .replace(/\bmantendo\s+/giu, '. Mantenha ')
    .split(
      /[.!?;]+|(?:,\s*|\s+e\s+)(?=(?:mantenha|controle|evite|respire|pare|interrompa|preserve|use|pegue|corra|pedale|execute|trabalhe|escolha|desca|suba|eleve|flexione|estenda|conduza|deixe)\b)/iu,
    )
    .map((clause) => clause.trim())
    .filter(Boolean);
  const safe = clauses.filter((clause) => {
    const value = normalize(clause);
    if (
      workoutPublicTextIssues(
        clause,
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
      return false;
    return (
      cueGrammars.some(([, grammar]) => grammar.test(value)) ||
      (techniqueVerb.test(value) &&
        techniqueSubject.test(value) &&
        value.split(/[\s,]+/u).every((word) => techniqueWords.has(word)))
    );
  });
  if (!safe.length) return null;
  return safe.length === clauses.length && !/\bmantendo\b/iu.test(text)
    ? text.trim()
    : safe.join('. ');
}

function structuredIdentity(activity: WorkoutActivityV2): string | null {
  const identity = activity.publicIdentity;
  if (!identity) return null;
  const regions = {
    CHEST: 'peitoral',
    SHOULDERS: 'ombros',
    BACK: 'costas',
    ELBOWS: 'cotovelos',
    HIPS: 'quadril',
    KNEES: 'joelhos',
    ANKLES: 'tornozelos',
    TRUNK: 'tronco',
    WHOLE_BODY: 'corpo inteiro',
  } as const;
  const positions = {
    STANDING: 'em pé',
    SEATED: 'sentado',
    LYING: 'deitado',
    INCLINED: 'inclinado',
    PRONE: 'de bruços',
    HANGING: 'suspenso',
    KNEELING: 'ajoelhado',
    QUADRUPED: 'em quatro apoios',
    SIDE_LYING: 'deitado de lado',
  } as const;
  const actions = {
    FLEXION: 'Flexão',
    EXTENSION: 'Extensão',
    ABDUCTION: 'Abdução',
    ADDUCTION: 'Adução',
    ROTATION: 'Rotação',
    STABILIZATION: 'Estabilização',
  } as const;
  const movements = {
    SQUAT: 'Agachamento',
    HINGE: 'Extensão de quadril',
    PUSH: 'Empurrada',
    PULL: 'Puxada',
    CARRY: 'Transporte de carga',
    LOCOMOTION: 'Locomoção',
    ROTATION: 'Rotação',
    CORE: 'Estabilização',
    MOBILITY: 'Mobilidade',
    OTHER: identity.jointAction ? actions[identity.jointAction] : null,
  } as const;
  let movement: string | null = movements[activity.movementPattern];
  let position: string = positions[identity.bodyPosition];
  if (activity.movementPattern === 'PUSH') {
    if (identity.targetRegion === 'CHEST' && identity.plane === 'HORIZONTAL') {
      const loaded = activity.equipment.some((value) =>
        ['BARBELL', 'DUMBBELL', 'MACHINE'].includes(value),
      );
      movement =
        loaded && ['LYING', 'INCLINED'].includes(identity.bodyPosition)
          ? 'Supino'
          : 'Flexão de braços';
      if (movement === 'Supino' && identity.bodyPosition === 'LYING')
        position = 'reto';
    } else if (
      identity.targetRegion === 'SHOULDERS' &&
      identity.plane === 'VERTICAL'
    )
      movement = 'Desenvolvimento de ombros';
  } else if (activity.movementPattern === 'PULL') {
    movement = identity.plane === 'HORIZONTAL' ? 'Remada' : 'Puxada';
    if (identity.plane === 'HORIZONTAL' && identity.bodyPosition === 'INCLINED')
      position = 'curvada';
    if (
      identity.bodyPosition === 'HANGING' &&
      activity.equipment.includes('PULL_UP_BAR')
    ) {
      movement = 'Barra fixa';
      position = '';
    }
  } else if (activity.movementPattern === 'OTHER') {
    movement = identity.jointAction
      ? `${actions[identity.jointAction]} de ${regions[identity.targetRegion]}`
      : null;
  } else if (activity.movementPattern === 'CORE') {
    movement = 'Estabilização do tronco';
  } else if (activity.movementPattern === 'MOBILITY') {
    movement = `Mobilidade de ${regions[identity.targetRegion]}`;
  }
  if (!movement) return null;
  const equipmentLabels = {
    BARBELL: 'com barra',
    DUMBBELL: 'com halteres',
    KETTLEBELL: 'com kettlebell',
    MACHINE: 'na máquina',
    CABLE: 'no cabo',
    RESISTANCE_BAND: 'com elástico',
  } as const;
  const equipment = activity.equipment
    .flatMap((value) =>
      value in equipmentLabels
        ? [equipmentLabels[value as keyof typeof equipmentLabels]]
        : [],
    )
    .join(' e ');
  return [movement, position, equipment].filter(Boolean).join(' ');
}
const patterns: Readonly<Record<WorkoutActivityV2['movementPattern'], string>> =
  {
    SQUAT: 'Padrão de agachamento',
    HINGE: 'Padrão de dobradiça de quadril',
    PUSH: 'Movimento de empurrar',
    PULL: 'Movimento de puxar',
    CARRY: 'Transporte de carga',
    LOCOMOTION: 'Locomoção',
    ROTATION: 'Rotação',
    CORE: 'Estabilidade do tronco',
    MOBILITY: 'Mobilidade',
    OTHER: 'Movimento do bloco',
  };
const headings = new Set([
  'sua semana de treino',
  'sua semana na academia',
  'plano atual',
  'meu plano',
  'corpo inteiro',
  'pernas',
  'peito',
  'costas',
  'superiores a',
  'superiores b',
  'inferiores a',
  'inferiores b',
  'recuperacao ativa',
  'principal',
  'bloco principal',
  'aquecimento',
  'mobilidade',
  'desaceleracao',
  'condicionamento',
  'tecnica',
  'forca',
]);

/** Unknown text is omitted regardless of whether a forbidden term was detected. */
export function projectWorkoutHeading(
  text: string,
  fallback: string,
  sequence?: number,
): string {
  if (
    sequence !== undefined &&
    normalize(text) === `sessao tecnica ${sequence}`
  )
    return `Sessão técnica ${sequence}`;
  return headings.has(normalize(text)) ? text.trim() : fallback;
}

export interface WorkoutPublicActivityProjection {
  readonly displayName: string;
  readonly instruction: string;
  readonly alerts: readonly string[];
  readonly repetitions: string | null;
  readonly omittedUnverifiedText: boolean;
}

export function projectWorkoutActivity(
  activity: WorkoutActivityV2,
): WorkoutPublicActivityProjection {
  const supportedName = projectWorkoutHumanName(activity);
  // Endurance's executable mode is structured; no textual mode/equipment modifier is needed.
  const displayName =
    activity.kind === 'ENDURANCE'
      ? ({ WALK: 'Caminhada', RUN: 'Corrida', CYCLE: 'Ciclismo' } as const)[
          activity.mode
        ]
      : (supportedName ??
        structuredIdentity(activity) ??
        patterns[activity.movementPattern]);
  const instruction = projectCoachingCue(activity.instruction, activity);
  const alerts = activity.alerts.flatMap((text) => {
    const safe = projectCoachingCue(text, activity);
    return safe ? [safe] : [];
  });
  const rawReps = 'repetitions' in activity ? activity.repetitions : null;
  const repetitions = projectWorkoutRepetitions(rawReps);
  return Object.freeze({
    displayName,
    instruction: instruction ?? '',
    alerts: Object.freeze(alerts),
    repetitions,
    omittedUnverifiedText:
      (!supportedName && activity.kind !== 'ENDURANCE') ||
      (activity.instruction.trim().length > 0 && instruction === null) ||
      alerts.length !== activity.alerts.length ||
      (rawReps !== null && repetitions === null),
  });
}

export function projectWorkoutRepetitions(value: string | null): string | null {
  if (!value) return null;
  const timed =
    /^([1-9]\d*)(?:\s*[-–]\s*([1-9]\d*))?\s+(?:s|segundos?)(?:\s+(por lado))?$/u.exec(
      normalize(value),
    );
  if (timed) {
    const minimum = Number(timed[1]);
    const maximum = timed[2] ? Number(timed[2]) : minimum;
    if (
      !Number.isSafeInteger(minimum) ||
      !Number.isSafeInteger(maximum) ||
      maximum < minimum
    )
      return null;
    return `${timed[1]}${timed[2] ? `-${timed[2]}` : ''} s${timed[3] ? ` ${timed[3]}` : ''}`;
  }
  const match =
    /^(\d+(?:\s*[-–a]\s*\d+)?)(?:\s*(?:repeticoes|reps))?(?:\s*\(?((?:por|de cada|cada) (?:lado|perna|braco))\)?)?$/u.exec(
      normalize(value),
    );
  if (!match) return null;
  return `${match[1]}${match[2] ? ` ${match[2].replace(/^(?:de cada|cada)/u, 'por')}` : ''}`;
}
