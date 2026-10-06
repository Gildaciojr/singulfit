import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PromptService } from '../../ai/prompt.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WORKOUT_PLANNING_V2_PROMPT } from './workout-planning-v2.prompt.definition';

/** Roll out the new immutable definition through the existing prompt lifecycle. */
@Injectable()
export class WorkoutPromptActivationService {
  constructor(
    private readonly prompts: PromptService,
    private readonly prisma: PrismaService,
  ) {}

  async ensureActive(): Promise<void> {
    const definition = WORKOUT_PLANNING_V2_PROMPT;
    let active: Awaited<ReturnType<PromptService['getActive']>> | null = null;
    try {
      active = await this.prompts.getActive(definition.name);
    } catch (error: unknown) {
      if (!(error instanceof NotFoundException)) throw error;
    }
    if (active?.version === definition.version) {
      this.assertDefinition(active.prompt);
      return;
    }
    if (active && active.version > definition.version)
      throw new ServiceUnavailableException(
        'Workout prompt version is newer than this engine',
      );
    let existing = await this.prisma.promptVersion.findUnique({
      where: {
        name_version: { name: definition.name, version: definition.version },
      },
    });
    if (!existing) {
      try {
        await this.prompts.createVersion({
          name: definition.name,
          version: definition.version,
          prompt: definition.instructions,
          capability: definition.capability,
          model: definition.model,
          jsonSchema: definition.schema as unknown as Prisma.InputJsonValue,
          isActive: true,
        });
        return;
      } catch (error: unknown) {
        // Concurrent first generation may already have created this immutable version.
        if (!(error instanceof ConflictException)) throw error;
        existing = await this.prisma.promptVersion.findUnique({
          where: {
            name_version: {
              name: definition.name,
              version: definition.version,
            },
          },
        });
        if (!existing) throw error;
      }
    }
    this.assertDefinition(existing.prompt);
    await this.prompts.activate(existing.id);
  }
  private assertDefinition(prompt: string): void {
    if (
      prompt.replace(/\r\n/gu, '\n') !==
      WORKOUT_PLANNING_V2_PROMPT.instructions.replace(/\r\n/gu, '\n')
    )
      throw new ServiceUnavailableException(
        'Workout prompt definition mismatch',
      );
  }
}
