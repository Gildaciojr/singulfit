import { Prisma } from '@prisma/client';
import { isRetryableWorkoutPersistenceError } from './workout-persistence-retry.policy';

describe('Workout persistence retry classification', () => {
  it.each(['P1001', 'P1002', 'P1008', 'P1017'])(
    'recognizes infrastructure code %s on actual Prisma errors',
    (code) => {
      expect(
        isRetryableWorkoutPersistenceError(
          new Prisma.PrismaClientKnownRequestError('Transient', {
            code,
            clientVersion: '5.22.0',
          }),
        ),
      ).toBe(true);
      expect(
        isRetryableWorkoutPersistenceError(
          new Prisma.PrismaClientInitializationError(
            'Transient',
            '5.22.0',
            code,
          ),
        ),
      ).toBe(true);
    },
  );

  it.each(['P1000', 'P2002', 'P2003', 'P2025'])(
    'does not classify configuration or integrity code %s as transient',
    (code) => {
      expect(
        isRetryableWorkoutPersistenceError(
          new Prisma.PrismaClientKnownRequestError('Terminal', {
            code,
            clientVersion: '5.22.0',
          }),
        ),
      ).toBe(false);
    },
  );

  it('does not accept arbitrary code properties or unknown failures', () => {
    expect(isRetryableWorkoutPersistenceError({ code: 'P1001' })).toBe(false);
    expect(isRetryableWorkoutPersistenceError(new Error('Unknown'))).toBe(
      false,
    );
    expect(isRetryableWorkoutPersistenceError(null)).toBe(false);
  });
});
