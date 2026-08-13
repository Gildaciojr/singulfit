import type { CoachProfileDataSource } from './coach-profile-snapshot.contract';

export interface CoachConversationHumanFact<T> {
  readonly value: T;
  readonly sources: readonly CoachProfileDataSource[];
}

export interface CoachConversationHumanMemory {
  readonly summary: string;
  readonly relation: 'RECENT_CONVERSATION' | 'PROFILE_MEMORY';
}

export interface CoachConversationRecentTurn {
  readonly direction: 'USER' | 'COACH';
  readonly text: string;
}

export type CoachConversationTurnCue =
  | 'GREETING'
  | 'THANKS'
  | 'AFFIRMATION'
  | 'NEGATION'
  | 'FAREWELL'
  | 'HELP_REQUEST'
  | 'CONTINUITY'
  | 'COMMON';

export interface CoachConversationHumanContext {
  readonly currentMessage: string;
  readonly turnCue: CoachConversationTurnCue;
  readonly preferredName: CoachConversationHumanFact<string> | null;
  readonly goal: CoachConversationHumanFact<string> | null;
  readonly desiredOutcome: CoachConversationHumanFact<string> | null;
  readonly routine: {
    readonly trainingTime: CoachConversationHumanFact<string> | null;
    readonly mealTimes: CoachConversationHumanFact<readonly string[]> | null;
    readonly cookingAvailability: CoachConversationHumanFact<string> | null;
    readonly mealsAwayFromHome: CoachConversationHumanFact<boolean> | null;
  };
  readonly training: {
    readonly modality: CoachConversationHumanFact<string> | null;
    readonly experience: CoachConversationHumanFact<string> | null;
  };
  readonly nutrition: {
    readonly dietaryPattern: CoachConversationHumanFact<string> | null;
    readonly preferredFoods: CoachConversationHumanFact<
      readonly string[]
    > | null;
    readonly rejectedFoods: CoachConversationHumanFact<
      readonly string[]
    > | null;
  };
  readonly restrictions: CoachConversationHumanFact<readonly string[]> | null;
  readonly communication: {
    readonly style: CoachConversationHumanFact<string> | null;
    readonly coachingStyle: CoachConversationHumanFact<string> | null;
    readonly tone: CoachConversationHumanFact<string> | null;
    readonly motivation: CoachConversationHumanFact<string> | null;
    readonly messagePreference: 'SHORT' | 'BALANCED' | 'DETAILED';
    readonly journeyStage: CoachConversationHumanFact<string> | null;
  };
  readonly memory: readonly CoachConversationHumanMemory[];
  readonly recentConversation?: readonly CoachConversationRecentTurn[];
  readonly continuity: CoachConversationHumanFact<string> | null;
  readonly progress: CoachConversationHumanFact<string> | null;
  readonly currentPlans: {
    readonly diet: CoachConversationHumanFact<string> | null;
    readonly workout: CoachConversationHumanFact<string> | null;
  };
}

export interface CoachConversationHumanContextBuildInput {
  readonly currentMessage?: string;
  readonly recentHistory?: readonly {
    readonly direction: 'INBOUND' | 'OUTBOUND';
    readonly text: string;
  }[];
}
