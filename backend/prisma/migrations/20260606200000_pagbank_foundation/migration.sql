-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE 'PAGBANK';

-- Prevent concurrent open payment attempts for the same invoice.
CREATE UNIQUE INDEX "payments_one_current_per_invoice_key"
ON "payments"("invoiceId")
WHERE "status" IN ('CREATED', 'PENDING', 'PROCESSING');
