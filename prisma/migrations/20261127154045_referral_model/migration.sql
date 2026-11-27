-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "referredAt" TIMESTAMP(3),
ADD COLUMN     "referredByCode" VARCHAR(32),
ADD COLUMN     "referredByPromoterId" TEXT;

-- CreateTable
CREATE TABLE "Promoter" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT,
    "commissionBps" INTEGER NOT NULL DEFAULT 2500,
    "windowDays" INTEGER NOT NULL DEFAULT 90,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mpesaPhone" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByAdminId" TEXT,

    CONSTRAINT "Promoter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commission" (
    "id" SERIAL NOT NULL,
    "promoterId" TEXT NOT NULL,
    "userId" TEXT,
    "paymentId" INTEGER NOT NULL,
    "paymentAmount" DECIMAL(12,2) NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "payoutId" INTEGER,
    "adjustmentOfId" INTEGER,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" SERIAL NOT NULL,
    "promoterId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "mpesaReceipt" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Promoter_code_key" ON "Promoter"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Promoter_userId_key" ON "Promoter"("userId");

-- CreateIndex
CREATE INDEX "Promoter_active_idx" ON "Promoter"("active");

-- CreateIndex
CREATE INDEX "Promoter_code_idx" ON "Promoter"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Commission_paymentId_key" ON "Commission"("paymentId");

-- CreateIndex
CREATE INDEX "Commission_promoterId_status_idx" ON "Commission"("promoterId", "status");

-- CreateIndex
CREATE INDEX "Commission_userId_idx" ON "Commission"("userId");

-- CreateIndex
CREATE INDEX "Commission_earnedAt_idx" ON "Commission"("earnedAt");

-- CreateIndex
CREATE INDEX "Payout_promoterId_idx" ON "Payout"("promoterId");

-- CreateIndex
CREATE INDEX "Payout_paidAt_idx" ON "Payout"("paidAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referredByPromoterId_fkey" FOREIGN KEY ("referredByPromoterId") REFERENCES "Promoter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promoter" ADD CONSTRAINT "Promoter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_promoterId_fkey" FOREIGN KEY ("promoterId") REFERENCES "Promoter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_adjustmentOfId_fkey" FOREIGN KEY ("adjustmentOfId") REFERENCES "Commission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_promoterId_fkey" FOREIGN KEY ("promoterId") REFERENCES "Promoter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
