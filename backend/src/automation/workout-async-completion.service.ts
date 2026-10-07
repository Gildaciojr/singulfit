import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { AIJobStatus, AIJobType, OutboxEvent } from '@prisma/client';
import { DurableTextPendingError } from '../ai/durable-text-operation.contract';
import { EventHandlerRegistry } from '../event-bus/event-handler.registry';
import { INTERNAL_EVENT } from '../event-bus/event-bus.constants';
import { PrismaService } from '../prisma/prisma.service';
import { WorkoutApplicationExecutorService } from '../workout/v2/execution/workout-application-executor.service';
import { workoutDurableContinuation } from '../workout/v2/execution/workout-durable-continuation.contract';
import { WorkoutPlanV2Formatter } from '../workout/v2/workout-plan-v2.formatter';
import { coachUserFirstName } from '../context/coach-user-name.policy';
import { CoachCommandService } from './coach-command.service';

@Injectable()
export class WorkoutAsyncCompletionService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly executor: WorkoutApplicationExecutorService,
    private readonly formatter: WorkoutPlanV2Formatter,
    private readonly commands: CoachCommandService,
    private readonly registry: EventHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(INTERNAL_EVENT.WORKOUT_ASYNC_COMPLETION, (event) =>
      this.complete(event),
    );
  }

  async complete(event: OutboxEvent): Promise<void> {
    const job = await this.prisma.aIJob.findUniqueOrThrow({
      where: { id: event.aggregateId },
    });
    const input = workoutDurableContinuation(job.result);
    if (
      job.type !== AIJobType.WORKOUT ||
      !input ||
      input.ownership.userId !== job.userId
    ) {
      throw new Error(
        'Durable workout continuation ownership/context unavailable',
      );
    }
    const messageId =
      input.executionContext?.sourceMessageId ??
      input.generationInput.currentRequest?.requestId;
    if (!messageId)
      throw new Error('Durable workout source identity unavailable');
    const source = await this.prisma.message.findFirst({
      where: { id: messageId, conversation: { userId: job.userId } },
      select: { id: true },
    });
    if (!source) throw new Error('Durable workout source ownership mismatch');
    if (
      job.status === AIJobStatus.PROCESSING &&
      job.leaseExpiresAt &&
      job.leaseExpiresAt > new Date()
    )
      throw new DurableTextPendingError();
    let content: string;
    if (job.status === AIJobStatus.FAILED) {
      content =
        'Não consegui concluir seu treino personalizado desta vez. Tente novamente em alguns instantes.';
    } else {
      try {
        const result = await this.executor.execute(input, { pollWindowMs: 0 });
        if (result.kind !== 'PLAN')
          throw new Error('Frozen workout execution no longer executable');
        content = this.formatter
          .format(result.document, {
            preferredName: coachUserFirstName(
              input.generationInput.snapshot.identity,
              job.userId,
            ),
            weekdays: result.document.sessions.map(
              (session) =>
                result.projection.days.find(
                  (day) => day.dayNumber === session.sequence,
                )?.weekday ?? null,
            ),
          })
          .join('\n\n')
          .trimEnd();
      } catch (error: unknown) {
        if (error instanceof DurableTextPendingError) throw error;
        const current = await this.prisma.aIJob.findUniqueOrThrow({
          where: { id: job.id },
        });
        if (
          error instanceof ConflictException &&
          current.status !== AIJobStatus.FAILED
        )
          throw new DurableTextPendingError();
        if (current.status !== AIJobStatus.FAILED) throw error;
        content =
          'Não consegui concluir seu treino personalizado desta vez. Tente novamente em alguns instantes.';
      }
    }
    await this.commands.deliverWorkoutCompletion({
      userId: job.userId,
      messageId,
      aiJobId: job.id,
      content,
    });
  }
}
