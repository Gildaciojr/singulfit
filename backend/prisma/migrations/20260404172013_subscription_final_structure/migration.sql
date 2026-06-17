/*
  Warnings:

  - You are about to drop the column `endsAt` on the `subscriptions` table. All the data in the column will be lost.
  - The `paymentMethod` column on the `subscriptions` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[externalPaymentId]` on the table `subscriptions` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PIX', 'MANUAL');

-- AlterTable
ALTER TABLE "subscriptions" DROP COLUMN "endsAt",
DROP COLUMN "paymentMethod",
ADD COLUMN     "paymentMethod" "PaymentMethod";

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_externalPaymentId_key" ON "subscriptions"("externalPaymentId");

-- CreateIndex
CREATE INDEX "subscriptions_userId_billingPeriodEnd_idx" ON "subscriptions"("userId", "billingPeriodEnd");
