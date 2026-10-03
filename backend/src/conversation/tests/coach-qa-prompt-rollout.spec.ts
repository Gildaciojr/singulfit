import {
  COACH_CONVERSATIONAL_QA_V1_PROMPT,
  COACH_CONVERSATIONAL_QA_V2_PROMPT,
  COACH_CONVERSATIONAL_QA_V3_PROMPT,
  COACH_CONVERSATIONAL_QA_V4_PROMPT,
} from '../runtime/coach-conversational-qa.prompt.definition';

describe('QA nominal identity prompt rollout', () => {
  it('preserves v1-v3 instructions and schema while adding v4 name rules', () => {
    expect([
      COACH_CONVERSATIONAL_QA_V1_PROMPT.version,
      COACH_CONVERSATIONAL_QA_V2_PROMPT.version,
      COACH_CONVERSATIONAL_QA_V3_PROMPT.version,
      COACH_CONVERSATIONAL_QA_V4_PROMPT.version,
    ]).toEqual([1, 2, 3, 4]);
    expect(
      COACH_CONVERSATIONAL_QA_V4_PROMPT.instructions.startsWith(
        COACH_CONVERSATIONAL_QA_V3_PROMPT.instructions,
      ),
    ).toBe(true);
    expect(COACH_CONVERSATIONAL_QA_V4_PROMPT.schema).toBe(
      COACH_CONVERSATIONAL_QA_V3_PROMPT.schema,
    );
    expect(
      createHash('sha256')
        .update(COACH_CONVERSATIONAL_QA_V3_PROMPT.instructions)
        .digest('hex'),
    ).toBe('405348860cff70f2f3d9c142617f5744d8adf29398f4888df4a14595b4633930');
    expect(COACH_CONVERSATIONAL_QA_V4_PROMPT.instructions).toContain(
      'identity.preferredName',
    );
    expect(COACH_CONVERSATIONAL_QA_V4_PROMPT.instructions).toContain(
      'Nunca invente nome',
    );
  });
});
import { createHash } from 'node:crypto';
