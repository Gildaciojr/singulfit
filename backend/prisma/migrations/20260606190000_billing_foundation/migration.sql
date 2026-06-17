-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'PENDING', 'PROCESSING', 'APPROVED', 'REJECTED', 'CANCELED', 'EXPIRED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('MERCADO_PAGO', 'MANUAL');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('BRL');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTH');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookResourceType" AS ENUM ('ORDER', 'PAYMENT', 'UNKNOWN');

-- AlterTable
ALTER TABLE "plans"
ADD COLUMN "description" TEXT,
ADD COLUMN "currency" "Currency" NOT NULL DEFAULT 'BRL',
ADD COLUMN "billingInterval" "BillingInterval" NOT NULL DEFAULT 'MONTH',
ADD COLUMN "billingIntervalCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "subscriptions"
ADD COLUMN "currentPeriodStart" TIMESTAMP(3),
ADD COLUMN "currentPeriodEnd" TIMESTAMP(3),
ADD COLUMN "gracePeriodEnd" TIMESTAMP(3),
ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "canceledAt" TIMESTAMP(3),
ADD COLUMN "endedAt" TIMESTAMP(3),
ADD COLUMN "provider" "PaymentProvider",
ADD COLUMN "externalSubscriptionId" TEXT,
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- Backfill the new period fields from the legacy source of truth.
UPDATE "subscriptions"
SET
  "currentPeriodStart" = "billingPeriodStart",
  "currentPeriodEnd" = "billingPeriodEnd";

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "externalReference" TEXT NOT NULL,
    "cycleNumber" INTEGER NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "currency" "Currency" NOT NULL DEFAULT 'BRL',
    "subtotal" DECIMAL(10,2) NOT NULL,
    "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invoices_cycleNumber_check" CHECK ("cycleNumber" > 0),
    CONSTRAINT "invoices_subtotal_check" CHECK ("subtotal" >= 0),
    CONSTRAINT "invoices_discount_check" CHECK ("discount" >= 0),
    CONSTRAINT "invoices_total_check" CHECK ("total" >= 0),
    CONSTRAINT "invoices_total_consistency_check" CHECK ("total" = "subtotal" - "discount"),
    CONSTRAINT "invoices_period_check" CHECK ("periodEnd" > "periodStart")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'BRL',
    "idempotencyKey" TEXT NOT NULL,
    "externalReference" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "providerPaymentId" TEXT,
    "statusDetail" TEXT,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "cardBrand" TEXT,
    "cardLastFour" TEXT,
    "pixQrCode" TEXT,
    "pixQrCodeBase64" TEXT,
    "pixTicketUrl" TEXT,
    "expiresAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payments_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "payments_installments_check" CHECK ("installments" > 0),
    CONSTRAINT "payments_cardLastFour_check" CHECK ("cardLastFour" IS NULL OR char_length("cardLastFour") = 4)
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "eventKey" TEXT NOT NULL,
    "providerEventId" TEXT,
    "resourceType" "WebhookResourceType" NOT NULL DEFAULT 'UNKNOWN',
    "resourceId" TEXT,
    "action" TEXT,
    "requestId" TEXT,
    "liveMode" BOOLEAN NOT NULL DEFAULT false,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "webhook_events_attempts_check" CHECK ("attempts" >= 0)
);

-- Plan constraints and indexes
ALTER TABLE "plans"
ADD CONSTRAINT "plans_price_check" CHECK ("price" >= 0),
ADD CONSTRAINT "plans_imageLimit_check" CHECK ("imageLimit" >= 0),
ADD CONSTRAINT "plans_billingIntervalCount_check" CHECK ("billingIntervalCount" > 0);

CREATE INDEX "plans_isActive_idx" ON "plans"("isActive");

-- Subscription constraints and indexes
ALTER TABLE "subscriptions"
ADD CONSTRAINT "subscriptions_version_check" CHECK ("version" > 0),
ADD CONSTRAINT "subscriptions_current_period_check" CHECK (
  "currentPeriodStart" IS NULL OR
  "currentPeriodEnd" IS NULL OR
  "currentPeriodEnd" > "currentPeriodStart"
),
ADD CONSTRAINT "subscriptions_grace_period_check" CHECK (
  "gracePeriodEnd" IS NULL OR
  "currentPeriodEnd" IS NULL OR
  "gracePeriodEnd" >= "currentPeriodEnd"
);

CREATE UNIQUE INDEX "subscriptions_provider_externalSubscriptionId_key"
ON "subscriptions"("provider", "externalSubscriptionId");

CREATE INDEX "subscriptions_currentPeriodEnd_idx"
ON "subscriptions"("currentPeriodEnd");

CREATE INDEX "subscriptions_gracePeriodEnd_idx"
ON "subscriptions"("gracePeriodEnd");

CREATE UNIQUE INDEX "subscriptions_one_current_per_user_key"
ON "subscriptions"("userId")
WHERE "status" IN ('PENDING_PAYMENT', 'ACTIVE', 'PAST_DUE');

-- Invoice indexes
CREATE UNIQUE INDEX "invoices_externalReference_key"
ON "invoices"("externalReference");

CREATE UNIQUE INDEX "invoices_subscriptionId_cycleNumber_key"
ON "invoices"("subscriptionId", "cycleNumber");

CREATE UNIQUE INDEX "invoices_subscriptionId_periodStart_periodEnd_key"
ON "invoices"("subscriptionId", "periodStart", "periodEnd");

CREATE INDEX "invoices_subscriptionId_status_idx"
ON "invoices"("subscriptionId", "status");

CREATE INDEX "invoices_status_dueAt_idx"
ON "invoices"("status", "dueAt");

-- Payment indexes
CREATE UNIQUE INDEX "payments_idempotencyKey_key"
ON "payments"("idempotencyKey");

CREATE UNIQUE INDEX "payments_externalReference_key"
ON "payments"("externalReference");

CREATE UNIQUE INDEX "payments_provider_providerOrderId_key"
ON "payments"("provider", "providerOrderId");

CREATE UNIQUE INDEX "payments_provider_providerPaymentId_key"
ON "payments"("provider", "providerPaymentId");

CREATE INDEX "payments_invoiceId_status_idx"
ON "payments"("invoiceId", "status");

CREATE INDEX "payments_provider_status_idx"
ON "payments"("provider", "status");

CREATE INDEX "payments_status_expiresAt_idx"
ON "payments"("status", "expiresAt");

-- Webhook indexes
CREATE UNIQUE INDEX "webhook_events_provider_eventKey_key"
ON "webhook_events"("provider", "eventKey");

CREATE INDEX "webhook_events_provider_resourceType_resourceId_idx"
ON "webhook_events"("provider", "resourceType", "resourceId");

CREATE INDEX "webhook_events_status_receivedAt_idx"
ON "webhook_events"("status", "receivedAt");

-- Foreign keys
ALTER TABLE "invoices"
ADD CONSTRAINT "invoices_subscriptionId_fkey"
FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments"
ADD CONSTRAINT "payments_invoiceId_fkey"
FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
