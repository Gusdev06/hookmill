-- render-lambda-v1 §6.2 (25/10/2026): estado do render assíncrono (RenderPort), custo do Lambda. Aditiva.
-- AlterEnum
ALTER TYPE "CostKind" ADD VALUE 'RENDER';

-- AlterEnum
ALTER TYPE "Provider" ADD VALUE 'AWS_LAMBDA';

-- AlterTable
ALTER TABLE "cost_entries" ADD COLUMN     "external_ref" TEXT;

-- AlterTable
ALTER TABLE "renders" ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cost_usd" DECIMAL(12,4),
ADD COLUMN     "external_bucket" TEXT,
ADD COLUMN     "external_id" TEXT,
ADD COLUMN     "finalizing_at" TIMESTAMP(3),
ADD COLUMN     "impl" TEXT,
ADD COLUMN     "not_before" TIMESTAMP(3),
ADD COLUMN     "serve_url" TEXT,
ADD COLUMN     "submitted_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "cost_entries_external_ref_key" ON "cost_entries"("external_ref");

-- CreateIndex
CREATE INDEX "renders_impl_status_idx" ON "renders"("impl", "status");

