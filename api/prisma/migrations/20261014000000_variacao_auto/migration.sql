-- CreateEnum
CREATE TYPE "BatchMode" AS ENUM ('MANUAL', 'AUTO');

-- CreateEnum
CREATE TYPE "AutoVariationType" AS ENUM ('CUT', 'COLD_OPEN', 'HOOK_TEXT', 'ENDCARD', 'SPLIT_LP', 'STORY', 'REVIEW', 'NATIVE_SEARCH', 'STATIC');

-- CreateEnum
CREATE TYPE "VariationAxis" AS ENUM ('ITERATION', 'DIVERSITY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FileKind" ADD VALUE 'RENDER_IMAGE';
ALTER TYPE "FileKind" ADD VALUE 'PAGE_CAPTURE';
ALTER TYPE "FileKind" ADD VALUE 'ZIP_ARCHIVE';
ALTER TYPE "FileKind" ADD VALUE 'PRODUCT_IMAGE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobType" ADD VALUE 'AUTO_PLAN';
ALTER TYPE "JobType" ADD VALUE 'ZIP_BUILD';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "VariationBatchStatus" ADD VALUE 'ANALYZING';
ALTER TYPE "VariationBatchStatus" ADD VALUE 'ANALYSIS_FAILED';

-- AlterEnum
ALTER TYPE "VariationKind" ADD VALUE 'AUTO_EDIT';

-- AlterTable
ALTER TABLE "creatives" ADD COLUMN     "variation_code" TEXT;

-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "product_image_file_id" TEXT;

-- AlterTable
ALTER TABLE "renders" ADD COLUMN     "format" "VideoFormat";

-- AlterTable
ALTER TABLE "variation_batches" ADD COLUMN     "downloaded_at" TIMESTAMP(3),
ADD COLUMN     "error_code" TEXT,
ADD COLUMN     "fail_detail" TEXT,
ADD COLUMN     "fail_reason" TEXT,
ADD COLUMN     "fail_stage" TEXT,
ADD COLUMN     "insight" JSONB,
ADD COLUMN     "mode" "BatchMode" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "page_capture_file_id" TEXT,
ADD COLUMN     "zip_file_id" TEXT,
ADD COLUMN     "zip_key" TEXT;

-- AlterTable
ALTER TABLE "variation_items" ADD COLUMN     "auto_type" "AutoVariationType",
ADD COLUMN     "axis" "VariationAxis",
ADD COLUMN     "change" TEXT,
ADD COLUMN     "code" TEXT,
ADD COLUMN     "in_zip" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "left_out_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "renders_creative_id_format_idx" ON "renders"("creative_id", "format");

-- CreateIndex
CREATE INDEX "variation_batches_workspace_id_mode_status_idx" ON "variation_batches"("workspace_id", "mode", "status");

-- CreateIndex
CREATE UNIQUE INDEX "variation_items_batch_id_code_key" ON "variation_items"("batch_id", "code");

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_product_image_file_id_fkey" FOREIGN KEY ("product_image_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variation_batches" ADD CONSTRAINT "variation_batches_page_capture_file_id_fkey" FOREIGN KEY ("page_capture_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variation_batches" ADD CONSTRAINT "variation_batches_zip_file_id_fkey" FOREIGN KEY ("zip_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

