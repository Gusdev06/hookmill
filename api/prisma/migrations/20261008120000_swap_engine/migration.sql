-- §13.15 de docs/contratos/feature-2-variar-campeao.md (08/10): Trocar avatar com motor Kling/Seedance mantendo a edição. Dono: maquina-arquiteto.
-- Só aditiva (enum + colunas nulas + FK): segura com a API rodando no client Prisma antigo.
-- AlterEnum
ALTER TYPE "ProviderTaskKind" ADD VALUE 'LIPSYNC_VIDEO';

-- AlterEnum
ALTER TYPE "ScenePipeline" ADD VALUE 'SWAP_VIDEO';

-- AlterEnum
ALTER TYPE "VoiceSource" ADD VALUE 'ENGINE_VOICE';

-- AlterTable
ALTER TABLE "provider_tasks" ADD COLUMN     "window_index" INTEGER;

-- AlterTable
ALTER TABLE "scenes" ADD COLUMN     "end_frame" INTEGER,
ADD COLUMN     "fit" JSONB,
ADD COLUMN     "identity_score" DECIMAL(5,4),
ADD COLUMN     "raw_clip_file_id" TEXT,
ADD COLUMN     "start_frame" INTEGER,
ADD COLUMN     "windows" JSONB;

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_raw_clip_file_id_fkey" FOREIGN KEY ("raw_clip_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

