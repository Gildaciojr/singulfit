CREATE UNIQUE INDEX "payments_one_active_charge_per_invoice_key"
  ON "payments"("invoiceId")
  WHERE "status" IN ('CREATED', 'PENDING', 'PROCESSING');
