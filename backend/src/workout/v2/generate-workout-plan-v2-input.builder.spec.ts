import type { CoachProfileSnapshotBuilder } from '../../context/coach-profile-snapshot.builder';
import type { CoachProfileSnapshot } from '../../context/coach-profile-snapshot.contract';
import type { PrismaService } from '../../prisma/prisma.service';
import { GenerateWorkoutPlanV2InputBuilder } from './generate-workout-plan-v2-input.builder';
import { WorkoutPlanningReadinessService } from './workout-planning-readiness.service';

describe('GenerateWorkoutPlanV2InputBuilder', () => {
  const snapshot = Object.freeze({
    training: Object.freeze({
      preferredModality: Object.freeze({ status: 'UNKNOWN', sources: [] }),
    }),
    restrictions: Object.freeze({
      physicalLimitations: Object.freeze({
        status: 'KNOWN',
        value: Object.freeze([]),
        sources: Object.freeze([]),
      }),
    }),
    conflicts: Object.freeze([]),
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
    expect(declared.equipment).toEqual({
      status: 'INFERRED',
      value: [
        'BARBELL',
        'BENCH',
        'CABLE',
        'DUMBBELL',
        'MACHINE',
        'PULL_UP_BAR',
        'TREADMILL',
      ],
    });
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

  it.each([
    ['Monte um treino para academia', 'GYM_STRENGTH', 'FULL_GYM'],
    ['Quero musculação', 'GYM_STRENGTH', 'FULL_GYM'],
    ['Academia 5 vezes por semana', 'GYM_STRENGTH', 'FULL_GYM'],
    ['Treino em academia completa', 'GYM_STRENGTH', 'FULL_GYM'],
    ['Monte um treino de CrossFit', 'CROSSFIT', 'CROSSFIT_BOX'],
    ['Quero treinar CrossFit 4 vezes por semana', 'CROSSFIT', 'CROSSFIT_BOX'],
    ['Quero treinar em casa', 'HOME_WORKOUT', 'HOME'],
  ])('infers supported equipment for %s', (message, modality, environment) => {
    const declared = builder.recognizeDeclaredContext(message);
    expect(declared.modality?.value).toBe(modality);
    expect(declared.environment?.value).toBe(environment);
    expect(declared.equipment?.status).toBe('INFERRED');
    expect(declared.equipment?.value.length).toBeGreaterThan(0);
    if (environment === 'HOME')
      expect(declared.equipment?.value).toEqual(['BODYWEIGHT']);
  });

  it.each([
    ['Monte um treino de corrida', undefined],
    ['Quero começar a correr', undefined],
    ['Quero correr na rua', 'STREET'],
    ['Quero me preparar para 5 km', undefined],
    ['Corrida de rua 3 vezes por semana', 'STREET'],
    ['Quero correr na estrada', 'ROAD'],
    ['Quero correr na pista', 'TRACK'],
  ])('recognizes running without equipment for %s', (message, environment) => {
    const declared = builder.recognizeDeclaredContext(message);
    expect(declared.modality?.value).toBe('RUNNING');
    expect(declared.environment?.value).toBe(environment);
    expect(declared.equipment).toBeUndefined();
    if (message.includes('5 km'))
      expect(declared.targetDistanceKm?.value).toBe(5);
  });

  it.each([
    'academia pequena',
    'academia do condomínio',
    'academia do hotel',
    'academia, não tem barra',
    'academia, não tem máquina',
    'academia, só tenho halteres',
  ])('preserves limited equipment: %s', (message) => {
    const declared = builder.recognizeDeclaredContext(message);
    expect(declared.environment?.value).toBe('LIMITED_GYM');
    expect(declared.equipment?.status).not.toBe('INFERRED');
    expect(declared.equipment?.value ?? []).not.toContain('BARBELL');
    expect(declared.equipment?.value ?? []).not.toContain('MACHINE');
  });

  it('preserves stored limited gym and equipment instead of widening to defaults', async () => {
    const result = await builder.build({
      userId: 'limited-user',
      profileId: 'limited-profile',
      referenceDate: new Date('2026-08-19T12:00:00Z'),
      currentMessage: 'Monte um treino para academia',
      snapshot: {
        ...snapshot,
        training: {
          ...snapshot.training,
          environment: { status: 'KNOWN', value: 'LIMITED_GYM', sources: [] },
          availableEquipment: {
            status: 'KNOWN',
            value: ['DUMBBELL'],
            sources: [],
          },
        },
      },
    });
    expect(result.generationInput.recognizedContext.equipment).toBeUndefined();
    expect(
      result.generationInput.recognizedContext.environment,
    ).toBeUndefined();
    expect(
      result.generationInput.snapshot.training.availableEquipment,
    ).toMatchObject({ value: ['DUMBBELL'] });
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
        equipment: { status: 'CONFIRMED', value: ['BODYWEIGHT'] },
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

  it('preserves recomposition as primary and secondary objectives', () => {
    expect(
      builder.recognizeDeclaredContext(
        'Quero ganhar massa magra e perder gordura.',
      ),
    ).toEqual(
      expect.objectContaining({
        objective: { status: 'CONFIRMED', value: 'HYPERTROPHY' },
        secondaryObjectives: {
          status: 'CONFIRMED',
          value: ['WEIGHT_LOSS'],
        },
      }),
    );
  });

  it('recognizes the complete Gym 5x launch request', () => {
    expect(
      builder.recognizeDeclaredContext(
        'Monte um treino para eu fazer na academia, 5 vezes por semana, para ganho de massa magra.',
      ),
    ).toEqual(
      expect.objectContaining({
        modality: { status: 'CONFIRMED', value: 'GYM_STRENGTH' },
        environment: { status: 'CONFIRMED', value: 'FULL_GYM' },
        objective: { status: 'CONFIRMED', value: 'HYPERTROPHY' },
        weeklyFrequency: { status: 'CONFIRMED', value: 5 },
      }),
    );
  });

  it('extracts Gym, full environment and frequency from the production phrase', () => {
    expect(
      builder.recognizeDeclaredContext(
        'Treino em academia, monte um treino de 5 vezes na semana',
      ),
    ).toEqual(
      expect.objectContaining({
        modality: { status: 'CONFIRMED', value: 'GYM_STRENGTH' },
        environment: { status: 'CONFIRMED', value: 'FULL_GYM' },
        weeklyFrequency: { status: 'CONFIRMED', value: 5 },
      }),
    );
  });

  it('recognizes health, bodyweight and a valid explicit event date', () => {
    expect(
      builder.recognizeDeclaredContext(
        'Quero treino com peso corporal para saúde e uma prova em 20/10/2026.',
      ),
    ).toEqual(
      expect.objectContaining({
        modality: { status: 'CONFIRMED', value: 'HOME_WORKOUT' },
        objective: { status: 'CONFIRMED', value: 'GENERAL_HEALTH' },
        equipment: { status: 'CONFIRMED', value: ['BODYWEIGHT'] },
        targetEventDate: { status: 'CONFIRMED', value: '2026-10-20' },
      }),
    );
  });

  it.each([
    ['3x', 3],
    ['quatro vezes por semana', 4],
    ['5 dias', 5],
    ['seis vezes na semana', 6],
  ])('recognizes weekly frequency from %s', (message, frequency) => {
    expect(builder.recognizeDeclaredContext(message).weeklyFrequency).toEqual({
      status: 'CONFIRMED',
      value: frequency,
    });
  });

  it('preserves explicitly available home equipment and weekdays', () => {
    expect(
      builder.recognizeDeclaredContext(
        'Em casa tenho dois halteres e elástico; posso segunda, quarta e sábado.',
      ),
    ).toEqual(
      expect.objectContaining({
        environment: { status: 'CONFIRMED', value: 'HOME' },
        equipment: {
          status: 'CONFIRMED',
          value: ['DUMBBELL', 'RESISTANCE_BAND', 'BODYWEIGHT'],
        },
        availableTrainingDays: {
          status: 'CONFIRMED',
          value: ['MONDAY', 'WEDNESDAY', 'SATURDAY'],
        },
      }),
    );
  });

  it.each([
    ['Tenho halteres e elástico.', ['DUMBBELL', 'RESISTANCE_BAND']],
    ['Não tenho halteres, só elástico.', ['RESISTANCE_BAND']],
    ['Tenho halteres, mas não tenho barra.', ['DUMBBELL']],
    ['Não tenho nenhum aparelho.', ['BODYWEIGHT']],
    ['Treino em casa sem equipamentos.', ['BODYWEIGHT']],
    ['Não tenho máquina, mas tenho dois halteres.', ['DUMBBELL']],
    ['Não tenho nenhum aparelho, mas tenho um elástico.', ['RESISTANCE_BAND']],
    ['Não tenho aparelhos de academia, só tenho dois halteres.', ['DUMBBELL']],
    [
      'Em casa não tenho aparelhos, só halteres e elástico.',
      ['DUMBBELL', 'RESISTANCE_BAND', 'BODYWEIGHT'],
    ],
  ] as const)(
    'keeps only positively declared equipment from %s',
    (message, equipment) => {
      expect(builder.recognizeDeclaredContext(message).equipment).toEqual({
        status: 'CONFIRMED',
        value: equipment,
      });
    },
  );

  it('does not promote ambiguous or exclusively denied equipment', () => {
    expect(
      builder.recognizeDeclaredContext('Talvez eu tenha halteres.').equipment,
    ).toEqual({ status: 'REQUIRES_CONFIRMATION', value: [] });
    expect(
      builder.recognizeDeclaredContext('Não tenho halteres.').equipment,
    ).toEqual({ status: 'REQUIRES_CONFIRMATION', value: [] });
  });

  it.each([
    ['Posso segunda, quarta e sábado.', ['MONDAY', 'WEDNESDAY', 'SATURDAY']],
    ['Não posso segunda. Posso terça e quinta.', ['TUESDAY', 'THURSDAY']],
    [
      'Consigo treinar quarta e sexta, menos sexta nesta semana.',
      ['WEDNESDAY'],
    ],
  ] as const)(
    'confirms only positive weekday availability from %s',
    (message, weekdays) => {
      expect(
        builder.recognizeDeclaredContext(message).availableTrainingDays,
      ).toEqual({ status: 'CONFIRMED', value: weekdays });
    },
  );

  it('does not infer six available days from one denied weekday', () => {
    expect(
      builder.recognizeDeclaredContext('Não treino domingo.')
        .availableTrainingDays,
    ).toEqual({ status: 'REQUIRES_CONFIRMATION', value: [] });
  });

  it('requires clarification when confirmed frequency exceeds confirmed days', () => {
    const declared = builder.recognizeDeclaredContext(
      'Quero 5 vezes por semana; posso segunda, quarta e sexta.',
    );
    const readiness = new WorkoutPlanningReadinessService().evaluate(
      snapshot,
      'WEEKLY_PLAN',
      'GYM_STRENGTH',
      {
        ...declared,
        artifactType: 'WEEKLY_PLAN',
        modality: { status: 'CONFIRMED', value: 'GYM_STRENGTH' },
        objective: { status: 'CONFIRMED', value: 'HYPERTROPHY' },
        experience: { status: 'CONFIRMED', value: 'INTERMEDIATE' },
        sessionDurationMinutes: { status: 'CONFIRMED', value: 60 },
        environment: { status: 'CONFIRMED', value: 'FULL_GYM' },
        equipment: { status: 'CONFIRMED', value: ['DUMBBELL'] },
      },
      false,
    );

    expect(declared.weeklyFrequency).toEqual({
      status: 'REQUIRES_CONFIRMATION',
      value: 5,
    });
    expect(declared.availableTrainingDays).toEqual({
      status: 'CONFIRMED',
      value: ['MONDAY', 'WEDNESDAY', 'FRIDAY'],
    });
    expect(readiness.status).toBe('REQUIRES_CONFIRMATION');
    expect(readiness.executionLevel).toBe('CLARIFICATION_ONLY');
    expect(readiness.confirmationRequiredFields).toContain('WEEKLY_FREQUENCY');
  });

  it('keeps matching frequency and available days confirmed', () => {
    const declared = builder.recognizeDeclaredContext(
      'Quero 3 vezes por semana; posso segunda, quarta e sexta.',
    );

    expect(declared.weeklyFrequency).toEqual({
      status: 'CONFIRMED',
      value: 3,
    });
    expect(declared.availableTrainingDays).toEqual({
      status: 'CONFIRMED',
      value: ['MONDAY', 'WEDNESDAY', 'FRIDAY'],
    });
  });

  it('does not create a frequency conflict when days were not declared', () => {
    const declared = builder.recognizeDeclaredContext(
      'Quero 5 vezes por semana.',
    );

    expect(declared.weeklyFrequency).toEqual({
      status: 'CONFIRMED',
      value: 5,
    });
    expect(declared.availableTrainingDays).toBeUndefined();
  });

  it('does not infer frequency from declared available days', () => {
    const declared = builder.recognizeDeclaredContext(
      'Posso segunda, quarta e sexta.',
    );

    expect(declared.weeklyFrequency).toBeUndefined();
    expect(declared.availableTrainingDays).toEqual({
      status: 'CONFIRMED',
      value: ['MONDAY', 'WEDNESDAY', 'FRIDAY'],
    });
  });
});
