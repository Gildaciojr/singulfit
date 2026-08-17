import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NUTRITION_CONVERSATION_REALIZATION_PROMPT } from './nutrition-conversation-realization-prompt.definition';

describe('NUTRITION_CONVERSATION_REALIZATION_PROMPT', () => {
  it('defines the compatible realization prompt version 7', () => {
    expect(NUTRITION_CONVERSATION_REALIZATION_PROMPT).toMatchObject({
      name: 'nutrition_conversation_realization',
      version: 7,
      capability: 'CONVERSATION_REALIZATION',
      model: 'TEXT',
      schema: {
        name: 'nutrition_conversation_language_units',
        schema: expect.objectContaining({ type: 'object' }),
      },
    });
  });

  it('states the exact per-block text length contract', () => {
    const instructions = NUTRITION_CONVERSATION_REALIZATION_PROMPT.instructions;

    expect(instructions).toContain(
      'structure.blocks[].maximumLength do blockKey correspondente é um teto rígido para o campo text.',
    );
    expect(instructions).toContain(
      'Nunca produza text com mais caracteres do que o maximumLength do respectivo bloco, nem por um caractere.',
    );
    expect(instructions).toContain(
      'Prefira uma formulação concisa e confortavelmente abaixo do teto; não tente preencher todo o maximumLength disponível.',
    );
    expect(instructions).toContain(
      'maximumLength limita somente o campo text da unidade; factKeys, decisionCodes e claims não fazem parte dessa contagem.',
    );
  });

  it('requires compact image analysis without relaxing V6 contracts', () => {
    const instructions = NUTRITION_CONVERSATION_REALIZATION_PROMPT.instructions;

    expect(instructions).toContain(
      'UNCERTAINTY_QUALIFICATION deve ser uma única frase curta.',
    );
    expect(instructions).toContain(
      'Não crie introduções, transições ou fechamentos apenas para preencher a estrutura.',
    );
    expect(instructions).toContain(
      'Fatos históricos disponíveis não autorizam comentário de continuidade quando a estrutura não os selecionou.',
    );
    expect(instructions).toContain(
      'Nunca produza text com mais caracteres do que o maximumLength do respectivo bloco, nem por um caractere.',
    );
  });

  it('states the canonical claim semantics without domain examples', () => {
    const instructions = NUTRITION_CONVERSATION_REALIZATION_PROMPT.instructions;

    expect(instructions).toMatch(/claims\.usesMemory[\s\S]+source "MEMORY"/u);
    expect(instructions).toMatch(/"LONGITUDINAL" não é "MEMORY"/u);
    expect(instructions).toMatch(/"USER_CONTEXT" não é "MEMORY"/u);
    expect(instructions).toMatch(
      /claims\.usesRecommendation[\s\S]+direction\.authorizedRecommendation/u,
    );
    expect(instructions).toContain(
      'claims descreve somente o conteúdo efetivamente realizado em text, não todo o conteúdo disponível nos factKeys.',
    );
    expect(instructions).toContain(
      'Em claims.numbers, declare todos e somente os valores numéricos efetivamente escritos em text.',
    );
    expect(instructions).toContain(
      'Se text não contiver nenhum número, claims.numbers deve ser [].',
    );
    expect(instructions).toContain(
      'Não inclua números apenas por estarem autorizados ou disponíveis nos factKeys.',
    );
    expect(instructions).toContain(
      'No text, não use separador de milhar; use vírgula apenas como separador decimal.',
    );
    expect(instructions).toContain(
      'Em claims.foods, declare somente alimentos autorizados que sejam explicitamente mencionados em text, usando o nome canônico autorizado de forma lexicalmente reconhecível.',
    );
    expect(instructions).toContain(
      'Se text não mencionar alimento, claims.foods deve ser [].',
    );
    expect(instructions).toContain(
      'Todo alimento autorizado explicitamente mencionado em text deve constar em claims.foods.',
    );
    expect(instructions).toContain(
      'Nunca declare em claims.numbers ou claims.foods conteúdo omitido de text.',
    );
    expect(instructions).toContain(
      'Não use claims como inventário de tudo que o bloco autoriza.',
    );
    expect(instructions).not.toMatch(/arroz|feij[aã]o|can[aá]rio/iu);
  });

  it('states the exact block-scope contract', () => {
    const instructions = NUTRITION_CONVERSATION_REALIZATION_PROMPT.instructions;

    expect(instructions).toMatch(/factKeys[\s\S]+mesmo bloco/u);
    expect(instructions).toMatch(/decisionCodes[\s\S]+mesmo bloco/u);
    expect(instructions).toMatch(/Nunca empreste factKey ou decisionCode/u);
    expect(instructions).toMatch(/omittedUnits[\s\S]+blockKey correspondente/u);
  });

  it('leaves canonical unit roles to the backend', () => {
    const instructions = NUTRITION_CONVERSATION_REALIZATION_PROMPT.instructions;
    const unitSchema =
      NUTRITION_CONVERSATION_REALIZATION_PROMPT.schema.schema.properties.units
        .items;

    expect(instructions).toMatch(
      /papel estrutural[\s\S]+determinado pelo bloco/u,
    );
    expect(instructions).toMatch(
      /Não classifique nem envie o tipo da unidade/u,
    );
    expect(unitSchema.properties).not.toHaveProperty('unitType');
    expect(unitSchema.required).not.toContain('unitType');
  });

  it('is wired to the existing PromptVersion upsert convention', () => {
    const seed = readFileSync(join(__dirname, '../../prisma/seed.ts'), 'utf8');

    expect(seed).toContain(
      'upsertActivePromptDefinition(NUTRITION_CONVERSATION_REALIZATION_PROMPT)',
    );
  });
});
