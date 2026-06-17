import { PrismaService } from '../prisma/prisma.service';
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
});
