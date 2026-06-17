export const PROGRESS_INSIGHT_PROMPT_NAME = 'progress_insight_simple';
export const PROGRESS_INSIGHT_JSON_SCHEMA_NAME = 'progress_insight';

export const PROGRESS_INSIGHT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    insight: {
      type: 'string',
      minLength: 1,
      maxLength: 500,
    },
  },
  required: ['insight'],
  additionalProperties: false,
};
