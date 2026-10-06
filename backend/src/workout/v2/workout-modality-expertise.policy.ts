import type { WorkoutModality } from './workout-planning-artifact.contract';
import type {
  WorkoutPlanningStrategy,
  WorkoutBlockType,
} from './workout-planning-strategy.contract';
import type {
  WorkoutActivityV2,
  GeneratedWorkoutPlanV2Candidate,
  WorkoutPlanValidationIssue,
} from './workout-plan-v2.contract';

export const modalityExpertise: Readonly<
  Record<
    WorkoutModality,
    { readonly focuses: readonly string[]; readonly guidance: string }
  >
> = {
  GYM_STRENGTH: {
    focuses: ['Força e hipertrofia'],
    guidance:
      'Distribua volume por objetivo, experiência, frequência e recuperação. Respeite equipamento e limitações.',
  },
  HOME_WORKOUT: {
    focuses: [
      'Força com equipamento disponível',
      'Controle corporal e core',
      'Condicionamento doméstico',
    ],
    guidance:
      'Use somente equipamento autorizado e espaço disponível; não infira academia.',
  },
  OUTDOOR_WORKOUT: {
    focuses: [
      'Força ao ar livre',
      'Condicionamento no ambiente disponível',
      'Mobilidade e recuperação',
    ],
    guidance:
      'Use ambiente e equipamento confirmados; não invente estruturas externas.',
  },
  CALISTHENICS: {
    focuses: [
      'Progressões de puxar e apoio',
      'Controle corporal e pernas',
      'Regressões técnicas e recuperação',
    ],
    guidance:
      'Progressões e regressões de peso corporal conforme domínio confirmado. Barra/paralela exigem equipamento autorizado; movimentos avançados exigem readiness.',
  },
  FUNCTIONAL: {
    focuses: [
      'Padrões funcionais de movimento',
      'Coordenação e condicionamento',
      'Estabilidade e recuperação',
    ],
    guidance:
      'Selecione padrões funcionais coerentes; não misture movimentos aleatórios ou equipamento ausente.',
  },
  CROSSFIT: {
    focuses: [
      'Fundamentos e skill',
      'Strength e conditioning',
      'WOD e recuperação',
    ],
    guidance:
      'Warm-up, técnica/skill, strength pertinente, conditioning/WOD e cooldown. AMRAP, EMOM, For Time, rounds, couplets/triplets e intervalos conforme tempo, capacidade e equipamento. Run/bike/row são componentes legítimos do WOD. Iniciantes: scaling, simplicidade e volume controlado. Snatch, clean & jerk, muscle-up, handstand e toes-to-bar avançado só com domínio/readiness confirmado; experiência genérica não comprova domínio de cada movimento.',
  },
  RUNNING: {
    focuses: ['Base aeróbica', 'Técnica e progressão', 'Recuperação'],
    guidance:
      'Considere experiência, condicionamento, distância atual/alvo, prova, ambiente, disponibilidade, pausa e histórico. Iniciante: run/walk conservador e esforço conversacional; não invente pace. Experiente com contexto suficiente: easy, intervalos, threshold, long e recovery coerentes, progressão conservadora.',
  },
  WALKING: {
    focuses: [
      'Caminhada contínua',
      'Cadência e terreno',
      'Progressão de duração',
    ],
    guidance:
      'Prescreva caminhada leve/moderada, contínua, progressiva ou intervalada por intensidade, cadência, terreno regular e recuperação. Inclinação apenas com ambiente/equipamento autorizado. Não introduza RUN, corrida, trote, jogging, sprint ou run/walk sem strategy.runningTransitionAuthorized=true.',
  },
  CYCLING: {
    focuses: [
      'Pedalada contínua e cadência',
      'Intervalos de ciclismo por esforço',
      'Pedalada de recuperação',
    ],
    guidance:
      'Ciclismo específico ao ambiente e bike disponível. Bloco principal usa CYCLE, nunca corrida/caminhada. Não invente potência.',
  },
  MOBILITY: {
    focuses: [
      'Amplitude controlada',
      'Mobilidade segmentar',
      'Controle e recuperação',
    ],
    guidance:
      'Amplitude confortável, controle, sem treino pesado ou reabilitação/diagnóstico.',
  },
  CARDIO_CONDITIONING: {
    focuses: [
      'Base cardiorrespiratória',
      'Intervalos de esforço',
      'Recuperação ativa',
    ],
    guidance:
      'Cardio conforme condicionamento, ambiente, equipamento e limitações; modalidades componentes coerentes, sem carga ou pace inventado.',
  },
  ACTIVE_RECOVERY: {
    focuses: [
      'Recuperação leve',
      'Mobilidade confortável',
      'Atividade regenerativa',
    ],
    guidance:
      'Esforço leve, mobilidade e recuperação. Não prescreva intensidade alta ou estímulo pesado.',
  },
  GENERAL_FITNESS: {
    focuses: [
      'Força geral',
      'Condicionamento e coordenação',
      'Mobilidade e recuperação',
    ],
    guidance:
      'Combine capacidades conforme objetivo e contexto; não invente preferência específica.',
  },
};

