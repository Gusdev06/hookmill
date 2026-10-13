-- §13 de docs/contratos/feature-2-variar-campeao.md (06/10 noite): manter a edição (teardowns.edit_map) + take contínuo de lipsync. Dono: maquina-arquiteto.
-- Gerado com prisma migrate diff a partir do schema anterior.
-- CreateEnum
CREATE TYPE "TakeKind" AS ENUM ('TTS_LIPSYNC', 'AUDIO_LIPSYNC');

-- AlterEnum
ALTER TYPE "ScenePipeline" ADD VALUE 'TAKE_SLICE';

-- AlterTable
ALTER TABLE "scenes" ADD COLUMN     "take_end_sec" DECIMAL(8,3),
ADD COLUMN     "take_id" TEXT,
ADD COLUMN     "take_start_sec" DECIMAL(8,3);

-- AlterTable
ALTER TABLE "provider_tasks" ADD COLUMN     "take_id" TEXT;

-- AlterTable
ALTER TABLE "teardowns" ADD COLUMN     "edit_map" JSONB;

-- CreateTable
CREATE TABLE "takes" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "creative_id" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "kind" "TakeKind" NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "seed" INTEGER NOT NULL DEFAULT 7,
    "speech" TEXT,
    "source_start_sec" DECIMAL(8,3),
    "source_end_sec" DECIMAL(8,3),
    "duration_sec" DECIMAL(8,3),
    "audio_file_id" TEXT,
    "clip_file_id" TEXT,
    "thumbnail_file_id" TEXT,
    "words" JSONB,
    "error_code" TEXT,
    "fail_reason" TEXT,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "takes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "takes_workspace_id_idx" ON "takes"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "takes_creative_id_generation_key" ON "takes"("creative_id", "generation");

-- CreateIndex
CREATE INDEX "scenes_take_id_idx" ON "scenes"("take_id");

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_take_id_fkey" FOREIGN KEY ("take_id") REFERENCES "takes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_tasks" ADD CONSTRAINT "provider_tasks_take_id_fkey" FOREIGN KEY ("take_id") REFERENCES "takes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takes" ADD CONSTRAINT "takes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takes" ADD CONSTRAINT "takes_creative_id_fkey" FOREIGN KEY ("creative_id") REFERENCES "creatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takes" ADD CONSTRAINT "takes_audio_file_id_fkey" FOREIGN KEY ("audio_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takes" ADD CONSTRAINT "takes_clip_file_id_fkey" FOREIGN KEY ("clip_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takes" ADD CONSTRAINT "takes_thumbnail_file_id_fkey" FOREIGN KEY ("thumbnail_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

