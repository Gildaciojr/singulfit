import { CoachCoachingStyle, CoachTone, StageOfChange } from '@prisma/client';
import { DEFAULT_NUTRITION_CONVERSATION_COACH_STYLE } from '../nutrition-conversation-coach-style.engine';
import type { SanitizedConversationPayload } from '../sanitized-conversation-payload.contract';

const OFFICIAL_CONTENT_FACT = 'coachPlanning.officialContent';
const PLANNING_BLOCK = 'coachPlanning.response';

export class CoachPlanningConversationPayloadBuilder {
  build(content: string): SanitizedConversationPayload {
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
        ]),
        sensitive: Object.freeze([]),
        disclaimerRequired: Object.freeze([]),
      }),
      selectedDecisions: Object.freeze(['PROVIDE_RECOMMENDATION'] as const),
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
}
