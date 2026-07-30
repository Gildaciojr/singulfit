import type {
  AIJobStatus,
  AIJobType,
  NutritionArtifactType,
  NutritionPlanLifecycleReason,
  NutritionPlanStatus,
  NutritionPlanV2 as PersistedNutritionPlanV2,
  Prisma,
} from '@prisma/client';

export const NUTRITION_PLAN_V2_REPOSITORY = Symbol(
  'NUTRITION_PLAN_V2_REPOSITORY',
);

export interface NutritionPlanV2OwnershipRecord {
  readonly profileOwned: boolean;
  readonly aiJob: {
    readonly id: string;
    readonly userId: string;
    readonly type: AIJobType;
    readonly status: AIJobStatus;
    readonly promptVersionId: string;
    readonly operationKey: string | null;
  } | null;
}

export interface CreateNutritionPlanV2Record {
  readonly userId: string;
  readonly profileId: string;
  readonly aiJobId: string;
  readonly schemaVersion: number;
  readonly engineVersion: number;
  readonly artifactType: NutritionArtifactType;
  readonly lifecycleReason: NutritionPlanLifecycleReason;
  readonly replacesPlanReference: string | null;
  readonly status: NutritionPlanStatus;
  readonly document: Prisma.InputJsonObject;
  readonly generatedAt: Date;
}

export interface NutritionPlanV2Repository {
  inTransaction<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T>;
  acquireUserLock(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<void>;
  findOwnership(
    transaction: Prisma.TransactionClient,
    input: {
      readonly userId: string;
      readonly profileId: string;
      readonly aiJobId: string;
    },
  ): Promise<NutritionPlanV2OwnershipRecord>;
  findByAIJobId(
    transaction: Prisma.TransactionClient,
    aiJobId: string,
  ): Promise<PersistedNutritionPlanV2 | null>;
  archiveActive(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<void>;
  create(
    transaction: Prisma.TransactionClient,
    input: CreateNutritionPlanV2Record,
  ): Promise<PersistedNutritionPlanV2>;
}
