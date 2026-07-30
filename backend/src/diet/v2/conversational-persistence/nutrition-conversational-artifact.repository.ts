import type {
  AIJobStatus,
  AIJobType,
  NutritionArtifactType,
  NutritionConversationalArtifact,
  Prisma,
} from '@prisma/client';

export const NUTRITION_CONVERSATIONAL_ARTIFACT_REPOSITORY = Symbol(
  'NUTRITION_CONVERSATIONAL_ARTIFACT_REPOSITORY',
);

export interface ConversationalArtifactOwnershipRecord {
  readonly userExists: boolean;
  readonly aiJob: {
    readonly id: string;
    readonly userId: string;
    readonly type: AIJobType;
    readonly status: AIJobStatus;
    readonly operationKey: string | null;
  } | null;
  readonly reviewedPlan: {
    readonly id: string;
    readonly userId: string;
  } | null;
}

export interface CreateConversationalArtifactRecord {
  readonly userId: string;
  readonly artifactType: NutritionArtifactType;
  readonly schemaVersion: string;
  readonly document: Prisma.InputJsonObject;
  readonly aiJobId: string;
  readonly operationKey: string;
  readonly reviewedPlanId: string | null;
}

export interface NutritionConversationalArtifactRepository {
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
      readonly aiJobId: string;
      readonly reviewedPlanId: string | null;
    },
  ): Promise<ConversationalArtifactOwnershipRecord>;
  findExisting(
    transaction: Prisma.TransactionClient,
    aiJobId: string,
    operationKey: string,
  ): Promise<NutritionConversationalArtifact | null>;
  create(
    transaction: Prisma.TransactionClient,
    input: CreateConversationalArtifactRecord,
  ): Promise<NutritionConversationalArtifact>;
}
