import { OutboxEvent, Prisma } from '@prisma/client';

export interface PublishEventInput {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Prisma.InputJsonValue;
  availableAt?: Date;
}

export type OutboxEventHandler = (event: OutboxEvent) => Promise<void>;
