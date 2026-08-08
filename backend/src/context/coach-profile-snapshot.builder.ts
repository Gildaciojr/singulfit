import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CoachProfileAcquisitionField,
  CoachProfileValueStatus,
  DietPlanStatus,
  MemoryType,
  Prisma,
  StageOfChange,
  WorkoutStatus,
} from '@prisma/client';
import {
  ACTIVATION_ONBOARDING_PROFILE_SOURCE_KEY,
  ACTIVATION_ONBOARDING_TARGET_SOURCE,
} from '../activation/activation-onboarding.constants';
import { PrismaService } from '../prisma/prisma.service';
import {
  COACH_PROFILE_COMPLETION_SECTION,
  COACH_PROFILE_COMPLETION_STATE,
  COACH_PROFILE_DATA_SOURCE,
  COACH_PROFILE_KNOWLEDGE_STATUS,
  CoachProfileCompletionStatus,
  CoachProfileConflict,
  CoachProfileConstraint,
  CoachProfileDataSource,
  CoachProfileDatum,
  CoachProfileField,
  CoachProfileFoodPreference,
  CoachProfileGoalProgression,
  CoachProfileNutritionEvolution,
  CoachProfileAdaptation,
  CoachProfileBehavioralStyle,
  CoachProfileCoachStyle,
  CoachProfileClassifiedGoal,
  CoachProfilePlanReference,
  CoachProfileCanonicalNutritionPlanReference,
  CoachProfileSectionCompletion,
  CoachProfileSnapshot,
} from './coach-profile-snapshot.contract';
import { CoachProfileAcquisitionProjectionService } from './profile-acquisition/coach-profile-acquisition-projection.service';
import { CurrentNutritionPlanReaderService } from '../diet/current-nutrition-plan-reader.service';
import type { CurrentNutritionPlan } from '../diet/current-nutrition-plan-reader.contract';

