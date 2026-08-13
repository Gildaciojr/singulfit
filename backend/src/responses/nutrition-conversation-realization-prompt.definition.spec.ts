import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NUTRITION_CONVERSATION_REALIZATION_PROMPT } from './nutrition-conversation-realization-prompt.definition';

describe('NUTRITION_CONVERSATION_REALIZATION_PROMPT', () => {
  it('defines the compatible realization prompt version 2', () => {
    expect(NUTRITION_CONVERSATION_REALIZATION_PROMPT).toMatchObject({
      name: 'nutrition_conversation_realization',
      version: 2,
      capability: 'CONVERSATION_REALIZATION',
      model: 'TEXT',
      schema: {
        name: 'nutrition_conversation_language_units',
        schema: expect.objectContaining({ type: 'object' }),
      },
    });
  });

  it('states the canonical claim semantics without domain examples', () => {
    const instructions = NUTRITION_CONVERSATION_REALIZATION_PROMPT.instructions;

    expect(instructions).toMatch(/claims\.usesMemory[\s\S]+source "MEMORY"/u);
    expect(instructions).toMatch(/"LONGITUDINAL" não é "MEMORY"/u);
    expect(instructions).toMatch(/"USER_CONTEXT" não é "MEMORY"/u);
    expect(instructions).toMatch(
      /claims\.usesRecommendation[\s\S]+direction\.authorizedRecommendation/u,
    );
    expect(instructions).not.toMatch(/arroz|feij[aã]o|can[aá]rio/iu);
  });

  it('is wired to the existing PromptVersion upsert convention', () => {
    const seed = readFileSync(join(__dirname, '../../prisma/seed.ts'), 'utf8');

    expect(seed).toContain(
      'upsertActivePromptDefinition(NUTRITION_CONVERSATION_REALIZATION_PROMPT)',
    );
  });
});
