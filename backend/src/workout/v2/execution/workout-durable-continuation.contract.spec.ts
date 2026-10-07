import { DURABLE_TEXT_REVISION } from '../../../ai/durable-text-operation.contract';
import { workoutDurableContinuation } from './workout-durable-continuation.contract';

describe('Workout durable legacy release boundary', () => {
  it('identifies missing applicationInput as legacy without inference or mutation', () => {
    const result = {
      durableTextOperation: {
        revision: DURABLE_TEXT_REVISION,
        requestInput: '{}',
        executionContext: JSON.stringify({
          prepared: { strategy: { modality: 'CROSSFIT' } },
          recognizedContext: {},
          previousPlan: null,
        }),
        deadlineAt: new Date().toISOString(),
        attempts: [
          {
            attemptKey: 'operation:attempt:1',
            phase: 'POLLING',
            responseId: 'existing-response',
            usageRecorded: false,
            response: null,
          },
        ],
        repairInput: null,
        initialValidated: false,
        accountingIssue: null,
      },
    };
    const before = JSON.stringify(result);
    expect(workoutDurableContinuation(result)).toBeNull();
    expect(JSON.stringify(result)).toBe(before);
  });
});
