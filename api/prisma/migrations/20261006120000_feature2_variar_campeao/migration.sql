-- Feature 2 "variar campeão" (docs/contratos/feature-2-variar-campeao.md, aprovado 06/10). Dono: maquina-arquiteto.
-- Gerado com prisma migrate diff + backfill de scenes.pipeline + CHECK de dono do rosto (no fim).

-- CreateEnum
CREATE TYPE "ChampionStatus" AS ENUM ('RESOLVING', 'ANALYZING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ChampionRights" AS ENUM ('OWN', 'THIRD_PARTY');

-- CreateEnum
CREATE TYPE "VariationKind" AS ENUM ('SWAP_AVATAR', 'NEW_HOOKS', 'COPY_NEW', 'REMIX_EDIT');

-- CreateEnum
CREATE TYPE "VariationBatchStatus" AS ENUM ('PLANNING', 'PLAN_READY', 'PLAN_FAILED', 'LAUNCHED');

-- CreateEnum
CREATE TYPE "CreativeOrigin" AS ENUM ('SCRATCH', 'VARIATION');

-- CreateEnum
CREATE TYPE "VoiceSource" AS ENUM ('CATALOG', 'CHAMPION_AUDIO');

-- CreateEnum
CREATE TYPE "ScenePipeline" AS ENUM ('SCENE_VIDEO', 'TTS_LIPSYNC', 'AUDIO_LIPSYNC', 'SOURCE_CUT', 'REUSE');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'EXPIRED');

-- AlterEnum
ALTER TYPE "CostKind" ADD VALUE 'SCRAPE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FileKind" ADD VALUE 'CHAMPION_VIDEO';
ALTER TYPE "FileKind" ADD VALUE 'CHAMPION_AUDIO';
ALTER TYPE "FileKind" ADD VALUE 'CHAMPION_FRAME';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobType" ADD VALUE 'CHAMPION_RESOLVE';
ALTER TYPE "JobType" ADD VALUE 'CHAMPION_ANALYZE';
ALTER TYPE "JobType" ADD VALUE 'VARIATIONS_PLAN';
ALTER TYPE "JobType" ADD VALUE 'VARIATION_ITEM_REGENERATE';

-- AlterEnum
ALTER TYPE "Provider" ADD VALUE 'APIFY';

-- AlterTable
ALTER TABLE "cost_entries" ADD COLUMN     "champion_id" TEXT,
ADD COLUMN     "variation_batch_id" TEXT;

-- AlterTable
ALTER TABLE "creatives" ADD COLUMN     "champion_id" TEXT,
ADD COLUMN     "origin" "CreativeOrigin" NOT NULL DEFAULT 'SCRATCH',
ADD COLUMN     "variation_batch_id" TEXT,
ADD COLUMN     "variation_item_id" TEXT,
ADD COLUMN     "variation_kind" "VariationKind",
ADD COLUMN     "voice_source" "VoiceSource" NOT NULL DEFAULT 'CATALOG';

-- AlterTable
ALTER TABLE "faces" ADD COLUMN     "casting_id" TEXT,
ALTER COLUMN "creative_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "champion_id" TEXT,
ADD COLUMN     "variation_batch_id" TEXT;

-- AlterTable
ALTER TABLE "provider_tasks" ADD COLUMN     "champion_id" TEXT;

-- AlterTable
ALTER TABLE "scenes" ADD COLUMN     "pipeline" "ScenePipeline" NOT NULL DEFAULT 'TTS_LIPSYNC',
ADD COLUMN     "reuse_of_scene_id" TEXT,
ADD COLUMN     "source_end_sec" DECIMAL(8,3),
ADD COLUMN     "source_start_sec" DECIMAL(8,3);

-- CreateTable
CREATE TABLE "uploads" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'PENDING',
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_id" TEXT,
    "error_code" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "champions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ChampionStatus" NOT NULL,
    "rights" "ChampionRights" NOT NULL DEFAULT 'THIRD_PARTY',
    "rights_declared_by_id" TEXT,
    "rights_declared_at" TIMESTAMP(3),
    "ad_library_url" TEXT,
    "ad_archive_id" TEXT,
    "ad_meta" JSONB,
    "video_file_id" TEXT,
    "audio_file_id" TEXT,
    "thumbnail_file_id" TEXT,
    "duration_sec" DECIMAL(8,3),
    "language" TEXT,
    "has_speech" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "source_creative_id" TEXT,
    "error_code" TEXT,
    "fail_reason" TEXT,
    "created_by_id" TEXT NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "champions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teardowns" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "champion_id" TEXT NOT NULL,
    "transcript" JSONB NOT NULL DEFAULT '{}',
    "measurements" JSONB NOT NULL DEFAULT '{}',
    "sections" JSONB NOT NULL DEFAULT '{}',
    "edited_sections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "model" TEXT,
    "analyzed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teardowns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variation_batches" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "champion_id" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "status" "VariationBatchStatus" NOT NULL DEFAULT 'PLANNING',
    "language" TEXT NOT NULL,
    "requests" JSONB NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "teardown_snapshot" JSONB,
    "notes" TEXT,
    "estimated_cost_usd" DECIMAL(12,4),
    "launched_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "variation_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variation_castings" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "selected_face_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "variation_castings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variation_items" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "kind" "VariationKind" NOT NULL,
    "index" INTEGER NOT NULL,
    "is_control" BOOLEAN NOT NULL DEFAULT false,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "status" "ScriptStatus" NOT NULL DEFAULT 'WRITING',
    "lever" TEXT,
    "rationale" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "casting_id" TEXT,
    "error_code" TEXT,
    "fail_reason" TEXT,
    "job_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "variation_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uploads_storage_key_key" ON "uploads"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "uploads_file_id_key" ON "uploads"("file_id");