const COACH_PROFILE_SNAPSHOT_USER_SELECT = {
  id: true,
  name: true,
  onboardingCompleted: true,
  fitnessProfile: {
    select: {
      gender: true,
      birthDate: true,
      heightCm: true,
      currentWeightKg: true,
      targetWeightKg: true,
      activityLevel: true,
      goal: true,
      foodRestrictions: {
        select: { type: true, description: true },
        orderBy: { id: 'asc' as const },
      },
      injuryRestrictions: {
        select: { description: true },
        orderBy: { id: 'asc' as const },
      },
    },
  },
  nutritionProfile: {
    select: {
      sex: true,
      birthDate: true,
      heightCm: true,
      currentWeightKg: true,
      targetWeightKg: true,
      activityLevel: true,
      goal: true,
      restrictions: true,
      allergies: true,
      medicalConditions: true,
    },
  },
  preferences: {
    select: {
      preferredWakeUpTime: true,
      preferredSleepTime: true,
      preferredTrainingTime: true,
      preferredMealTimes: true,
      preferredLanguage: true,
      timezone: true,
    },
  },
  coachProfile: {
    select: {
      communicationStyle: true,
      coachingStyle: true,
      tone: true,
      motivationStyle: true,
    },
  },
  goalClassification: {
    select: { goal: true, confidence: true },
  },
  behavioralProfile: {
    select: {
      communicationStyle: true,
      motivationStyle: true,
      adherenceStyle: true,
      personalityPattern: true,
      preferredEngagementHour: true,
    },
  },
  behavioralSnapshots: {
    select: { stage: true },
    orderBy: [{ generatedAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
  },
  fitnessCheckIns: {
    select: { adherenceScore: true },
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
  },
  progressSnapshots: {
    select: { weightKg: true },
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
  },
  longitudinalProfiles: {
    select: { adherenceScore: true },
    orderBy: [{ generatedAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
  },
  foodPreferenceSnapshots: {
    select: {
      foodName: true,
      kind: true,
      confidence: true,
      occurrences: true,
    },
    orderBy: [
      { observedAt: 'desc' as const },
      { normalizedFood: 'asc' as const },
      { id: 'asc' as const },
    ],
    take: 20,
  },
  nutritionEvolution: {
    select: {
      overallDirection: true,
      mealsAnalyzed: true,
      qualityScore: true,
    },
    orderBy: [{ generatedAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
  },
  goalProgression: {
    select: { goal: true, state: true, score: true },
    orderBy: [{ generatedAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
  },
  coachAdaptations: {
    select: { mode: true, reason: true },
    orderBy: [{ generatedAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
  },
  dietPlans: {
    where: { status: DietPlanStatus.ACTIVE },
    select: {
      id: true,
      title: true,
      objective: true,
      status: true,
      generatedAt: true,
    },
    orderBy: [{ generatedAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
  },
  workoutPlans: {
    where: { status: WorkoutStatus.ACTIVE },
    select: {
      id: true,
      title: true,
      objective: true,
      status: true,
      generatedAt: true,
    },
    orderBy: [{ generatedAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
  },
  conversationMemories: {
    select: { summary: true },
    orderBy: [
      { relevanceScore: 'desc' as const },
      { generatedAt: 'desc' as const },
      { id: 'desc' as const },
    ],
    take: 5,
  },
  coachProfileFieldValues: {
    where: {
      OR: [{ isActive: true }, { status: CoachProfileValueStatus.CONFLICTED }],
    },
    orderBy: [{ referenceDate: 'desc' as const }, { id: 'desc' as const }],
  },
} satisfies Prisma.UserSelect;

type CoachProfileSnapshotUser = Prisma.UserGetPayload<{
  select: typeof COACH_PROFILE_SNAPSHOT_USER_SELECT;
}>;

interface CompletionCandidate {
  readonly field: CoachProfileField;
  readonly status: CoachProfileDatum<unknown>['status'];
}

@Injectable()
export class CoachProfileSnapshotBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly acquisitionProjection: CoachProfileAcquisitionProjectionService,
    private readonly currentNutritionPlanReader: CurrentNutritionPlanReaderService,
  ) {}

  async build(
    userId: string,
    referenceDate: Date,
  ): Promise<CoachProfileSnapshot> {
    if (Number.isNaN(referenceDate.getTime())) {
      throw new Error('Data de referência do CoachProfileSnapshot inválida');
    }

    const [user, activationMemory, currentNutritionPlan] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: COACH_PROFILE_SNAPSHOT_USER_SELECT,
      }),
      this.prisma.conversationMemory.findUnique({
        where: {
          userId_memoryType_sourceKey: {
            userId,
            memoryType: MemoryType.LONG_TERM,
            sourceKey: ACTIVATION_ONBOARDING_PROFILE_SOURCE_KEY,
          },
        },
        select: { content: true },
      }),
      this.currentNutritionPlanReader.getCurrent(userId),
    ]);

    if (!user) {
      throw new NotFoundException(
        'Usuário do CoachProfileSnapshot não encontrado',
      );
    }

    return this.assemble(
      user,
      activationMemory?.content,
      referenceDate,
      currentNutritionPlan,
    );
  }

  private assemble(
    user: CoachProfileSnapshotUser,
    activationContent: Prisma.JsonValue | undefined,
    referenceDate: Date,
    currentNutritionPlan: CurrentNutritionPlan | null,
  ): CoachProfileSnapshot {
    const conflicts: CoachProfileConflict[] = [];
    const fitness = user.fitnessProfile;
    const nutrition = user.nutritionProfile;
    const activation = this.record(activationContent);
    const acquired = this.acquisitionProjection.project(
      user.coachProfileFieldValues,
    );

    const sex = this.resolveDuplicate(
      fitness?.gender,
      nutrition?.sex,
      'SEX',
      conflicts,
    );
    const birthDate = this.resolveDuplicate(
      fitness?.birthDate.toISOString().slice(0, 10),
      nutrition?.birthDate.toISOString().slice(0, 10),
      'BIRTH_DATE',
      conflicts,
    );
    const heightCm = this.resolveDuplicate(
      fitness?.heightCm,
      nutrition?.heightCm,
      'HEIGHT',
      conflicts,
    );
    const currentWeightKg = this.resolveDuplicate(
      fitness?.currentWeightKg.toNumber(),
      nutrition?.currentWeightKg.toNumber(),
      'CURRENT_WEIGHT',
      conflicts,
    );
    const resolvedTargetWeightKg = this.resolveDuplicate(
      fitness?.targetWeightKg.toNumber(),
      nutrition?.targetWeightKg.toNumber(),
      'TARGET_WEIGHT',
      conflicts,
    );
    const targetWeightKg = this.targetWeightDatum(
      resolvedTargetWeightKg,
      activation?.targetWeightSource,
    );
    const activityLevel = this.resolveDuplicate(
      fitness?.activityLevel,
      nutrition?.activityLevel,
      'ACTIVITY_LEVEL',
      conflicts,
    );
    const primaryGoal = this.resolveDuplicate(
      fitness?.goal,
      nutrition?.goal,
      'PRIMARY_GOAL',
      conflicts,
    );
    const ageYears = this.ageDatum(birthDate, referenceDate);
    const activationRestrictionsKnown = Array.isArray(activation?.restrictions);
    const profileFoodRestrictions = this.constraintsDatum(
      this.mergeConstraints([
        ...(fitness?.foodRestrictions.map((restriction) =>
          this.constraint(
            restriction.description,
            COACH_PROFILE_DATA_SOURCE.FITNESS_PROFILE,
            restriction.type,
          ),
        ) ?? []),
        ...this.jsonConstraints(
          nutrition?.restrictions,
          COACH_PROFILE_DATA_SOURCE.NUTRITION_PROFILE,
        ),
      ]),
      activationRestrictionsKnown,
      [
        ...(fitness ? [COACH_PROFILE_DATA_SOURCE.FITNESS_PROFILE] : []),
        ...(nutrition ? [COACH_PROFILE_DATA_SOURCE.NUTRITION_PROFILE] : []),
        ...(activationRestrictionsKnown
          ? [COACH_PROFILE_DATA_SOURCE.ACTIVATION_ONBOARDING]
          : []),
      ],
    );
    const acquiredIntolerances = this.acquiredConstraints(
      this.acquisitionProjection.textList(
        acquired,
        CoachProfileAcquisitionField.FOOD_INTOLERANCES,
      ),
      'INTOLERANCE',
    );
    const foodRestrictions = this.mergeConstraintData(
      profileFoodRestrictions,
      acquiredIntolerances,
    );
    const profileAllergies = this.constraintsDatum(
      this.jsonConstraints(
        nutrition?.allergies,
        COACH_PROFILE_DATA_SOURCE.NUTRITION_PROFILE,
      ),
      false,
      nutrition ? [COACH_PROFILE_DATA_SOURCE.NUTRITION_PROFILE] : [],
    );
    const acquiredAllergies = this.acquiredConstraints(
      this.acquisitionProjection.textList(
        acquired,
        CoachProfileAcquisitionField.ALLERGIES,
      ),
      'ALLERGY',
    );
    const allergies = this.mergeAllergyData(
      profileAllergies,
      acquiredAllergies,
    );
    const medicalConditions = this.constraintsDatum(
      this.jsonConstraints(
        nutrition?.medicalConditions,
        COACH_PROFILE_DATA_SOURCE.NUTRITION_PROFILE,
      ),
      false,
      nutrition ? [COACH_PROFILE_DATA_SOURCE.NUTRITION_PROFILE] : [],
    );
    const physicalLimitations = this.constraintsDatum(
      this.mergeConstraints(
        fitness?.injuryRestrictions.map((restriction) =>
          this.constraint(
            restriction.description,
            COACH_PROFILE_DATA_SOURCE.FITNESS_PROFILE,
          ),
        ) ?? [],
      ),
      false,
      fitness ? [COACH_PROFILE_DATA_SOURCE.FITNESS_PROFILE] : [],
    );
    const mealTimes = this.stringArray(user.preferences?.preferredMealTimes);
    const mealTimesDatum =
      mealTimes.length > 0
        ? this.known(
            Object.freeze(mealTimes),
            COACH_PROFILE_DATA_SOURCE.USER_PREFERENCES,
          )
        : this.unknown<readonly string[]>();
    const inferredMealCount =
      mealTimes.length > 0
        ? this.inferred(
            mealTimes.length,
            COACH_PROFILE_DATA_SOURCE.USER_PREFERENCES,
          )
        : this.unknown<number>();
    const acquiredMealCount = this.acquisitionProjection.integer(
      acquired,
      CoachProfileAcquisitionField.DESIRED_MEAL_COUNT,
    );
    const desiredMealCount =
      acquiredMealCount.status === COACH_PROFILE_KNOWLEDGE_STATUS.UNKNOWN
        ? inferredMealCount
        : acquiredMealCount;
    const eatingOutFrequency = this.acquisitionProjection.text(
      acquired,
      CoachProfileAcquisitionField.EATING_OUT_FREQUENCY,
    );
    const foodPreferences = this.foodPreferences(user);
    const displayName = user.name?.trim();
    const identity = Object.freeze({
      userId: this.known(user.id, COACH_PROFILE_DATA_SOURCE.USER),
      displayName: displayName
        ? this.known(displayName, COACH_PROFILE_DATA_SOURCE.USER)
        : this.unknown<string>(),
      onboardingCompleted: this.known(
        user.onboardingCompleted,
        COACH_PROFILE_DATA_SOURCE.USER,
      ),
    });
    const physical = Object.freeze({
      sex,
      birthDate,
      ageYears,
      heightCm,
      currentWeightKg,
      targetWeightKg,
      activityLevel,
    });
    const nutritionProfile = Object.freeze({
      primaryGoal,
      desiredOutcome: this.optionalActivationString(
        activation?.desiredResultText,
      ),
      desiredMealCount,
      dietaryPattern: this.acquisitionProjection.text(
        acquired,
        CoachProfileAcquisitionField.EATING_PATTERN,
      ),
      foodIntolerances: acquiredIntolerances,
      declaredFoodPreferences: this.acquisitionProjection.textList(
        acquired,
        CoachProfileAcquisitionField.DECLARED_FOOD_PREFERENCES,
      ),
      declaredFoodRejections: this.acquisitionProjection.textList(
        acquired,
        CoachProfileAcquisitionField.DECLARED_FOOD_REJECTIONS,
      ),
      cookingAvailability: this.acquisitionProjection.text(
        acquired,
        CoachProfileAcquisitionField.COOKING_AVAILABILITY,
      ),
      mealsAwayFromHome: this.eatingOutBoolean(eatingOutFrequency),
      eatingOutFrequency,
      foodBudget: this.acquisitionProjection.text(
        acquired,
        CoachProfileAcquisitionField.FOOD_BUDGET_LEVEL,
      ),
      supplementation: this.acquisitionProjection.textList(
        acquired,
        CoachProfileAcquisitionField.REPORTED_SUPPLEMENTATION,
      ),
      hydration: this.acquisitionProjection.text(
        acquired,
        CoachProfileAcquisitionField.REPORTED_HYDRATION,
      ),
    });
    const training = Object.freeze({
      primaryGoal,
      experienceLevel: this.acquisitionProjection.text(
        acquired,
        CoachProfileAcquisitionField.TRAINING_EXPERIENCE,
      ),
      preferredModality: this.acquisitionProjection.text(
        acquired,
        CoachProfileAcquisitionField.TRAINING_MODALITY,
      ),
      weeklyFrequency: this.acquisitionProjection.integer(
        acquired,
        CoachProfileAcquisitionField.WEEKLY_FREQUENCY,
      ),
      sessionDurationMinutes: this.acquisitionProjection.integer(
        acquired,
        CoachProfileAcquisitionField.SESSION_DURATION_MINUTES,
      ),
      environment: this.acquisitionProjection.text(
        acquired,
        CoachProfileAcquisitionField.TRAINING_ENVIRONMENT,
      ),
      availableEquipment: this.acquisitionProjection.textList(
        acquired,
        CoachProfileAcquisitionField.AVAILABLE_EQUIPMENT,
      ),
      perceivedConditioning: this.acquisitionProjection.text(
        acquired,
        CoachProfileAcquisitionField.PERCEIVED_CONDITIONING,
      ),
      intensityPreference: this.acquisitionProjection.text(
        acquired,
        CoachProfileAcquisitionField.PREFERRED_INTENSITY,
      ),
      cardioAvailability: this.acquisitionProjection.boolean(
        acquired,
        CoachProfileAcquisitionField.CARDIO_AVAILABILITY,
      ),
      trainingFormatPreference: this.acquisitionProjection.text(
        acquired,
        CoachProfileAcquisitionField.TRAINING_FORMAT_PREFERENCE,
      ),
      returningAfterBreak: this.acquisitionProjection.boolean(
        acquired,
        CoachProfileAcquisitionField.RETURNING_AFTER_BREAK,
      ),
    });
    const routine = Object.freeze({
      wakeUpTime: this.optionalPreference(
        user.preferences?.preferredWakeUpTime,
      ),
      sleepTime: this.optionalPreference(user.preferences?.preferredSleepTime),
      trainingTime: this.optionalPreference(
        user.preferences?.preferredTrainingTime,
      ),
      mealTimes: mealTimesDatum,
      availableTrainingDays: this.acquisitionProjection.textList(
        acquired,
        CoachProfileAcquisitionField.AVAILABLE_TRAINING_DAYS,
      ),
      dailyTrainingWindows: this.acquisitionProjection.textList(
        acquired,
        CoachProfileAcquisitionField.DAILY_TRAINING_WINDOWS,
      ),
    });
    const restrictions = Object.freeze({
      foodRestrictions,
      allergies,
      medicalConditions,
      physicalLimitations,
    });
    const preferences = Object.freeze({ foodPreferences });
    const longitudinal = this.longitudinal(user);
    const plans = this.plans(user, currentNutritionPlan);
    const conversation = this.conversation(user);
    const completion = this.completion({
      identity,
      physical,
      nutrition: nutritionProfile,
      training,
      routine,
      restrictions,
      preferences,
    });

    return Object.freeze({
      identity,
      physical,
      nutrition: nutritionProfile,
      training,
      routine,
      restrictions,
      preferences,
      longitudinal,
      plans,
      conversation,
      completion,
      conflicts: Object.freeze(
        conflicts.map((conflict) => Object.freeze(conflict)),
      ),
      referenceDate: referenceDate.toISOString(),
    });
  }

  private longitudinal(
    user: CoachProfileSnapshotUser,
  ): CoachProfileSnapshot['longitudinal'] {
    const checkIn = user.fitnessCheckIns[0];
    const longitudinalProfile = user.longitudinalProfiles[0];
    const progress = user.progressSnapshots[0];
    const goalProgression = user.goalProgression[0];
    const evolution = user.nutritionEvolution[0];
    const adaptation = user.coachAdaptations[0];

    return Object.freeze({
      adherenceScore: checkIn
        ? this.known(
            checkIn.adherenceScore,
            COACH_PROFILE_DATA_SOURCE.FITNESS_CHECK_IN,
          )
        : longitudinalProfile
          ? this.inferred(
              longitudinalProfile.adherenceScore,
              COACH_PROFILE_DATA_SOURCE.LONGITUDINAL,
            )
          : this.unknown<number>(),
      latestProgressWeightKg: progress
        ? this.known(
            progress.weightKg.toNumber(),
            COACH_PROFILE_DATA_SOURCE.PROGRESS_SNAPSHOT,
          )
        : this.unknown<number>(),
      goalProgression: goalProgression
        ? this.inferred(
            Object.freeze({
              goal: goalProgression.goal,
              state: goalProgression.state,
              score: goalProgression.score,
            }),
            COACH_PROFILE_DATA_SOURCE.LONGITUDINAL,
          )
        : this.unknown<CoachProfileGoalProgression>(),
      nutritionEvolution: evolution
        ? this.inferred(
            Object.freeze({
              direction: evolution.overallDirection,
              mealsAnalyzed: evolution.mealsAnalyzed,
              qualityScore: evolution.qualityScore,
            }),
            COACH_PROFILE_DATA_SOURCE.LONGITUDINAL,
          )
        : this.unknown<CoachProfileNutritionEvolution>(),
      coachAdaptation: adaptation
        ? this.inferred(
            Object.freeze({
              mode: adaptation.mode,
              reason: adaptation.reason,
            }),
            COACH_PROFILE_DATA_SOURCE.LONGITUDINAL,
          )
        : this.unknown<CoachProfileAdaptation>(),
    });
  }

  private plans(
    user: CoachProfileSnapshotUser,
    currentNutritionPlan: CurrentNutritionPlan | null,
  ): CoachProfileSnapshot['plans'] {
    const diet = user.dietPlans[0];
    const workout = user.workoutPlans[0];
    const canonical: CoachProfileCanonicalNutritionPlanReference | null =
      currentNutritionPlan?.implementation === 'LEGACY'
        ? Object.freeze({
            implementation: 'LEGACY' as const,
            id: currentNutritionPlan.id,
            title: currentNutritionPlan.title,
            objective: currentNutritionPlan.objective,
            status: currentNutritionPlan.status,
            generatedAt: currentNutritionPlan.generatedAt,
          })
        : currentNutritionPlan?.implementation === 'V2'
          ? Object.freeze({
              implementation: 'V2' as const,
              id: currentNutritionPlan.id,
              title: currentNutritionPlan.title,
              objective: currentNutritionPlan.objectiveSummary,
              status: currentNutritionPlan.status,
              artifactType: currentNutritionPlan.artifactType,
              generatedAt: currentNutritionPlan.generatedAt,
            })
          : null;

    return Object.freeze({
      currentDiet: diet
        ? this.known(
            this.planReference(diet),
            COACH_PROFILE_DATA_SOURCE.DIET_PLAN,
          )
        : this.unknown<CoachProfilePlanReference<DietPlanStatus>>(),
      currentWorkout: workout
        ? this.known(
            this.planReference(workout),
            COACH_PROFILE_DATA_SOURCE.WORKOUT_PLAN,
          )
        : this.unknown<CoachProfilePlanReference<WorkoutStatus>>(),
      currentNutritionPlan: canonical
        ? this.known(canonical, COACH_PROFILE_DATA_SOURCE.NUTRITION_PLAN)
        : this.unknown<CoachProfileCanonicalNutritionPlanReference>(),
    });
  }

  private conversation(
    user: CoachProfileSnapshotUser,
  ): CoachProfileSnapshot['conversation'] {
    const coach = user.coachProfile;
    const behavior = user.behavioralProfile;
    const stage = user.behavioralSnapshots[0];
    const memorySummaries = user.conversationMemories
      .map((memory) => memory.summary.trim())
      .filter((summary) => summary.length > 0);

    return Object.freeze({
      preferredLanguage: user.preferences
        ? this.inferred(
            user.preferences.preferredLanguage,
            COACH_PROFILE_DATA_SOURCE.USER_PREFERENCES,
          )
        : this.unknown<string>(),
      timezone: user.preferences
        ? this.inferred(
            user.preferences.timezone,
            COACH_PROFILE_DATA_SOURCE.USER_PREFERENCES,
          )
        : this.unknown<string>(),
      coachStyle: coach
        ? this.inferred(
            Object.freeze({
              communicationStyle: coach.communicationStyle,
              coachingStyle: coach.coachingStyle,
              tone: coach.tone,
              motivationStyle: coach.motivationStyle,
            }),
            COACH_PROFILE_DATA_SOURCE.COACH_PROFILE,
          )
        : this.unknown<CoachProfileCoachStyle>(),
      behavioralStyle: behavior
        ? this.inferred(
            Object.freeze({
              communicationStyle: behavior.communicationStyle,
              motivationStyle: behavior.motivationStyle,
              adherenceStyle: behavior.adherenceStyle,
              personalityPattern: behavior.personalityPattern,
              preferredEngagementHour: behavior.preferredEngagementHour,
            }),
            COACH_PROFILE_DATA_SOURCE.BEHAVIORAL_PROFILE,
          )
        : this.unknown<CoachProfileBehavioralStyle>(),
      behavioralStage: stage
        ? this.inferred(
            stage.stage,
            COACH_PROFILE_DATA_SOURCE.BEHAVIORAL_PROFILE,
          )
        : this.unknown<StageOfChange>(),
      classifiedGoal: user.goalClassification
        ? this.inferred(
            Object.freeze({
              goal: user.goalClassification.goal,
              confidence: user.goalClassification.confidence.toNumber(),
            }),
            COACH_PROFILE_DATA_SOURCE.COACH_PROFILE,
          )
        : this.unknown<CoachProfileClassifiedGoal>(),
      memorySummaries:
        memorySummaries.length > 0
          ? this.inferred(
              Object.freeze(memorySummaries),
              COACH_PROFILE_DATA_SOURCE.CONVERSATION_MEMORY,
            )
          : this.unknown<readonly string[]>(),
    });
  }

  private completion(input: {
    identity: CoachProfileSnapshot['identity'];
    physical: CoachProfileSnapshot['physical'];
    nutrition: CoachProfileSnapshot['nutrition'];
    training: CoachProfileSnapshot['training'];
    routine: CoachProfileSnapshot['routine'];
    restrictions: CoachProfileSnapshot['restrictions'];
    preferences: CoachProfileSnapshot['preferences'];
  }): CoachProfileCompletionStatus {
    const sections = Object.freeze([
      this.section(COACH_PROFILE_COMPLETION_SECTION.GENERAL, [
        this.candidate('DISPLAY_NAME', input.identity.displayName),
        this.candidate('SEX', input.physical.sex),
        this.candidate('BIRTH_DATE', input.physical.birthDate),
        this.candidate('AGE', input.physical.ageYears),
        this.candidate('HEIGHT', input.physical.heightCm),
        this.candidate('CURRENT_WEIGHT', input.physical.currentWeightKg),
        this.candidate('PRIMARY_GOAL', input.nutrition.primaryGoal),
        this.candidate('ACTIVITY_LEVEL', input.physical.activityLevel),
      ]),
      this.section(COACH_PROFILE_COMPLETION_SECTION.NUTRITION, [
        this.candidate('PRIMARY_GOAL', input.nutrition.primaryGoal),
        this.candidate(
          'FOOD_RESTRICTIONS',
          input.restrictions.foodRestrictions,
        ),
        this.candidate('ALLERGIES', input.restrictions.allergies),
        this.candidate('FOOD_PREFERENCES', input.preferences.foodPreferences),
        this.candidate('MEAL_TIMES', input.routine.mealTimes),
        this.candidate('MEAL_COUNT', input.nutrition.desiredMealCount),
      ]),
      this.section(COACH_PROFILE_COMPLETION_SECTION.TRAINING, [
        this.candidate('PRIMARY_GOAL', input.training.primaryGoal),
        this.candidate('TRAINING_EXPERIENCE', input.training.experienceLevel),
        this.candidate('TRAINING_MODALITY', input.training.preferredModality),
        this.candidate('TRAINING_FREQUENCY', input.training.weeklyFrequency),
        this.candidate(
          'SESSION_DURATION',
          input.training.sessionDurationMinutes,
        ),
        this.candidate('TRAINING_ENVIRONMENT', input.training.environment),
        this.candidate('TRAINING_EQUIPMENT', input.training.availableEquipment),
        this.candidate(
          'PHYSICAL_LIMITATIONS',
          input.restrictions.physicalLimitations,
        ),
      ]),
      this.section(COACH_PROFILE_COMPLETION_SECTION.ROUTINE, [
        this.candidate('WAKE_UP_TIME', input.routine.wakeUpTime),
        this.candidate('SLEEP_TIME', input.routine.sleepTime),
        this.candidate('TRAINING_TIME', input.routine.trainingTime),
        this.candidate('MEAL_TIMES', input.routine.mealTimes),
      ]),
      this.section(COACH_PROFILE_COMPLETION_SECTION.SAFETY, [
        this.candidate(
          'FOOD_RESTRICTIONS',
          input.restrictions.foodRestrictions,
        ),
        this.candidate('ALLERGIES', input.restrictions.allergies),
        this.candidate(
          'MEDICAL_CONDITIONS',
          input.restrictions.medicalConditions,
        ),
        this.candidate(
          'PHYSICAL_LIMITATIONS',
          input.restrictions.physicalLimitations,
        ),
      ]),
    ]);
    const readySections = sections.filter((section) => section.ready).length;
    const overall =
      readySections === sections.length
        ? COACH_PROFILE_COMPLETION_STATE.COMPLETE
        : readySections === 0
          ? COACH_PROFILE_COMPLETION_STATE.INSUFFICIENT
          : COACH_PROFILE_COMPLETION_STATE.PARTIAL;

    return Object.freeze({ overall, sections });
  }

  private section(
    section: CoachProfileSectionCompletion['section'],
    candidates: readonly CompletionCandidate[],
  ): CoachProfileSectionCompletion {
    const availableFields = candidates
      .filter(
        (candidate) =>
          candidate.status === COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN ||
          candidate.status === COACH_PROFILE_KNOWLEDGE_STATUS.INFERRED ||
          candidate.status === COACH_PROFILE_KNOWLEDGE_STATUS.NOT_APPLICABLE,
      )
      .map((candidate) => candidate.field);
    const confirmationRequiredFields = candidates
      .filter(
        (candidate) =>
          candidate.status ===
          COACH_PROFILE_KNOWLEDGE_STATUS.REQUIRES_CONFIRMATION,
      )
      .map((candidate) => candidate.field);
    const missingFields = candidates
      .filter(
        (candidate) =>
          candidate.status === COACH_PROFILE_KNOWLEDGE_STATUS.UNKNOWN,
      )
      .map((candidate) => candidate.field);
    const ready =
      missingFields.length === 0 && confirmationRequiredFields.length === 0;
    const state = ready
      ? COACH_PROFILE_COMPLETION_STATE.COMPLETE
      : availableFields.length === 0
        ? COACH_PROFILE_COMPLETION_STATE.INSUFFICIENT
        : COACH_PROFILE_COMPLETION_STATE.PARTIAL;

    return Object.freeze({
      section,
      state,
      ready,
      requiredFields: Object.freeze(
        candidates.map((candidate) => candidate.field),
      ),
      availableFields: Object.freeze(availableFields),
      missingFields: Object.freeze(missingFields),
      confirmationRequiredFields: Object.freeze(confirmationRequiredFields),
    });
  }

  private candidate(
    field: CoachProfileField,
    datum: CoachProfileDatum<unknown>,
  ): CompletionCandidate {
    return Object.freeze({ field, status: datum.status });
  }

  private foodPreferences(
    user: CoachProfileSnapshotUser,
  ): CoachProfileDatum<readonly CoachProfileFoodPreference[]> {
    if (user.foodPreferenceSnapshots.length === 0) {
      return this.unknown();
    }

    const preferences = user.foodPreferenceSnapshots.map((preference) =>
      Object.freeze({
        foodName: preference.foodName,
        kind: preference.kind,
        confidence: preference.confidence.toNumber(),
        occurrences: preference.occurrences,
      }),
    );

    return this.inferred(
      Object.freeze(preferences),
      COACH_PROFILE_DATA_SOURCE.FOOD_PREFERENCE,
    );
  }

  private resolveDuplicate<T>(
    preferredValue: T | undefined,
    secondaryValue: T | undefined,
    field: CoachProfileField,
    conflicts: CoachProfileConflict[],
  ): CoachProfileDatum<T> {
    if (preferredValue !== undefined && secondaryValue !== undefined) {
      const sources = [
        COACH_PROFILE_DATA_SOURCE.FITNESS_PROFILE,
        COACH_PROFILE_DATA_SOURCE.NUTRITION_PROFILE,
      ] as const;

      if (preferredValue === secondaryValue) {
        return this.knownFromSources(preferredValue, sources);
      }

      conflicts.push(
        Object.freeze({
          field,
          preferredSource: COACH_PROFILE_DATA_SOURCE.FITNESS_PROFILE,
          conflictingSource: COACH_PROFILE_DATA_SOURCE.NUTRITION_PROFILE,
          preferredValue: String(preferredValue),
          conflictingValue: String(secondaryValue),
        }),
      );
      return this.confirmation(preferredValue, sources);
    }

    if (preferredValue !== undefined) {
      return this.known(
        preferredValue,
        COACH_PROFILE_DATA_SOURCE.FITNESS_PROFILE,
      );
    }

    if (secondaryValue !== undefined) {
      return this.known(
        secondaryValue,
        COACH_PROFILE_DATA_SOURCE.NUTRITION_PROFILE,
      );
    }

    return this.unknown();
  }

  private ageDatum(
    birthDate: CoachProfileDatum<string>,
    referenceDate: Date,
  ): CoachProfileDatum<number> {
    if (!('value' in birthDate)) {
      return this.unknown();
    }

    const parsed = new Date(`${birthDate.value}T00:00:00.000Z`);
    let age = referenceDate.getUTCFullYear() - parsed.getUTCFullYear();
    const birthdayPassed =
      referenceDate.getUTCMonth() > parsed.getUTCMonth() ||
      (referenceDate.getUTCMonth() === parsed.getUTCMonth() &&
        referenceDate.getUTCDate() >= parsed.getUTCDate());
    if (!birthdayPassed) age -= 1;

    return birthDate.status ===
      COACH_PROFILE_KNOWLEDGE_STATUS.REQUIRES_CONFIRMATION
      ? this.confirmation(age, birthDate.sources)
      : this.inferredFromSources(age, birthDate.sources);
  }

  private targetWeightDatum(
    datum: CoachProfileDatum<number>,
    targetWeightSource: Prisma.JsonValue | undefined,
  ): CoachProfileDatum<number> {
    if (
      targetWeightSource !==
        ACTIVATION_ONBOARDING_TARGET_SOURCE.ESTIMATED_FROM_GOAL ||
      !('value' in datum) ||
      datum.status === COACH_PROFILE_KNOWLEDGE_STATUS.REQUIRES_CONFIRMATION
    ) {
      return datum;
    }

    return this.inferredFromSources(datum.value, [
      ...datum.sources,
      COACH_PROFILE_DATA_SOURCE.ACTIVATION_ONBOARDING,
    ]);
  }

  private constraintsDatum(
    constraints: readonly CoachProfileConstraint[],
    emptyConfirmed: boolean,
    sources: readonly CoachProfileDataSource[],
  ): CoachProfileDatum<readonly CoachProfileConstraint[]> {
    const frozen = Object.freeze(constraints);
    if (frozen.length > 0 || emptyConfirmed) {
      return this.knownFromSources(frozen, sources);
    }
    if (sources.length > 0) {
      return this.confirmation(frozen, sources);
    }
    return this.unknown();
  }

  private acquiredConstraints(
    datum: CoachProfileDatum<readonly string[]>,
    type: string,
  ): CoachProfileDatum<readonly CoachProfileConstraint[]> {
    if (!('value' in datum)) {
      return Object.freeze({
        status: datum.status,
        sources: datum.sources,
      });
    }
    const value = Object.freeze(
      datum.value.map((description) =>
        this.constraint(
          description,
          COACH_PROFILE_DATA_SOURCE.PROFILE_ACQUISITION,
          type,
        ),
      ),
    );
    return Object.freeze({
      status: datum.status,
      value,
      sources: datum.sources,
    });
  }

  private mergeConstraintData(
    left: CoachProfileDatum<readonly CoachProfileConstraint[]>,
    right: CoachProfileDatum<readonly CoachProfileConstraint[]>,
  ): CoachProfileDatum<readonly CoachProfileConstraint[]> {
    if (!('value' in left)) return right;
    if (!('value' in right)) return left;
    const sources = Object.freeze([
      ...new Set([...left.sources, ...right.sources]),
    ]);
    const value = this.mergeConstraints([...left.value, ...right.value]);
    if (
      left.status === COACH_PROFILE_KNOWLEDGE_STATUS.REQUIRES_CONFIRMATION ||
      right.status === COACH_PROFILE_KNOWLEDGE_STATUS.REQUIRES_CONFIRMATION
    ) {
      return this.confirmation(value, sources);
    }
    if (
      left.status === COACH_PROFILE_KNOWLEDGE_STATUS.INFERRED ||
      right.status === COACH_PROFILE_KNOWLEDGE_STATUS.INFERRED
    ) {
      return this.inferredFromSources(value, sources);
    }
    return this.knownFromSources(value, sources);
  }

  private mergeAllergyData(
    profile: CoachProfileDatum<readonly CoachProfileConstraint[]>,
    acquired: CoachProfileDatum<readonly CoachProfileConstraint[]>,
  ): CoachProfileDatum<readonly CoachProfileConstraint[]> {
    if (
      !('value' in acquired) ||
      acquired.status !== COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN
    ) {
      return this.mergeConstraintData(profile, acquired);
    }
    if (!('value' in profile)) return acquired;

    const profileValue = this.mergeConstraints(profile.value);
    const acquiredValue = this.mergeConstraints(acquired.value);
    const value = this.mergeConstraints([...profileValue, ...acquiredValue]);
    const sources = Object.freeze([
      ...new Set([...profile.sources, ...acquired.sources]),
    ]);

    if (profileValue.length === 0) {
      return this.knownFromSources(value, sources);
    }
    const sameConfirmedAllergies =
      profileValue.length === acquiredValue.length &&
      value.length === profileValue.length;
    return sameConfirmedAllergies
      ? this.knownFromSources(value, sources)
      : this.confirmation(value, sources);
  }

  private eatingOutBoolean(
    frequency: CoachProfileDatum<string>,
  ): CoachProfileDatum<boolean> {
    if (!('value' in frequency)) {
      return Object.freeze({
        status: frequency.status,
        sources: frequency.sources,
      });
    }
    return Object.freeze({
      status: frequency.status,
      value:
        frequency.value === 'FREQUENTLY' || frequency.value === 'MOST_MEALS',
      sources: frequency.sources,
    });
  }

  private jsonConstraints(
    value: Prisma.JsonValue | undefined,
    source: CoachProfileDataSource,
  ): readonly CoachProfileConstraint[] {
    if (!Array.isArray(value)) return Object.freeze([]);

    const constraints: CoachProfileConstraint[] = [];
    for (const item of value) {
      if (typeof item === 'string' && item.trim()) {
        constraints.push(this.constraint(item, source));
        continue;
      }
      const record = this.record(item);
      const description = this.optionalString(
        record?.description ?? record?.name ?? record?.value,
      );
      if (description) {
        constraints.push(
          this.constraint(
            description,
            source,
            this.optionalString(record?.type),
          ),
        );
      }
    }
    return Object.freeze(constraints);
  }

  private mergeConstraints(
    constraints: readonly CoachProfileConstraint[],
  ): readonly CoachProfileConstraint[] {
    const seen = new Set<string>();
    const merged: CoachProfileConstraint[] = [];
    for (const constraint of constraints) {
      const key = `${constraint.type ?? ''}:${constraint.description}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(constraint);
    }
    return Object.freeze(merged);
  }

  private constraint(
    description: string,
    source: CoachProfileDataSource,
    type?: string,
  ): CoachProfileConstraint {
    return Object.freeze({
      ...(type?.trim() ? { type: type.trim() } : {}),
      description: description.trim(),
      source,
    });
  }

  private planReference<TStatus extends DietPlanStatus | WorkoutStatus>(plan: {
    id: string;
    title: string;
    objective: CoachProfilePlanReference<TStatus>['objective'];
    status: TStatus;
    generatedAt: Date;
  }): CoachProfilePlanReference<TStatus> {
    return Object.freeze({
      id: plan.id,
      title: plan.title,
      objective: plan.objective,
      status: plan.status,
      generatedAt: plan.generatedAt.toISOString(),
    });
  }

  private optionalActivationString(value: unknown): CoachProfileDatum<string> {
    const text = this.optionalString(value);
    return text
      ? this.known(text, COACH_PROFILE_DATA_SOURCE.ACTIVATION_ONBOARDING)
      : this.unknown();
  }

  private optionalPreference(
    value: string | null | undefined,
  ): CoachProfileDatum<string> {
    return value?.trim()
      ? this.known(value.trim(), COACH_PROFILE_DATA_SOURCE.USER_PREFERENCES)
      : this.unknown();
  }

  private stringArray(value: Prisma.JsonValue | undefined): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  private known<T>(
    value: T,
    source: CoachProfileDataSource,
  ): CoachProfileDatum<T> {
    return this.knownFromSources(value, [source]);
  }

  private knownFromSources<T>(
    value: T,
    sources: readonly CoachProfileDataSource[],
  ): CoachProfileDatum<T> {
    return Object.freeze({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN,
      value,
      sources: Object.freeze([...new Set(sources)]),
    });
  }

  private inferred<T>(
    value: T,
    source: CoachProfileDataSource,
  ): CoachProfileDatum<T> {
    return this.inferredFromSources(value, [source]);
  }

  private inferredFromSources<T>(
    value: T,
    sources: readonly CoachProfileDataSource[],
  ): CoachProfileDatum<T> {
    return Object.freeze({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.INFERRED,
      value,
      sources: Object.freeze([...new Set(sources)]),
    });
  }

  private confirmation<T>(
    value: T,
    sources: readonly CoachProfileDataSource[],
  ): CoachProfileDatum<T> {
    return Object.freeze({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.REQUIRES_CONFIRMATION,
      value,
      sources: Object.freeze([...new Set(sources)]),
    });
  }

  private unknown<T>(): CoachProfileDatum<T> {
    return Object.freeze({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.UNKNOWN,
      sources: Object.freeze([]),
    });
  }

  private record(
    value: Prisma.JsonValue | undefined,
  ): Prisma.JsonObject | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value
      : undefined;
  }

  private optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }
}
