-- 31/10/2026: kit da marca (docs/contratos/kit-marca-v1.md). Aditiva: enum novo, 3 valores no FileKind, tabela brand_assets.

-- CreateEnum
CREATE TYPE "BrandAssetKind" AS ENUM ('LOGO', 'FILE', 'DEMO_VIDEO');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.

ALTER TYPE "FileKind" ADD VALUE 'BRAND_LOGO';
ALTER TYPE "FileKind" ADD VALUE 'BRAND_FILE';
ALTER TYPE "FileKind" ADD VALUE 'BRAND_VIDEO';

-- CreateTable
CREATE TABLE "brand_assets" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "kind" "BrandAssetKind" NOT NULL,
    "label" TEXT,
    "file_id" TEXT NOT NULL,
    "offer_id" TEXT,
    "colors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brand_assets_workspace_id_kind_idx" ON "brand_assets"("workspace_id", "kind");

-- AddForeignKey
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
