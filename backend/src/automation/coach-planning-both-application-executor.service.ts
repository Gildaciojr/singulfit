import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DietGeneratorService } from '../diet/diet-generator.service';
import type { LegacyDietCandidate } from '../diet/interfaces/legacy-diet-candidate.interface';
import { WorkoutGeneratorService } from '../workout/workout-generator.service';
import type { LegacyWorkoutCandidate } from '../workout/interfaces/legacy-workout-candidate.interface';

@Injectable()
export class CoachPlanningBothApplicationExecutorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dietGenerator: DietGeneratorService,
    private readonly workoutGenerator: WorkoutGeneratorService,
  ) {}

  async execute(
    dietCandidate: LegacyDietCandidate,
    workoutCandidate: LegacyWorkoutCandidate,
  ) {
    this.assertSharedOwnership(dietCandidate, workoutCandidate);
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const diet = await this.dietGenerator.commitCandidateInTransaction(
            transaction,
            dietCandidate,
          );
          const workout =
            await this.workoutGenerator.commitCandidateInTransaction(
              transaction,
              workoutCandidate,
            );
          if (diet.persistence !== workout.persistence) {
            throw new ConflictException(
              'Estado parcial preexistente detectado no planejamento combinado',
            );
          }
          return Object.freeze({
            persistence: diet.persistence,
            dietPlan: diet.plan,
            workoutPlan: workout.plan,
          });
        },
        {
          maxWait: 5_000,
          timeout: 15_000,
        },
      );
    } catch (error: unknown) {
      await Promise.all([
        this.dietGenerator.failCandidate(dietCandidate, error),
        this.workoutGenerator.failCandidate(workoutCandidate, error),
      ]);
      throw error;
    }
  }

  private assertSharedOwnership(
    dietCandidate: LegacyDietCandidate,
    workoutCandidate: LegacyWorkoutCandidate,
  ): void {
    if (
      dietCandidate.userId !== workoutCandidate.userId ||
      dietCandidate.profileId !== workoutCandidate.profileId
    ) {
      throw new ConflictException(
        'Candidatos do planejamento combinado pertencem a contextos diferentes',
      );
    }
  }
}
