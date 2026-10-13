-- Miniatura da cena (GET /creatives/:id/scenes → scenes[].thumbnail): frame extraído pelo backend ao ingerir o clipe.
-- AlterTable
ALTER TABLE "scenes" ADD COLUMN     "thumbnail_file_id" TEXT;

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_thumbnail_file_id_fkey" FOREIGN KEY ("thumbnail_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

