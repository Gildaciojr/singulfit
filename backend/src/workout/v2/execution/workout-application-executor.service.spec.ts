import type { WorkoutPlanningEngineV2Service } from '../workout-planning-engine-v2.service';
import type { WorkoutPlanV2PersistenceService } from '../persistence/workout-plan-v2-persistence.service';
import type { WorkoutApplicationExecutionInputV2 } from './workout-application-execution.contract';
import { WorkoutApplicationExecutorService } from './workout-application-executor.service';

describe('WorkoutApplicationExecutorService', () => {
  function input(days?: readonly string[]): WorkoutApplicationExecutionInputV2 {
    return Object.freeze({
      generationInput: Object.freeze({
        userId: 'user-id',
        snapshot: days
          ? {
              routine: {
                availableTrainingDays: { status: 'KNOWN', value: days },
              },
            }
          : undefined,
      }),
      ownership: Object.freeze({ userId: 'user-id', profileId: 'profile-id' }),
      executionContext: Object.freeze({ correlationId: 'correlation-id' }),
    }) as unknown as WorkoutApplicationExecutionInputV2;
  }

  function ready() {
    return Object.freeze({
      resolution: Object.freeze({ reason: 'EXPLICIT_REQUEST' }),
      readiness: Object.freeze({
        status: 'READY',
        missingFields: Object.freeze([]),
        confirmationRequiredFields: Object.freeze([]),
        safetyFlags: Object.freeze([]),
      }),
      context: Object.freeze({}),
      strategy: Object.freeze({}),
      safety: Object.freeze({
        outcome: 'ALLOWED',
        reasonCodes: Object.freeze([]),
      }),
    });
  }

  function setup(prepared = ready()) {
    const engine = {
      prepare: jest.fn().mockReturnValue(prepared),
      generateCandidate: jest.fn().mockResolvedValue({
        status: 'PENDING_COMPLETION',
        output: { artifactType: 'WEEKLY_PLAN' },
      }),
    };
    const persistence = {
      persist: jest.fn().mockResolvedValue({
        persistence: 'CREATED',
        aiJobCompleted: true,
        aggregate: {
          id: 'plan-id',
          document: { artifactType: 'WEEKLY_PLAN' },
        },
      }),
    };
    return {
      engine,
      persistence,
      executor: new WorkoutApplicationExecutorService(
        engine as unknown as WorkoutPlanningEngineV2Service,
        persistence as unknown as WorkoutPlanV2PersistenceService,
      ),
    };
  }

  it('prepares before one generation and persists a pending candidate once', async () => {
    const subject = setup();
    await expect(subject.executor.execute(input())).resolves.toMatchObject({
      kind: 'PLAN',
      aggregateId: 'plan-id',
      persistence: 'CREATED',
    });
    expect(subject.engine.prepare).toHaveBeenCalledTimes(1);
    expect(subject.engine.generateCandidate).toHaveBeenCalledTimes(1);
    expect(subject.persistence.persist).toHaveBeenCalledTimes(1);
    expect(subject.engine.prepare.mock.invocationCallOrder[0]).toBeLessThan(
      subject.engine.generateCandidate.mock.invocationCallOrder[0],
    );
    expect(
      subject.engine.generateCandidate.mock.invocationCallOrder[0],
    ).toBeLessThan(subject.persistence.persist.mock.invocationCallOrder[0]);
  });

  it('persists a validated explicit weekday calendar separately from session order', async () => {
    const subject = setup();
    await subject.executor.execute(
      input(['MONDAY', 'TUESDAY', 'THURSDAY', 'SATURDAY']),
    );
    expect(subject.persistence.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarWeekdays: ['MONDAY', 'TUESDAY', 'THURSDAY', 'SATURDAY'],
      }),
    );
  });

  it('does not persist an invalid or duplicate weekday calendar', async () => {
    const subject = setup();
    await subject.executor.execute(input(['MONDAY', 'MONDAY', 'invalid']));
    expect(subject.persistence.persist).toHaveBeenCalledWith(
      expect.objectContaining({ calendarWeekdays: undefined }),
    );
  });

  it.each([
    ['BLOCKED', ['MODALITY'], []],
    ['REQUIRES_CONFIRMATION', [], ['PHYSICAL_LIMITATIONS']],
  ] as const)(
    'returns clarification for readiness %s without effects',
    async (status, missingFields, confirmationRequiredFields) => {
      const subject = setup({
        ...ready(),
        readiness: {
          status,
          missingFields,
          confirmationRequiredFields,
          safetyFlags: [],
        },
        safety:
          status === 'BLOCKED'
            ? { outcome: 'BLOCKED', reasonCodes: ['READINESS_BLOCKED'] }
            : {
                outcome: 'REQUIRES_CONFIRMATION',
                reasonCodes: ['PROFILE_CONFIRMATION_REQUIRED'],
              },
      });
      await expect(subject.executor.execute(input())).resolves.toMatchObject({
        kind: 'CLARIFICATION',
        missingFields,
        confirmationRequiredFields,
      });
      expect(subject.engine.generateCandidate).not.toHaveBeenCalled();
      expect(subject.persistence.persist).not.toHaveBeenCalled();
    },
  );

  it('blocks safety before generation and persistence', async () => {
    const subject = setup({
      ...ready(),
      safety: { outcome: 'BLOCKED', reasonCodes: ['ACUTE_PAIN'] },
    });
    await expect(subject.executor.execute(input())).resolves.toMatchObject({
      kind: 'BLOCKED',
      reasonCodes: ['ACUTE_PAIN'],
    });
    expect(subject.engine.generateCandidate).not.toHaveBeenCalled();
    expect(subject.persistence.persist).not.toHaveBeenCalled();
  });

  it('clarifies missing current running distance before AIJob, provider or persistence', async () => {
    const subject = setup({
      ...ready(),
      readiness: {
        status: 'BLOCKED',
        missingFields: ['CURRENT_RUNNING_DISTANCE'],
        confirmationRequiredFields: [],
        safetyFlags: [],
      },
      safety: {
        outcome: 'BLOCKED',
        reasonCodes: ['READINESS_BLOCKED'],
      },
    });

    await expect(subject.executor.execute(input())).resolves.toMatchObject({
      kind: 'CLARIFICATION',
      missingFields: ['CURRENT_RUNNING_DISTANCE'],
    });
    expect(subject.engine.generateCandidate).not.toHaveBeenCalled();
    expect(subject.persistence.persist).not.toHaveBeenCalled();
  });

  it('reuses ALREADY_COMPLETED through idempotent persistence', async () => {
    const subject = setup();
    subject.engine.generateCandidate.mockResolvedValueOnce({
      status: 'ALREADY_COMPLETED',
      output: { artifactType: 'WEEKLY_PLAN' },
    });
    subject.persistence.persist.mockResolvedValueOnce({
      persistence: 'REUSED',
      aiJobCompleted: true,
      aggregate: {
        id: 'plan-id',
        document: { artifactType: 'WEEKLY_PLAN' },
      },
    });
    await expect(subject.executor.execute(input())).resolves.toMatchObject({
      kind: 'PLAN',
      persistence: 'REUSED',
    });
    expect(subject.engine.generateCandidate).toHaveBeenCalledTimes(1);
    expect(subject.persistence.persist).toHaveBeenCalledTimes(1);
  });

  it.each(['provider failure', 'validator safety failure'])(
    'never persists after %s',
    async (message) => {
      const subject = setup();
      subject.engine.generateCandidate.mockRejectedValueOnce(
        new Error(message),
      );
      await expect(subject.executor.execute(input())).rejects.toThrow(message);
      expect(subject.persistence.persist).not.toHaveBeenCalled();
    },
  );
});
