import { durableTextOperation } from '../../../ai/durable-text-operation.contract';
import type { WorkoutApplicationExecutionInputV2 } from './workout-application-execution.contract';

export function workoutDurableContinuation(
  result: unknown,
): WorkoutApplicationExecutionInputV2 | null {
  const durable = durableTextOperation(result);
  if (!durable) return null;
  let context: unknown;
  try {
    context = JSON.parse(durable.executionContext);
  } catch {
    return null;
  }
  if (
    !context ||
    typeof context !== 'object' ||
    !('applicationInput' in context)
  )
    return null;
  const input = context.applicationInput;
  if (
    !input ||
    typeof input !== 'object' ||
    !('generationInput' in input) ||
    !('ownership' in input)
  )
    return null;
  const generation = input.generationInput;
  const ownership = input.ownership;
  if (
    !generation ||
    typeof generation !== 'object' ||
    !ownership ||
    typeof ownership !== 'object' ||
    !('userId' in ownership) ||
    typeof ownership.userId !== 'string' ||
    !('profileId' in ownership) ||
    typeof ownership.profileId !== 'string' ||
    !('userId' in generation) ||
    generation.userId !== ownership.userId ||
    !('referenceDate' in generation) ||
    typeof generation.referenceDate !== 'string' ||
    !Number.isFinite(Date.parse(generation.referenceDate)) ||
    !('currentRequest' in generation) ||
    !generation.currentRequest ||
    typeof generation.currentRequest !== 'object' ||
    !('requestId' in generation.currentRequest) ||
    typeof generation.currentRequest.requestId !== 'string' ||
    !('snapshot' in generation) ||
    !generation.snapshot ||
    !('recognizedContext' in generation) ||
    !('decision' in generation)
  )
    return null;
  const stored = input as unknown as WorkoutApplicationExecutionInputV2;
  return {
    ...stored,
    generationInput: {
      ...stored.generationInput,
      referenceDate: new Date(generation.referenceDate),
    },
  };
}
