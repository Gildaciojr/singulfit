import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreatePromptVersionInput {
  name: string;
  version: number;
  prompt: string;
  isActive?: boolean;
}

@Injectable()
export class PromptService {
  constructor(private readonly prisma: PrismaService) {}

  async createVersion(input: CreatePromptVersionInput) {
    const data = this.normalizeInput(input);

    try {
      if (!data.isActive) {
        return await this.prisma.promptVersion.create({
          data,
        });
      }

      return await this.prisma.$transaction(async (transaction) => {
        await transaction.promptVersion.updateMany({
          where: {
            name: data.name,
            isActive: true,
          },
          data: {
            isActive: false,
          },
        });

        return transaction.promptVersion.create({
          data,
        });
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Esta versão de prompt já existe ou outra versão foi ativada',
        );
      }

      throw error;
    }
  }

  async getActive(name: string) {
    const normalizedName = this.requireText(name, 'Nome do prompt');
    const promptVersion = await this.prisma.promptVersion.findFirst({
      where: {
        name: normalizedName,
        isActive: true,
      },
    });

    if (!promptVersion) {
      throw new NotFoundException('Prompt ativo não encontrado');
    }

    return promptVersion;
  }

  async getById(promptVersionId: string) {
    const promptVersion = await this.prisma.promptVersion.findUnique({
      where: {
        id: promptVersionId,
      },
    });

    if (!promptVersion) {
      throw new NotFoundException('Versão de prompt não encontrada');
    }

    return promptVersion;
  }

  async activate(promptVersionId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const promptVersion = await transaction.promptVersion.findUnique({
        where: {
          id: promptVersionId,
        },
      });

      if (!promptVersion) {
        throw new NotFoundException('Versão de prompt não encontrada');
      }

      await transaction.promptVersion.updateMany({
        where: {
          name: promptVersion.name,
          isActive: true,
          id: {
            not: promptVersion.id,
          },
        },
        data: {
          isActive: false,
        },
      });

      return transaction.promptVersion.update({
        where: {
          id: promptVersion.id,
        },
        data: {
          isActive: true,
        },
      });
    });
  }

  private normalizeInput(input: CreatePromptVersionInput) {
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw new BadRequestException(
        'A versão do prompt deve ser um inteiro positivo',
      );
    }

    return {
      name: this.requireText(input.name, 'Nome do prompt'),
      version: input.version,
      prompt: this.requireText(input.prompt, 'Conteúdo do prompt'),
      isActive: input.isActive ?? false,
    };
  }

  private requireText(value: string, label: string): string {
    const normalized = value.trim();

    if (!normalized) {
      throw new BadRequestException(`${label} não informado`);
    }

    return normalized;
  }
}
