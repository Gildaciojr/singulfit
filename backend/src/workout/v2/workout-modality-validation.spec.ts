import { WORKOUT_PLANNING_V2_PROMPT } from './workout-planning-v2.prompt.definition';
import { WorkoutPromptActivationService } from './workout-prompt-activation.service';
import { AIJobStatus } from '@prisma/client';
import { AIService } from '../../ai/ai.service';
import { WorkoutArtifactResolverService } from './workout-artifact-resolver.service';
import { WorkoutPlanningReadinessService } from './workout-planning-readiness.service';
import { WorkoutPlanningContextBuilder } from './workout-planning-context.builder';
import { WorkoutPlanningStrategyService } from './workout-planning-strategy.service';
import { WorkoutPlanningSafetyService } from './workout-planning-safety.service';
import { WorkoutPlanV2Validator } from './workout-plan-v2.validator';
import {
  WorkoutPlanningEngineV2Service,
  WorkoutPostGenerationValidationError,
} from './workout-planning-engine-v2.service';
import { WorkoutPlanV2Formatter } from './workout-plan-v2.formatter';
import { GenerateWorkoutPlanV2InputBuilder } from './generate-workout-plan-v2-input.builder';
import {
  routingSnapshot,
  knownDatum,
} from '../../conversation/tests/conversation-routing.fixtures';
import { qualityContext, strength } from './workout-quality.fixtures';
import { workoutModalityActivityIssue } from './workout-modality-expertise.policy';
import type {
  GeneratedWorkoutPlanV2Candidate,
  EnduranceActivity,
} from './workout-plan-v2.contract';

