-- AlterTable
ALTER TABLE "subscriptions"
ADD COLUMN "activationInvoiceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_activationInvoiceId_key"
ON "subscriptions"("activationInvoiceId");

-- AddForeignKey
ALTER TABLE "subscriptions"
ADD CONSTRAINT "subscriptions_activationInvoiceId_fkey"
FOREIGN KEY ("activationInvoiceId") REFERENCES "invoices"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
