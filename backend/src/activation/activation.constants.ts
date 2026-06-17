import { ActivationStage } from '@prisma/client';

export const ACTIVATION_SOURCE = 'USER_ACTIVATION';

export const ACTIVATION_SYSTEM_EVENT = {
  STARTED: 'USER_ACTIVATION_STARTED',
  PROGRESS: 'USER_ACTIVATION_PROGRESS',
  FIRST_VALUE: 'USER_FIRST_VALUE_REACHED',
  ACTIVATED: 'USER_ACTIVATED',
  ABANDONED: 'USER_ACTIVATION_ABANDONED',
  REENGAGEMENT: 'USER_REENGAGEMENT_TRIGGERED',
} as const;

export const ACTIVATION_STAGE_ORDER: readonly ActivationStage[] = [
  ActivationStage.REGISTERED,
  ActivationStage.PAID,
  ActivationStage.WHATSAPP_CONNECTED,
  ActivationStage.FIRST_MESSAGE_SENT,
  ActivationStage.FIRST_MEAL_RECEIVED,
  ActivationStage.FIRST_ANALYSIS_COMPLETED,
  ActivationStage.FIRST_RECOMMENDATION_DELIVERED,
  ActivationStage.FIRST_COACH_INTERACTION,
  ActivationStage.ACTIVATED,
];

export const TERMINAL_ACTIVATION_STAGES = new Set<ActivationStage>([
  ActivationStage.ACTIVATED,
  ActivationStage.ABANDONED,
]);

export const ACTIVATION_FLOW_DAYS = [0, 1, 3, 5, 7] as const;
export const ACTIVATION_RECOVERY_HOURS = [24, 72, 168, 336] as const;
