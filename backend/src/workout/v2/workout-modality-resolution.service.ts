import { Injectable } from '@nestjs/common';
import { affirmativePlanningText } from '../../conversation/understanding/planning-request-polarity.policy';
import type { WorkoutModality } from './workout-planning-artifact.contract';

export type RunningTransitionPermission = 'ALLOW' | 'DENY' | 'UNSPECIFIED';
export interface WorkoutModalityResolution {
  readonly modality: WorkoutModality | null;
  readonly confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly source: 'DETERMINISTIC' | 'SEMANTIC' | 'PROFILE_FALLBACK';
  readonly action: 'PLAN_REQUEST' | 'MODALITY_CHANGE' | 'OTHER' | 'AMBIGUOUS';
  readonly runningTransitionPermission: RunningTransitionPermission;
  readonly runningTransitionAuthorized: boolean;
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\bqro\b/gu, 'quero')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Current-turn polarity only. Negation always dominates permission. */
export function runningTransitionPermission(
  text: string,
): RunningTransitionPermission {
  const value = normalize(text);
  if (
    /\b(?:so|somente|apenas)\s+caminhad\w*\b/u.test(value) ||
    /\b(?:sem|nada de|nao(?: quero)?|prefiro nao)\s+(?:(?:incluir|fazer|introduzir|praticar)\s+)?(?:trot\w*|corr\w*|run(?:\s*\/\s*walk)?|jog\w*|sprint\w*)\b/u.test(
      value,
    )
  )
    return 'DENY';
  if (
    /\b(?:pode|podemos|quero|permito|inclua|incluir|evoluir|depois)\b[^.!?;]*\b(?:trot\w*|correr|corrida|run\s*\/\s*walk|jog\w*)\b/u.test(
      value,
    )
  )
    return 'ALLOW';
  return 'UNSPECIFIED';
}

// Shared exercise concepts; gym/home/box are environments when an exercise is explicit.
const concepts: readonly [WorkoutModality, RegExp][] = [
  ['CROSSFIT', /\b(?:cross(?:fit)?|wods?)\b/u],
  ['GYM_STRENGTH', /\b(?:musculacao|hipertrofia|pesos)\b/u],
  [
    'RUNNING',
    /\b(?:corrida|correr|corre|corro|prova de rua|\d+\s*(?:km|k))\b/u,
  ],
  ['WALKING', /\b(?:caminhad\w*|caminhar|caminhando|andar)\b/u],
  ['CYCLING', /\b(?:bike|ciclismo|pedal\w*)\b/u],
  ['CALISTHENICS', /\b(?:calistenia|paralela)\b/u],
  ['FUNCTIONAL', /\bfuncional\b/u],
  ['MOBILITY', /\bmobilidade\b/u],
  ['ACTIVE_RECOVERY', /\brecuperacao ativa\b/u],
  ['CARDIO_CONDITIONING', /\b(?:cardio|aerobic[oa])\b/u],
];

export function currentWorkoutModality(
  text: string,
): WorkoutModalityResolution {
  let value = normalize(affirmativePlanningText(text));
  const permission = runningTransitionPermission(text);
  const preference = [...value.matchAll(/\b(?:agora|na verdade|prefiro)\b/gu)]
    .filter((anchor) => {
      const tail = value.slice(anchor.index);
      return (
        concepts.some(([, pattern]) => {
          const mention = pattern.exec(tail);
          if (!mention) return false;
          return !/\b(?:nao(?: quero)?|sem|nada de|antes fazia)\s+(?:\w+\s+){0,2}$/u.test(
            tail.slice(0, mention.index),
          );
        }) || /\b(?:casa|home workout|peso corporal|academia|box)\b/u.test(tail)
      );
    })
    .at(-1);
  if (preference) value = value.slice(preference.index);
  // A performance purpose is subordinate to the requested exercise, even when
  // it appears before it: "para melhorar meu crossfit, quero musculação".
  value = value.replace(
    /\bpara\s+(?:melhorar|complementar|ajudar|aprimorar)\b[^,;.!?]*(?=,|;|\.|!|\?|$)/gu,
    ' ',
  );
  const matches = concepts
    .flatMap(([modality, pattern]) => {
      const match = pattern.exec(value);
      if (!match) return [];
      const prefix = value.slice(0, match.index);
      if (
        /\b(?:nao(?: quero)?|sem|nada de|antes fazia)\s+(?:\w+\s+){0,2}$/u.test(
          prefix,
        )
      )
        return [];
      return [{ modality, index: match.index }];
    })
    .sort((a, b) => a.index - b.index);
  const walking = matches.find((item) => item.modality === 'WALKING');
  const distanceOnly = !/\b(?:corrida|correr|corre|corro)\b/u.test(value);
  const candidates = matches.filter(
    (item) => !(walking && distanceOnly && item.modality === 'RUNNING'),
  );
  const ambiguous =
    candidates.length > 1 &&
    /\bou\b/u.test(value.slice(candidates[0].index, candidates.at(-1)?.index));
  // An explicit exercise is the head; a later purpose is not the requested modality.
  let modality: WorkoutModality | null = candidates[0]?.modality ?? null;
  if (!modality) {
    if (/\bbox\b/u.test(value)) modality = 'CROSSFIT';
    else if (/\b(?:casa|home workout|peso corporal)\b/u.test(value))
      modality = 'HOME_WORKOUT';
    else if (/\bacademia\b/u.test(value)) modality = 'GYM_STRENGTH';
  }
  const requested =
    /\b(?:quero|preciso|gostaria|mont\w*|cri\w*|faz(?:er)?|prefiro|na verdade)\b/u.test(
      normalize(affirmativePlanningText(text)),
    );
  if (ambiguous) modality = null;
  const action: WorkoutModalityResolution['action'] = ambiguous
    ? 'AMBIGUOUS'
    : modality && requested
      ? preference
        ? 'MODALITY_CHANGE'
        : 'PLAN_REQUEST'
      : 'OTHER';
  return Object.freeze({
    modality,
    confidence: modality ? 'HIGH' : 'LOW',
    source: 'DETERMINISTIC',
    action,
    runningTransitionPermission: permission,
    runningTransitionAuthorized:
      modality === 'WALKING' && permission === 'ALLOW',
  });
}

export function deterministicWorkoutModality(
  text: string,
): WorkoutModality | undefined {
  return currentWorkoutModality(text).modality ?? undefined;
}

/** No independent provider classification or cache. */
@Injectable()
export class WorkoutModalityResolutionService {
  resolve(
    text: string,
    interpretAction = false,
  ): Promise<WorkoutModalityResolution> {
    const result = currentWorkoutModality(text);
    return Promise.resolve(
      interpretAction && result.action === 'OTHER'
        ? { ...result, modality: null }
        : result,
    );
  }
}
