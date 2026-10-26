-- legenda-protegida-v1 §5 (26/10/2026): versão do campeão sem legenda queimada. Aditiva.
-- AlterEnum
ALTER TYPE "FileKind" ADD VALUE 'CHAMPION_CLEAN_VIDEO';

-- AlterTable
ALTER TABLE "champions" ADD COLUMN     "clean_video_file_id" TEXT;

-- AddForeignKey
ALTER TABLE "champions" ADD CONSTRAINT "champions_clean_video_file_id_fkey" FOREIGN KEY ("clean_video_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

