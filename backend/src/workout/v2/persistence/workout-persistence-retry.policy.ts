import { Prisma } from '@prisma/client';

// Connectivity, connection timeout, operation timeout and closed connection.
const RETRYABLE_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017']);

export function isRetryableWorkoutPersistenceError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError)
    return RETRYABLE_CODES.has(error.code);
  if (error instanceof Prisma.PrismaClientInitializationError)
    return (
      error.errorCode !== undefined && RETRYABLE_CODES.has(error.errorCode)
    );
  return false;
}
