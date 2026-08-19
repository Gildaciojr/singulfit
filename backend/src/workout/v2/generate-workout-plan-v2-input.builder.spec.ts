import type { CoachProfileSnapshotBuilder } from '../../context/coach-profile-snapshot.builder';
import type { CoachProfileSnapshot } from '../../context/coach-profile-snapshot.contract';
import type { PrismaService } from '../../prisma/prisma.service';
import { GenerateWorkoutPlanV2InputBuilder } from './generate-workout-plan-v2-input.builder';

describe('GenerateWorkoutPlanV2InputBuilder', () => {
  const snapshot = Object.freeze({
    training: Object.freeze({
      preferredModality: Object.freeze({ status: 'UNKNOWN', sources: [] }),
    }),
    completion: Object.freeze({ overall: 'PARTIAL', sections: [] }),
  }) as unknown as CoachProfileSnapshot;
  const builder = new GenerateWorkoutPlanV2InputBuilder(
    {} as CoachProfileSnapshotBuilder,
    {} as PrismaService,
  );

  it.each([
    [
      'quero treinar 4 vezes por semana',
      'weeklyFrequency',
      { status: 'CONFIRMED', value: 4 },
    ],
    [
      'vou treinar só 3 vezes esta semana',
      'weeklyFrequency',
      { status: 'CONFIRMED', value: 3 },
    ],
    [
      'quero treinar em casa',
      'environment',
      { status: 'CONFIRMED', value: 'HOME' },
    ],
    [
      'tenho 40 minutos para treinar',
      'sessionDurationMinutes',
      { status: 'CONFIRMED', value: 40 },
    ],
    [
      'quero musculação',
      'modality',
      { status: 'CONFIRMED', value: 'GYM_STRENGTH' },
    ],
    ['sou iniciante', 'experience', { status: 'CONFIRMED', value: 'BEGINNER' }],
  ] as const)(
    'preserves declared context from %s',
    async (message, field, value) => {
      const result = await builder.build({
        userId: 'user-id',
        profileId: 'profile-id',
        snapshot,
        referenceDate: new Date('2026-08-18T12:00:00.000Z'),
        currentMessage: message,
      });

      expect(result.generationInput.recognizedContext[field]).toEqual(value);
      expect(result.generationInput.recognizedContext.artifactType).toBe(
        'WEEKLY_PLAN',
      );
    },
  );

  it('recognizes the complete explicit context from the production workout request without inventing absent facts', async () => {
    const message =
      'Quero que você monte um treino de musculação para mim. quero treinar 4 vezes por semana, cerca de 60 minutos por treino, na academia.';
    const declared = builder.recognizeDeclaredContext(message);

    expect(declared).toEqual(
      expect.objectContaining({
        modality: { status: 'CONFIRMED', value: 'GYM_STRENGTH' },
        environment: { status: 'CONFIRMED', value: 'FULL_GYM' },
        weeklyFrequency: { status: 'CONFIRMED', value: 4 },
        sessionDurationMinutes: { status: 'CONFIRMED', value: 60 },
      }),
    );
    expect(declared.experience).toBeUndefined();
    expect(declared.equipment).toBeUndefined();
    expect(declared.movementConstraints).toEqual([]);
    expect(declared.safetySignals).toEqual([]);

    const result = await builder.build({
      userId: 'user-id',
      profileId: 'profile-id',
      snapshot,
      referenceDate: new Date('2026-08-19T12:00:00.000Z'),
      currentMessage: message,
    });

    expect(result.generationInput.recognizedContext).toEqual(
      expect.objectContaining({
        modality: declared.modality,
        environment: declared.environment,
        weeklyFrequency: declared.weeklyFrequency,
        sessionDurationMinutes: declared.sessionDurationMinutes,
      }),
    );
  });

  it('does not invent an unavailable modality', async () => {
    const result = await builder.build({
      userId: 'user-id',
      profileId: 'profile-id',
      snapshot,
      referenceDate: new Date('2026-08-18T12:00:00.000Z'),
      currentMessage: 'monte um treino para mim',
    });

    expect(result.generationInput.recognizedContext.modality).toEqual({
      status: 'NOT_SET',
    });
  });

  it.each([
    ['hoje quero treinar peito', ['CHEST']],
    ['quero focar glúteos', ['GLUTES']],
    ['costas e bíceps', ['BACK', 'BICEPS']],
    ['quero trabalhar corpo inteiro', ['FULL_BODY']],
  ])('transports controlled muscle focus from %s', async (message, focus) => {
    const result = await builder.build({
      userId: 'user-id',
      profileId: 'profile-id',
      snapshot,
      referenceDate: new Date('2026-08-18T12:00:00.000Z'),
      currentMessage: message,
    });

    expect(result.generationInput.recognizedContext.muscleFocus).toEqual({
      status: 'CONFIRMED',
      value: focus,
    });
  });

  it.each([
    ['quero correr na rua', 'RUNNING', 'STREET'],
    ['quero correr em pista', 'RUNNING', 'TRACK'],
    ['quero correr em trilha', 'RUNNING', 'TRAIL'],
    ['quero fazer CrossFit', 'CROSSFIT', 'CROSSFIT_BOX'],
  ])(
    'maps modality and environment from %s',
    async (message, modality, environment) => {
      const result = await builder.build({
        userId: 'user-id',
        profileId: 'profile-id',
        snapshot,
        referenceDate: new Date('2026-08-18T12:00:00.000Z'),
        currentMessage: message,
      });

      expect(result.generationInput.recognizedContext).toEqual(
        expect.objectContaining({
          modality: { status: 'CONFIRMED', value: modality },
          environment: { status: 'CONFIRMED', value: environment },
        }),
      );
    },
  );

  it('preserves current and target running distances without inventing ability', async () => {
    const knownAbility = await builder.build({
      userId: 'user-id',
      profileId: 'profile-id',
      snapshot,
      referenceDate: new Date('2026-08-18T12:00:00.000Z'),
      currentMessage: 'já corro 5 km e quero chegar a 10 km',
    });
    const unknownAbility = await builder.build({
      userId: 'user-id',
      profileId: 'profile-id',
      snapshot,
      referenceDate: new Date('2026-08-18T12:00:00.000Z'),
      currentMessage: 'quero me preparar para uma prova de 10 km',
    });

    expect(knownAbility.generationInput.recognizedContext).toEqual(
      expect.objectContaining({
        modality: { status: 'CONFIRMED', value: 'RUNNING' },
        objective: { status: 'CONFIRMED', value: 'COMPLETE_DISTANCE' },
        currentRunningDistanceKm: { status: 'CONFIRMED', value: 5 },
        targetDistanceKm: { status: 'CONFIRMED', value: 10 },
      }),
    );
    expect(
      unknownAbility.generationInput.recognizedContext.currentRunningDistanceKm,
    ).toBeUndefined();
    expect(unknownAbility.generationInput.recognizedContext.modality).toEqual({
      status: 'CONFIRMED',
      value: 'RUNNING',
    });
  });

  it('maps a beginner request to start running without inventing current distance', async () => {
    const result = await builder.build({
      userId: 'user-id',
      profileId: 'profile-id',
      snapshot,
      referenceDate: new Date('2026-08-18T12:00:00.000Z'),
      currentMessage: 'sou iniciante e quero começar a correr',
    });

    expect(result.generationInput.recognizedContext).toEqual(
      expect.objectContaining({
        modality: { status: 'CONFIRMED', value: 'RUNNING' },
        objective: { status: 'CONFIRMED', value: 'CONDITIONING' },
        experience: { status: 'CONFIRMED', value: 'BEGINNER' },
      }),
    );
    expect(
      result.generationInput.recognizedContext.currentRunningDistanceKm,
    ).toBeUndefined();
  });

  it('maps explicit home cardio without equipment', async () => {
    const result = await builder.build({
      userId: 'user-id',
      profileId: 'profile-id',
      snapshot,
      referenceDate: new Date('2026-08-18T12:00:00.000Z'),
      currentMessage: 'quero um aeróbico de 30 minutos em casa sem equipamento',
    });

    expect(result.generationInput.recognizedContext).toEqual(
      expect.objectContaining({
        modality: { status: 'CONFIRMED', value: 'CARDIO_CONDITIONING' },
        objective: { status: 'CONFIRMED', value: 'CONDITIONING' },
        environment: { status: 'CONFIRMED', value: 'HOME' },
        equipment: { status: 'CONFIRMED', value: [] },
        sessionDurationMinutes: { status: 'CONFIRMED', value: 30 },
      }),
    );
  });

  it('gives explicit current-turn focus priority over older inferred context', async () => {
    const result = await builder.build({
      userId: 'user-id',
      profileId: 'profile-id',
      snapshot,
      referenceDate: new Date('2026-08-18T12:00:00.000Z'),
      recognizedContext: Object.freeze({
        muscleFocus: Object.freeze({
          status: 'INFERRED',
          value: Object.freeze(['CHEST' as const]),
        }),
      }),
      currentMessage: 'quero focar glúteos',
    });

    expect(result.generationInput.recognizedContext.muscleFocus).toEqual({
      status: 'CONFIRMED',
      value: ['GLUTES'],
    });
  });
});
