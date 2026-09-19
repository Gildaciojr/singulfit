CREATE TABLE "provider_plan_mappings" (
  "id" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "billingCycles" INTEGER NOT NULL,
  "providerPlanId" TEXT NOT NULL,
  "referenceId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_plan_mappings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_plan_mappings_billingCycles_check" CHECK ("billingCycles" IN (1,3,6,12))
);
CREATE TABLE "provider_customers" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "providerCustomerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_customers_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "subscriptions" ADD COLUMN "billingCycles" INTEGER;
ALTER TABLE "invoices" ADD COLUMN "providerInvoiceId" TEXT;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_billingCycles_check"
CHECK ("billingCycles" IS NULL OR "billingCycles" IN (1, 3, 6, 12));
CREATE UNIQUE INDEX "provider_plan_mappings_planId_provider_billingCycles_key" ON "provider_plan_mappings"("planId", "provider", "billingCycles");
CREATE UNIQUE INDEX "provider_plan_mappings_provider_providerPlanId_key" ON "provider_plan_mappings"("provider", "providerPlanId");
CREATE UNIQUE INDEX "provider_plan_mappings_provider_referenceId_key" ON "provider_plan_mappings"("provider", "referenceId");
CREATE UNIQUE INDEX "provider_customers_userId_provider_key" ON "provider_customers"("userId", "provider");
CREATE UNIQUE INDEX "provider_customers_provider_providerCustomerId_key" ON "provider_customers"("provider", "providerCustomerId");
CREATE UNIQUE INDEX "invoices_providerInvoiceId_key" ON "invoices"("providerInvoiceId");
ALTER TABLE "provider_plan_mappings" ADD CONSTRAINT "provider_plan_mappings_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_customers" ADD CONSTRAINT "provider_customers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