-- CreateIndex
CREATE INDEX "uploads_workspace_id_status_idx" ON "uploads"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "uploads_status_expires_at_idx" ON "uploads"("status", "expires_at");

-- CreateIndex
CREATE INDEX "champions_workspace_id_archived_at_updated_at_idx" ON "champions"("workspace_id", "archived_at", "updated_at");

-- CreateIndex
CREATE INDEX "champions_offer_id_idx" ON "champions"("offer_id");

-- CreateIndex
CREATE UNIQUE INDEX "teardowns_champion_id_key" ON "teardowns"("champion_id");

-- CreateIndex
CREATE INDEX "variation_batches_champion_id_created_at_idx" ON "variation_batches"("champion_id", "created_at");

-- CreateIndex
CREATE INDEX "variation_batches_workspace_id_created_at_idx" ON "variation_batches"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "variation_castings_batch_id_idx" ON "variation_castings"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "variation_items_batch_id_kind_index_key" ON "variation_items"("batch_id", "kind", "index");

-- CreateIndex
CREATE INDEX "cost_entries_champion_id_idx" ON "cost_entries"("champion_id");

-- CreateIndex
CREATE INDEX "cost_entries_variation_batch_id_idx" ON "cost_entries"("variation_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "creatives_variation_item_id_key" ON "creatives"("variation_item_id");

-- CreateIndex
CREATE INDEX "creatives_champion_id_idx" ON "creatives"("champion_id");

-- CreateIndex
CREATE INDEX "creatives_variation_batch_id_idx" ON "creatives"("variation_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "faces_casting_id_batch_position_key" ON "faces"("casting_id", "batch", "position");

-- CreateIndex
CREATE INDEX "scenes_reuse_of_scene_id_idx" ON "scenes"("reuse_of_scene_id");

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_champion_id_fkey" FOREIGN KEY ("champion_id") REFERENCES "champions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_variation_batch_id_fkey" FOREIGN KEY ("variation_batch_id") REFERENCES "variation_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_variation_item_id_fkey" FOREIGN KEY ("variation_item_id") REFERENCES "variation_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faces" ADD CONSTRAINT "faces_casting_id_fkey" FOREIGN KEY ("casting_id") REFERENCES "variation_castings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_reuse_of_scene_id_fkey" FOREIGN KEY ("reuse_of_scene_id") REFERENCES "scenes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_champion_id_fkey" FOREIGN KEY ("champion_id") REFERENCES "champions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_variation_batch_id_fkey" FOREIGN KEY ("variation_batch_id") REFERENCES "variation_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_tasks" ADD CONSTRAINT "provider_tasks_champion_id_fkey" FOREIGN KEY ("champion_id") REFERENCES "champions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_champion_id_fkey" FOREIGN KEY ("champion_id") REFERENCES "champions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_variation_batch_id_fkey" FOREIGN KEY ("variation_batch_id") REFERENCES "variation_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "champions" ADD CONSTRAINT "champions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "champions" ADD CONSTRAINT "champions_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "champions" ADD CONSTRAINT "champions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "champions" ADD CONSTRAINT "champions_rights_declared_by_id_fkey" FOREIGN KEY ("rights_declared_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "champions" ADD CONSTRAINT "champions_video_file_id_fkey" FOREIGN KEY ("video_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "champions" ADD CONSTRAINT "champions_audio_file_id_fkey" FOREIGN KEY ("audio_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "champions" ADD CONSTRAINT "champions_thumbnail_file_id_fkey" FOREIGN KEY ("thumbnail_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teardowns" ADD CONSTRAINT "teardowns_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teardowns" ADD CONSTRAINT "teardowns_champion_id_fkey" FOREIGN KEY ("champion_id") REFERENCES "champions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variation_batches" ADD CONSTRAINT "variation_batches_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variation_batches" ADD CONSTRAINT "variation_batches_champion_id_fkey" FOREIGN KEY ("champion_id") REFERENCES "champions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variation_batches" ADD CONSTRAINT "variation_batches_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variation_batches" ADD CONSTRAINT "variation_batches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variation_castings" ADD CONSTRAINT "variation_castings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variation_castings" ADD CONSTRAINT "variation_castings_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "variation_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variation_castings" ADD CONSTRAINT "variation_castings_selected_face_id_fkey" FOREIGN KEY ("selected_face_id") REFERENCES "faces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variation_items" ADD CONSTRAINT "variation_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variation_items" ADD CONSTRAINT "variation_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "variation_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variation_items" ADD CONSTRAINT "variation_items_casting_id_fkey" FOREIGN KEY ("casting_id") REFERENCES "variation_castings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variation_items" ADD CONSTRAINT "variation_items_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: pipeline das cenas v1 pelo motor do criativo.
UPDATE "scenes" s SET "pipeline" = 'SCENE_VIDEO'
  FROM "creatives" c WHERE s."creative_id" = c."id" AND c."engine" = 'SCENES';

-- O rosto pertence a um criativo OU a um elenco de lote, exatamente um.
ALTER TABLE "faces" ADD CONSTRAINT "faces_owner_check"
  CHECK (("creative_id" IS NOT NULL) <> ("casting_id" IS NOT NULL));
