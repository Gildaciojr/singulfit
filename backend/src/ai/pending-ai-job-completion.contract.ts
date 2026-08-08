import type { AIJobType, Prisma } from '@prisma/client';
import type { OpenAIResponseResult } from './interfaces/openai.interface';

export interface PendingAIJobCompletion<
  TJobType extends AIJobType,
  TResult extends Prisma.InputJsonObject,
> {
  readonly userId: string;
  readonly aiJobId: string;
  readonly jobType: TJobType;
  readonly response: Readonly<OpenAIResponseResult>;
  readonly result: TResult;
}
