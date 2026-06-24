import { ActivityLevel, FitnessGoal, Gender, Prisma } from '@prisma/client';
import {
  ACTIVATION_ONBOARDING_START_MODE,
  ACTIVATION_ONBOARDING_STATE,
  ACTIVATION_ONBOARDING_STATUS,
} from './activation-onboarding.constants';

export type ActivationOnboardingState =
  (typeof ACTIVATION_ONBOARDING_STATE)[keyof typeof ACTIVATION_ONBOARDING_STATE];

export type ActivationOnboardingStatus =
  (typeof ACTIVATION_ONBOARDING_STATUS)[keyof typeof ACTIVATION_ONBOARDING_STATUS];

export type ActivationOnboardingStartMode =
  (typeof ACTIVATION_ONBOARDING_START_MODE)[keyof typeof ACTIVATION_ONBOARDING_START_MODE];

export interface ActivationOnboardingAnswers {
  age: number | null;
  birthDate: string | null;
  heightCm: number | null;
  currentWeightKg: string | null;
  gender: Gender | null;
  commercialGoal: string | null;
  fitnessGoal: FitnessGoal | null;
  activityLevel: ActivityLevel | null;
  restrictions: string[];
  desiredResultText: string | null;
  targetWeightKg: string | null;
  targetWeightSource: string | null;
}

export interface ActivationOnboardingPendingInput {
  messageId: string;
  text: string;
  receivedAt: string;
}

export interface ActivationOnboardingSessionContent {
  version: string;
  source: string;
  activationId: string;
  status: ActivationOnboardingStatus;
  currentState: ActivationOnboardingState;
  previousState: ActivationOnboardingState | null;
  expectedNextState: ActivationOnboardingState | null;
  startMode: ActivationOnboardingStartMode | null;
  userFirstName: string | null;
  answers: ActivationOnboardingAnswers;
  pendingInput: ActivationOnboardingPendingInput | null;
  lastProcessedMessageId: string | null;
  lastPromptState: ActivationOnboardingState | null;
  lastPromptAt: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ActivationOnboardingSession {
  id: string;
  userId: string;
  sourceKey: string;
  content: ActivationOnboardingSessionContent;
  summary: string;
  generatedAt: Date;
}

export interface StartActivationOnboardingInput {
  userId: string;
  activationId: string;
  userFirstName?: string | null;
  startedAt?: Date;
}

export interface PersistActivationOnboardingInput {
  userId: string;
  content: ActivationOnboardingSessionContent;
  generatedAt?: Date;
}

export interface UpdateActivationOnboardingStateInput {
  userId: string;
  state: ActivationOnboardingState;
  previousState?: ActivationOnboardingState | null;
  expectedNextState?: ActivationOnboardingState | null;
  startMode?: ActivationOnboardingStartMode | null;
  pendingInput?: ActivationOnboardingPendingInput | null;
  lastProcessedMessageId?: string | null;
  lastPromptState?: ActivationOnboardingState | null;
  lastPromptAt?: Date | null;
  updatedAt?: Date;
}

export interface CompleteActivationOnboardingInput {
  userId: string;
  completedAt?: Date;
}

export interface ProcessActivationOnboardingTextInput {
  userId: string;
  messageId: string;
  receivedAt?: Date;
}

export interface ProcessActivationOnboardingTextResult {
  handled: boolean;
  duplicated: boolean;
  state: ActivationOnboardingState | null;
  reason?: string;
}

export type ActivationOnboardingJson = Prisma.InputJsonObject;
