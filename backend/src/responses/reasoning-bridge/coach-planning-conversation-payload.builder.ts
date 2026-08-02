import { CoachCoachingStyle, CoachTone, StageOfChange } from '@prisma/client';
import { DEFAULT_NUTRITION_CONVERSATION_COACH_STYLE } from '../nutrition-conversation-coach-style.engine';
import type { SanitizedConversationPayload } from '../sanitized-conversation-payload.contract';
import type { ConversationReasoningHumanEvidence } from './conversation-reasoning-bridge.contract';

const OFFICIAL_CONTENT_FACT = 'coachPlanning.officialContent';
const PLANNING_BLOCK = 'coachPlanning.response';

export class CoachPlanningConversationPayloadBuilder {
  build(
    content: string,
    human: ConversationReasoningHumanEvidence | null = null,
  ): SanitizedConversationPayload {
    const maximumLength = Math.min(
      10_000,
      Math.max(500, Array.from(content).length + 1_000),
    );
    return Object.freeze({
      facts: Object.freeze({
        allowed: Object.freeze([
          Object.freeze({
            key: OFFICIAL_CONTENT_FACT,
            source: 'COACH' as const,
            value: content,
            estimated: false,
          }),
          ...this.humanFacts(human),
        ]),
        sensitive: Object.freeze([]),
        disclaimerRequired: Object.freeze([]),
      }),
      selectedDecisions: Object.freeze([
        'PROVIDE_RECOMMENDATION' as const,
        ...(human?.goal ? (['MENTION_GOAL'] as const) : []),
        ...(human?.memory.length ? (['USE_MEMORY'] as const) : []),
        ...(human?.progress ? (['MENTION_LONGITUDINAL'] as const) : []),
      ]),
      structure: Object.freeze({
        dialogueProfile: 'DETAILED_ANALYSIS' as const,
        centralIntent: 'ANALYZE' as const,
        blocks: Object.freeze([
          Object.freeze({
            key: PLANNING_BLOCK,
            type: 'DIRECT_ANSWER' as const,
            decisions: Object.freeze(['PROVIDE_RECOMMENDATION'] as const),
            facts: Object.freeze([OFFICIAL_CONTENT_FACT]),
            order: 0,
            paragraph: 1,
            presentation: 'BULLETS' as const,
            required: true,
            maximumLength,
          }),
        ]),
        depth: 'EXTENSIVE' as const,
        density: 'HIGH' as const,
        rhythm: 'EXPLANATORY' as const,
        presentation: 'BULLETS' as const,
        paragraphCount: 12,
      }),
      style: Object.freeze({
        coach: DEFAULT_NUTRITION_CONVERSATION_COACH_STYLE,
        communication: 'BALANCED' as const,
        coaching: CoachCoachingStyle.EDUCATOR,
        tone: CoachTone.MODERATE,
        motivationFocus: 'HEALTH' as const,
        stageOfChange: StageOfChange.ACTION,
      }),
      limits: Object.freeze({
        maximumLength,
        maximumEmojiCount: 2,
        maximumQuestions: 1,
        maximumActions: 2,
        maximumFacts: 8,
        maximumBlocks: 3,
        maximumParagraphs: 12,
      }),
      policies: Object.freeze({
        estimateQualificationRequired: false,
        emojiAllowed: true,
        closingRequirement: 'OPTIONAL' as const,
      }),
    });
  }

  private humanFacts(human: ConversationReasoningHumanEvidence | null) {
    if (!human) return Object.freeze([]);
    const values = [
      ['coachHuman.preferredName', human.preferredName, 'USER_CONTEXT'],
      ['coachHuman.goal', human.goal, 'USER_CONTEXT'],
      ['coachHuman.desiredOutcome', human.desiredOutcome, 'USER_CONTEXT'],
      ['coachHuman.trainingTime', human.trainingTime, 'USER_CONTEXT'],
      ['coachHuman.trainingModality', human.trainingModality, 'USER_CONTEXT'],
      [
        'coachHuman.trainingExperience',
        human.trainingExperience,
        'USER_CONTEXT',
      ],
      ['coachHuman.foodPreferences', human.foodPreferences, 'USER_CONTEXT'],
      ['coachHuman.rejectedFoods', human.rejectedFoods, 'USER_CONTEXT'],
      ['coachHuman.restrictions', human.restrictions, 'USER_CONTEXT'],
      ['coachHuman.communicationStyle', human.communicationStyle, 'BEHAVIOR'],
      ['coachHuman.motivation', human.motivation, 'BEHAVIOR'],
      ['coachHuman.memory', human.memory, 'MEMORY'],
      ['coachHuman.continuity', human.continuity, 'MEMORY'],
      ['coachHuman.progress', human.progress, 'LONGITUDINAL'],
      ['coachHuman.currentDiet', human.currentDiet, 'USER_CONTEXT'],
      ['coachHuman.currentWorkout', human.currentWorkout, 'USER_CONTEXT'],
    ] as const;
    return Object.freeze(
      values
        .filter(
          ([, value]) =>
            value !== null && (!Array.isArray(value) || value.length > 0),
        )
        .map(([key, value, source]) =>
          Object.freeze({ key, source, value, estimated: false }),
        ),
    );
  }
}
