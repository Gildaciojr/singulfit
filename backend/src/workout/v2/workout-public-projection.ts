import type { WorkoutActivityV2 } from './workout-plan-v2.contract';
import { ConversationPublicAnswerBoundaryService } from '../../conversation/runtime/conversation-public-answer-boundary.service';

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
    /^(?:mantenha|preserve) (?:a |o )?(?:coluna|postura|tronco|corpo) (?:neutra|neutro|relaxada|relaxado|alinhada|alinhado|estavel|ereto)$/u,
  ],
  ['POSTURE', /^evite (?:compensar|compensacoes)(?: com| na)? (?:a )?lombar$/u],
  [
    'BREATHING',
    /^(?:mantenha|preserve) (?:a )?respiracao (?:controlada|solta|regular|fluida)$/u,
  ],
  ['BREATHING', /^respire (?:com controle|regularmente|livremente)$/u],
  [
    'TEMPO_QUALITATIVE',
    /^controle (?:a |o )?(?:descida|subida|movimento|execucao)$/u,
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
];
const publicBoundary = new ConversationPublicAnswerBoundaryService();

function projectCoachingCue(text: string): string | null {
  if (publicBoundary.projectStructuredText(text) === null) return null;
  const clauses = text
    .trim()
    .replace(/\bmantendo\s+/giu, '. Mantenha ')
    .split(
      /[.!?;]+|\s+e\s+(?=(?:mantenha|controle|evite|respire|pare|interrompa|preserve|use|pegue|corra|pedale|execute|trabalhe|escolha)\b)/iu,
    )
    .map((clause) => clause.trim())
    .filter(Boolean);
  const safe = clauses.filter((clause) =>
    cueGrammars.some(([, grammar]) => grammar.test(normalize(clause))),
  );
  if (!safe.length) return null;
  return safe.length === clauses.length && !/\bmantendo\b/iu.test(text)
    ? text.trim()
    : safe.join('. ');
}

function structuredIdentity(activity: WorkoutActivityV2): string | null {
  const identity = activity.publicIdentity;
  if (!identity) return null;
  const planes = {
    HORIZONTAL: 'horizontal',
    VERTICAL: 'vertical',
    SAGITTAL: 'no plano sagital',
    FRONTAL: 'no plano frontal',
    TRANSVERSE: 'no plano transversal',
    NONE: '',
  } as const;
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
    HINGE: 'Dobradiça de quadril',
    PUSH: 'Empurrada',
    PULL: 'Puxada',
    CARRY: 'Transporte de carga',
    LOCOMOTION: 'Locomoção',
    ROTATION: 'Rotação',
    CORE: 'Estabilização',
    MOBILITY: 'Mobilidade',
    OTHER: identity.jointAction ? actions[identity.jointAction] : null,
  } as const;
  const movement = movements[activity.movementPattern];
  return movement
    ? `${movement}${planes[identity.plane] ? ` ${planes[identity.plane]}` : ''} para ${regions[identity.targetRegion]}, ${positions[identity.bodyPosition]}`
    : null;
}
const names = new Map([
  ['agachamento', 'Agachamento'],
  ['agachamento controlado', 'Agachamento controlado'],
  ['supino', 'Supino'],
  ['remada', 'Remada'],
  ['barra fixa', 'Barra fixa'],
  ['agachamento com apoio e scaling', 'Agachamento com apoio e scaling'],
  ['thruster com halteres', 'Thruster com halteres'],
  ['clean tecnico com barra', 'Clean técnico com barra'],
]);
const namedEquipment = new Map([
  ['barra fixa', 'PULL_UP_BAR' as const],
  ['thruster com halteres', 'DUMBBELL' as const],
  ['clean tecnico com barra', 'BARBELL' as const],
]);
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
  const rawName = normalize(activity.name);
  const requiredEquipment = namedEquipment.get(rawName);
  const supportedName =
    requiredEquipment && !activity.equipment.includes(requiredEquipment)
      ? undefined
      : names.get(rawName);
  // Endurance's executable mode is structured; no textual mode/equipment modifier is needed.
  const displayName =
    activity.kind === 'ENDURANCE'
      ? ({ WALK: 'Caminhada', RUN: 'Corrida', CYCLE: 'Ciclismo' } as const)[
          activity.mode
        ]
      : (structuredIdentity(activity) ??
        supportedName ??
        patterns[activity.movementPattern]);
  const instruction = projectCoachingCue(activity.instruction);
  const alerts = activity.alerts.flatMap((text) => {
    const safe = projectCoachingCue(text);
    return safe ? [safe] : [];
  });
  const rawReps = 'repetitions' in activity ? activity.repetitions : null;
  const repetitions =
    rawReps &&
    /^\d+(?:\s*[-–a]\s*\d+)?(?:\s*(?:repeticoes|reps))?(?:\s*por lado)?$/u.test(
      normalize(rawReps),
    )
      ? rawReps
      : null;
  return Object.freeze({
    displayName,
    instruction:
      instruction ?? 'Mantenha o movimento confortável e pare se sentir dor.',
    alerts: Object.freeze(alerts),
    repetitions,
    omittedUnverifiedText:
      (!supportedName && activity.kind !== 'ENDURANCE') ||
      (activity.instruction.trim().length > 0 && instruction === null) ||
      alerts.length !== activity.alerts.length ||
      (rawReps !== null && repetitions === null),
  });
}