describe('Hard modality validation before persistence and public formatting', () => {
  const strategyBuilder = new WorkoutPlanningStrategyService();
  const walk = (key = 'walk'): EnduranceActivity => ({
    activityKey: key,
    source: 'MODEL_GENERATED',
    equipment: ['BODYWEIGHT'],
    alerts: [],
    appliedConstraintCodes: [],
    kind: 'ENDURANCE',
    name: 'Caminhada confortável',
    instruction: 'Mantenha passos regulares e esforço confortável.',
    mode: 'WALK',
    durationMinutes: 20,
    distanceKm: null,
    intensity: 'CONVERSATIONAL',
    movementPattern: 'LOCOMOTION',
  });
  const base = strategyBuilder.build(qualityContext());
  it.each(['RUN', 'CYCLE'] as const)(
    'rejects structured %s in pure walking even with a misleading name',
    (mode) => {
      expect(
        workoutModalityActivityIssue({ ...walk(), mode }, 'ENDURANCE', {
          ...base,
          modality: 'WALKING',
        }),
      ).toMatchObject({
        code: 'MODALITY_ACTIVITY_CONFLICT',
        severity: 'ERROR',
      });
    },
  );
  it.each([
    'Alterne trote leve e caminhada',
    'Faça run/walk leve',
    'Jogging confortável',
    'Sprint curto',
    'Faça corrida leve',
  ])('rejects walking contamination in the instruction: %s', (instruction) => {
    expect(
      workoutModalityActivityIssue({ ...walk(), instruction }, 'ENDURANCE', {
        ...base,
        modality: 'WALKING',
      }),
    ).not.toBeNull();
  });
  it('allows a typed explicitly authorized walking transition', () => {
    expect(
      workoutModalityActivityIssue(
        {
          ...walk(),
          mode: 'RUN',
          instruction: 'Alterne trote leve e caminhada.',
        },
        'INTERVAL',
        { ...base, modality: 'WALKING', runningTransitionAuthorized: true },
      ),
    ).toBeNull();
  });
  it('does not mistake a negative safety instruction for a running prescription', () => {
    expect(
      workoutModalityActivityIssue(
        {
          ...walk(),
          instruction: 'Não corra. Evite trote. Caminhe confortavelmente.',
        },
        'ENDURANCE',
        { ...base, modality: 'WALKING' },
      ),
    ).toBeNull();
  });
  it.each(['RUN', 'WALK', 'CYCLE'] as const)(
    'keeps %s as a legitimate CrossFit WOD component',
    (mode) => {
      expect(
        workoutModalityActivityIssue({ ...walk(), mode }, 'CONDITIONING', {
          ...base,
          modality: 'CROSSFIT',
        }),
      ).toBeNull();
    },
  );
  it('allows walking in running warm-up and beginner run/walk roles', () => {
    expect(
      workoutModalityActivityIssue(walk(), 'WARM_UP', {
        ...base,
        modality: 'RUNNING',
      }),
    ).toBeNull();
    expect(
      workoutModalityActivityIssue(walk(), 'INTERVAL', {
        ...base,
        modality: 'RUNNING',
      }),
    ).toBeNull();
  });
  it('rejects a walking main block in cycling', () => {
    expect(
      workoutModalityActivityIssue(walk(), 'ENDURANCE', {
        ...base,
        modality: 'CYCLING',
      }),
    ).not.toBeNull();
  });
  it('keeps beginner/limited CrossFit different from a ready advanced strategy', () => {
    const original = qualityContext();
    const context = {
      ...original,
      modality: { status: 'CONFIRMED' as const, value: 'CROSSFIT' as const },
    };
    const beginner = strategyBuilder.build({
      ...context,
      training: {
        ...context.training,
        experience: { status: 'CONFIRMED', value: 'BEGINNER' },
      },
    });
    const advanced = strategyBuilder.build({
      ...context,
      training: {
        ...context.training,
        experience: { status: 'CONFIRMED', value: 'ADVANCED' },
      },
    });
    const limited = strategyBuilder.build({
      ...context,
      movementConstraints: [
        { code: 'IMPACT', label: 'Evitar impacto', status: 'CONFIRMED' },
      ],
      training: {
        ...context.training,
        experience: { status: 'CONFIRMED', value: 'ADVANCED' },
      },
    });
    expect(beginner.technicalMovementsAllowed).toBe(false);
    expect(beginner.sessionFocuses).not.toEqual(advanced.sessionFocuses);
    expect(limited.appliedConstraints).toContainEqual({
      code: 'IMPACT',
      label: 'Evitar impacto',
      status: 'CONFIRMED',
    });
    expect(beginner.authorizedEquipment).toEqual(['BODYWEIGHT']);
    const validator = new WorkoutPlanV2Validator();
    const forbidden = {
      ...strength(),
      name: 'Snatch pesado',
      equipment: ['BARBELL' as const],
    };
    const candidate: GeneratedWorkoutPlanV2Candidate = {
      artifactType: 'WEEKLY_PLAN',
      modality: 'CROSSFIT',
      objective: 'WEIGHT_LOSS',
      title: 'Treino',
      sessions: [
        {
          sessionKey: 's',
          sequence: 1,
          label: 'Skill',
          estimatedDurationMinutes: 10,
          blocks: [
            {
              blockKey: 'b',
              type: 'TECHNIQUE',
              title: 'Técnica',
              estimatedDurationMinutes: 10,
              activities: [forbidden],
            },
          ],
        },
      ],
      progression: [],
      substitutions: [],
      adaptationRules: [],
      safetyFlags: [],
    };
    const issues = validator.validate(candidate, context, beginner).issues;
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'EQUIPMENT_UNAVAILABLE' }),
        expect.objectContaining({ code: 'TECHNICAL_MOVEMENT_UNSAFE' }),
      ]),
    );
  });

  async function productionWalking() {
    const builder = new GenerateWorkoutPlanV2InputBuilder(
      {} as never,
      {} as never,
      undefined,
    );
    const snapshot = routingSnapshot();
    const built = await builder.build({
      userId: 'user-id',
      profileId: 'profile-id',
      snapshot: {
        ...snapshot,
        nutrition: {
          ...snapshot.nutrition,
          primaryGoal: knownDatum('WEIGHT_LOSS'),
        },
        physical: { ...snapshot.physical, ageYears: knownDatum(34) },
        training: {
          ...snapshot.training,
          preferredModality: knownDatum('RUNNING'),
          primaryGoal: knownDatum('WEIGHT_LOSS'),
          experienceLevel: knownDatum('BEGINNER'),
          environment: knownDatum('STREET'),
          perceivedConditioning: knownDatum('LOW'),
          availableEquipment: knownDatum(['BODYWEIGHT']),
        },
      },
      currentMessage:
        'monte um treino de caminhada para mim, 5 vezes por semana',
      referenceDate: new Date(snapshot.referenceDate),
    });
    const input = {
      ...built.generationInput,
      recognizedContext: {
        ...built.generationInput.recognizedContext,
        sessionDurationMinutes: { status: 'CONFIRMED' as const, value: 30 },
      },
    };
    const ai = {
      createStandaloneJob: jest.fn().mockResolvedValue({
        id: 'job',
        status: AIJobStatus.PENDING,
        promptVersionId: 'v8',
        promptVersion: { version: 8, name: WORKOUT_PLANNING_V2_PROMPT.name },
      }),
      runTextJob: jest.fn(),
      failJob: jest.fn(),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const engine = new WorkoutPlanningEngineV2Service(
      new WorkoutArtifactResolverService(),
      new WorkoutPlanningReadinessService(),
      new WorkoutPlanningContextBuilder(),
      strategyBuilder,
      new WorkoutPlanningSafetyService(),
      new WorkoutPlanV2Validator(),
      ai as unknown as AIService,
      audit as never,
      {
        ensureActive: jest.fn().mockResolvedValue(undefined),
      } as unknown as WorkoutPromptActivationService,
    );
    const prepared = engine.prepare(input);
    if (!prepared.strategy)
      throw new Error('Expected a prepared walking strategy');
    const strategy = prepared.strategy;
    const candidate: GeneratedWorkoutPlanV2Candidate = {
      artifactType: 'WEEKLY_PLAN',
      modality: 'WALKING',
      objective: 'WEIGHT_LOSS',
      title: 'Sua semana de caminhada',
      sessions: strategy.sessionFocuses.map((label, index) => ({
        sessionKey: `s${index}`,
        sequence: index + 1,
        label,
        estimatedDurationMinutes: 30,
        blocks: (['WARM_UP', 'ENDURANCE', 'COOLDOWN'] as const).map(
          (type, blockIndex) => ({
            blockKey: `b${index}-${blockIndex}`,
            type,
            title:
              type === 'ENDURANCE' ? 'Caminhada principal' : 'Caminhada leve',
            estimatedDurationMinutes: blockIndex === 1 ? 20 : 5,
            activities: [
              {
                ...walk(`a${index}-${blockIndex}`),
                durationMinutes: blockIndex === 1 ? 20 : 5,
              },
            ],
          }),
        ),
      })),
      progression: [],
      substitutions: [],
      adaptationRules: [],
      safetyFlags: [],
    };
    ai.runTextJob.mockResolvedValue({
      outputText: JSON.stringify(candidate),
      responseId: 'response',
      model: 'provider-double',
      promptTokens: 20,
      completionTokens: 20,
      totalTokens: 40,
    });
    return { engine, input, candidate, ai, strategy, audit };
  }
  it('generates and formats five varied walking sessions for the real incident request', async () => {
    const s = await productionWalking();
    expect(s.strategy.modality).toBe('WALKING');
    expect(s.strategy.sessionCount).toBe(5);
    expect(new Set(s.strategy.sessionFocuses).size).toBe(5);
    const result = await s.engine.generateCandidate(s.input);
    expect(result.output.validation.status).not.toBe('INVALID');
    expect(
      result.output.sessions
        .flatMap((session) =>
          session.blocks.flatMap((block) => block.activities),
        )
        .every(
          (activity) =>
            activity.kind !== 'ENDURANCE' || activity.mode === 'WALK',
        ),
    ).toBe(true);
    expect(
      new WorkoutPlanV2Formatter().format(result.output).join('\n'),
    ).not.toMatch(/corrida|trote|run\/walk|jogging|sprint/iu);
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          resolvedWorkoutModality: 'WALKING',
          modalityResolutionSource: 'DETERMINISTIC',
          modalityViolationCode: null,
        }),
      }),
    );
  });
  it('fails the AIJob before completion/persistence when a provider contaminates walking with RUN', async () => {
    const s = await productionWalking();
    const candidate = {
      ...s.candidate,
      sessions: s.candidate.sessions.map((session, index) =>
        index !== 4
          ? session
          : {
              ...session,
              blocks: session.blocks.map((block) =>
                block.type !== 'ENDURANCE'
                  ? block
                  : {
                      ...block,
                      activities: [
                        { ...walk('misleading'), mode: 'RUN' as const },
                      ],
                    },
              ),
            },
      ),
    };
    s.ai.runTextJob.mockResolvedValue({
      outputText: JSON.stringify(candidate),
      responseId: 'response',
      model: 'provider-double',
      promptTokens: 20,
      completionTokens: 20,
      totalTokens: 40,
    });
    await expect(s.engine.generateCandidate(s.input)).rejects.toBeInstanceOf(
      WorkoutPostGenerationValidationError,
    );
    expect(s.ai.failJob).toHaveBeenCalledTimes(1);
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          modalityValidationOutcome: 'INVALID',
          modalityViolationCode: 'MODALITY_ACTIVITY_CONFLICT',
        }),
      }),
    );
  });
});
