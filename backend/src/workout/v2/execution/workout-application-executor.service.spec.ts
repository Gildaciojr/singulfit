import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { WorkoutPlanV2PersistenceService } from '../persistence/workout-plan-v2-persistence.service';
import type { PersistWorkoutPlanV2Input } from '../persistence/workout-plan-v2-persistence.contract';
import { WorkoutApplicationExecutorService } from './workout-application-executor.service';

describe('WorkoutApplicationExecutorService', () => {
  it('accepts an existing candidate contract and delegates only to persistence', async () => {
    const persistence = {
      persist: jest.fn().mockResolvedValue({
        persistence: 'CREATED',
        aiJobCompleted: true,
        aggregate: {
          id: 'plan-id',
          document: { artifactType: 'WEEKLY_PLAN' },
        },
      }),
    } as unknown as jest.Mocked<WorkoutPlanV2PersistenceService>;
    const executor = new WorkoutApplicationExecutorService(persistence);
    const candidate = Object.freeze({
      marker: 'candidate',
    }) as unknown as PersistWorkoutPlanV2Input;

    await expect(executor.execute(candidate)).resolves.toMatchObject({
      kind: 'PLAN',
      aggregateId: 'plan-id',
      artifactType: 'WEEKLY_PLAN',
      persistence: 'CREATED',
      aiJobCompleted: true,
    });
    expect(persistence.persist.mock.calls).toEqual([[candidate]]);
    expect(Object.keys(executor)).toEqual(['persistence']);
  });

  it('has no productive caller outside Workout V2', () => {
    const sourceRoot = resolve(__dirname, '..', '..', '..');
    const modulePath = resolve(__dirname, '..', '..', 'workout.module.ts');
    const v2Root = resolve(__dirname, '..');
    const files = typescriptFiles(sourceRoot).filter(
      (file) =>
        !file.endsWith('.spec.ts') &&
        file !== modulePath &&
        !file.startsWith(`${v2Root}\\`) &&
        !file.startsWith(`${v2Root}/`),
    );
    const references = files.filter((file) =>
      /WorkoutPlanningEngineV2Service|WorkoutApplicationExecutorService/.test(
        readFileSync(file, 'utf8'),
      ),
    );

    expect(references).toEqual([]);
  });
});

function typescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return typescriptFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}