function positiveExecutionText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[.;!\n]/u)
    .filter((part) => !/^\s*(?:nao|evite|sem)\b/u.test(part))
    .join(' ');
}

export function workoutModalityActivityIssue(
  activity: WorkoutActivityV2,
  block: WorkoutBlockType,
  strategy: WorkoutPlanningStrategy,
): WorkoutPlanValidationIssue | null {
  const main = [
    'ENDURANCE',
    'INTERVAL',
    'CONDITIONING',
    'STRENGTH',
    'HYPERTROPHY',
    'SKILL',
    'TECHNIQUE',
  ].includes(block);
  const walking =
    strategy.modality === 'WALKING' &&
    strategy.runningTransitionAuthorized !== true;
  const text = positiveExecutionText(
    `${activity.name}. ${activity.instruction}`,
  );
  const runningText =
    /\b(?:corrida|correr|corra|trote|trotes|jogging|jog|sprints?|run(?:\s*\/\s*walk)?|fartlek)\b/u.test(
      text,
    );
  let invalid = false;
  if (walking)
    invalid =
      (activity.kind === 'ENDURANCE' && activity.mode !== 'WALK') ||
      runningText ||
      (main && activity.kind === 'STRENGTH');
  if (strategy.modality === 'CYCLING' && main)
    invalid =
      activity.kind === 'ENDURANCE'
        ? activity.mode !== 'CYCLE'
        : activity.kind !== 'MOBILITY' &&
          !(activity.kind === 'TIMED' && activity.equipment.includes('BIKE'));
  if (strategy.modality === 'RUNNING' && main && activity.kind === 'ENDURANCE')
    invalid = activity.mode === 'CYCLE';
  if (strategy.modality === 'MOBILITY' && main)
    invalid = activity.kind !== 'MOBILITY';
  if (strategy.modality === 'ACTIVE_RECOVERY')
    invalid = 'intensity' in activity && activity.intensity === 'HIGH';
  if (strategy.modality === 'CALISTHENICS' && main)
    invalid = activity.equipment.some((equipment) =>
      ['BARBELL', 'MACHINE', 'CABLE'].includes(equipment),
    );
  return invalid
    ? {
        code: 'MODALITY_ACTIVITY_CONFLICT',
        severity: 'ERROR',
        path: activity.activityKey,
      }
    : null;
}

export function workoutModalityPlanIssues(
  candidate: GeneratedWorkoutPlanV2Candidate,
  strategy: WorkoutPlanningStrategy,
): readonly WorkoutPlanValidationIssue[] {
  const issues = candidate.sessions.flatMap((session) =>
    session.blocks.flatMap((block) =>
      block.activities.flatMap((activity) => {
        const issue = workoutModalityActivityIssue(
          activity,
          block.type,
          strategy,
        );
        return issue ? [issue] : [];
      }),
    ),
  );
  if (
    strategy.modality === 'WALKING' &&
    strategy.runningTransitionAuthorized !== true
  ) {
    const publicTexts = [
      candidate.title,
      ...candidate.adaptationRules,
      ...candidate.sessions.flatMap((session) => [
        session.label,
        ...session.blocks.flatMap((block) => [
          block.title,
          ...block.activities.flatMap((activity) => activity.alerts),
        ]),
      ]),
    ];
    if (
      publicTexts.some((text) =>
        /\b(?:corrida|correr|trote|trotes|jogging|sprints?|run|fartlek)\b/u.test(
          positiveExecutionText(text),
        ),
      )
    )
      issues.push({
        code: 'MODALITY_ACTIVITY_CONFLICT',
        severity: 'ERROR',
        path: 'modality.publicText',
      });
  }
  // Running plans may legitimately use WALK for warm-up, recovery and beginner run/walk.
  // CrossFit legitimately mixes locomotion, lifting and gymnastics within its WOD roles.
  return issues;
}
