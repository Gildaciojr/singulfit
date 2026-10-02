import { declaredWorkoutProfileFacts } from '../../workout/v2/workout-declared-profile-facts';
import type { ProfileAcquisitionConversationContext } from '../coach-adaptive-profile-collector.contract';
import {
  workoutEquipmentBaseline,
  isWorkoutEquipmentBaseline,
} from '../../workout/v2/workout-equipment-defaults';

/** Project the shared parser's explicit facts; never persist its equipment baseline. */
export function productiveWorkoutProfileFacts(
  message: string,
  context: ProfileAcquisitionConversationContext = {},
): ProfileAcquisitionConversationContext {
  const declared = declaredWorkoutProfileFacts(message);
  const environment = declared.environmentMentioned
    ? declared.environment
      ? { value: declared.environment, evidence: 'EXPLICIT' as const }
      : undefined
    : context.environment;
  const weeklyFrequency = declared.frequencyMentioned
    ? declared.weeklyFrequency !== null
      ? { value: declared.weeklyFrequency, evidence: 'EXPLICIT' as const }
      : undefined
    : context.weeklyFrequency;
  const baseline = workoutEquipmentBaseline(environment?.value);
  const equipment =
    context.equipment?.evidence === 'EXPLICIT'
      ? context.equipment
      : declared.equipmentScope.restricted ||
          (environment?.value === 'LIMITED_GYM' &&
            isWorkoutEquipmentBaseline('FULL_GYM', context.equipment?.value)) ||
          (declared.environmentMentioned && !environment)
        ? undefined
        : (context.equipment ??
          (baseline?.status === 'INFERRED'
            ? { value: baseline.value, evidence: 'INFERRED' as const }
            : undefined));
  return Object.freeze({ ...context, environment, weeklyFrequency, equipment });
}
