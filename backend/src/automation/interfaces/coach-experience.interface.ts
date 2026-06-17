import {
  CoachCommunicationProfileType,
  CoachMotivationalTrigger,
  CoachReengagementReason,
} from '@prisma/client';

export interface CoachExperienceSignals {
  communication: {
    dominantStyle: CoachCommunicationProfileType;
    confidence: number;
    scores: Record<CoachCommunicationProfileType, number>;
  };
  motivation: {
    dominantTrigger: CoachMotivationalTrigger;
    confidence: number;
    scores: Record<CoachMotivationalTrigger, number>;
  };
  fatigue: {
    score: number;
    recommendedFrequencyHours: number;
    repeatedThemeScore: number;
    repeatedPhraseScore: number;
    interactionResponseScore: number;
  };
  reengagement: {
    reason: CoachReengagementReason;
    confidence: number;
    messageVariant: number;
  } | null;
  momentum: {
    score: number;
  };
  retention: {
    score: number;
  };
  whatsapp: {
    idealMessageLength: number;
    idealEmojiCount: number;
    idealFrequencyHours: number;
    preferredHourUtc: number | null;
  };
  canSendCoachMessage: boolean;
  nextCoachMessageAt: Date | null;
}
