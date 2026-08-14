import { PrismaService } from '../prisma/prisma.service';
import { NUTRITION_CONVERSATION_REALIZATION_PROMPT } from '../responses/nutrition-conversation-realization-prompt.definition';
import { PromptService } from './prompt.service';

describe('PromptService', () => {
  it('deactivates the previous prompt before creating an active version', async () => {
    const promptVersion = {
      id: 'prompt-version-id',
      name: 'assistant-base',
      version: 2,
      prompt: 'Prompt base sem domínio especializado.',
      isActive: true,
      createdAt: new Date(),
    };
    const transaction = {
      promptVersion: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue(promptVersion),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (currentTransaction: typeof transaction) => unknown) =>
          operation(transaction),
      ),
    };
    const service = new PromptService(prisma as unknown as PrismaService);

    const result = await service.createVersion({
      name: ' assistant-base ',
      version: 2,
      prompt: ' Prompt base sem domínio especializado. ',
      isActive: true,
    });

    expect(result).toBe(promptVersion);
    expect(transaction.promptVersion.updateMany).toHaveBeenCalledWith({
      where: {
        name: 'assistant-base',
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });
    expect(transaction.promptVersion.create).toHaveBeenCalledWith({
      data: {
        name: 'assistant-base',
        version: 2,
        prompt: 'Prompt base sem domínio especializado.',
        isActive: true,
      },
    });
  });

  it('returns the active version by name', async () => {
    const promptVersion = {
      id: 'prompt-version-id',
      name: 'assistant-base',
      isActive: true,
    };
    const prisma = {
      promptVersion: {
        findFirst: jest.fn().mockResolvedValue(promptVersion),
      },
    };
    const service = new PromptService(prisma as unknown as PrismaService);

    await expect(service.getActive('assistant-base')).resolves.toBe(
      promptVersion,
    );
  });

  it('preserves official capability, model and JSON Schema metadata', async () => {
    const promptVersion = {
      id: 'conversation-prompt-version-id',
      ...NUTRITION_CONVERSATION_REALIZATION_PROMPT,
      prompt: NUTRITION_CONVERSATION_REALIZATION_PROMPT.instructions,
      jsonSchema: NUTRITION_CONVERSATION_REALIZATION_PROMPT.schema,
      isActive: true,
      createdAt: new Date(),
    };
    const prisma = {
      promptVersion: {
        create: jest.fn().mockResolvedValue(promptVersion),
      },
    };
    const service = new PromptService(prisma as unknown as PrismaService);

    await service.createVersion({
      name: NUTRITION_CONVERSATION_REALIZATION_PROMPT.name,
      version: NUTRITION_CONVERSATION_REALIZATION_PROMPT.version,
      prompt: NUTRITION_CONVERSATION_REALIZATION_PROMPT.instructions,
      capability: NUTRITION_CONVERSATION_REALIZATION_PROMPT.capability,
      model: NUTRITION_CONVERSATION_REALIZATION_PROMPT.model,
      jsonSchema: NUTRITION_CONVERSATION_REALIZATION_PROMPT.schema as never,
    });

    expect(prisma.promptVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: NUTRITION_CONVERSATION_REALIZATION_PROMPT.name,
        version: 4,
        capability: 'CONVERSATION_REALIZATION',
        model: 'TEXT',
        jsonSchema: NUTRITION_CONVERSATION_REALIZATION_PROMPT.schema,
        isActive: false,
      }),
    });
  });
});
