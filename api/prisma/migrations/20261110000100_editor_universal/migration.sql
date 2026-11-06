-- editor-universal-v1 §11 (04/11): aditiva. Proxy 540p (FileKind PROXY + files.proxy_of_file_id), quem salvou a edição
-- (creatives.edit_saved_by_id/at) e o detalhe do export reprovado (renders.fail_detail).
-- AlterEnum
ALTER TYPE "FileKind" ADD VALUE 'PROXY';

-- AlterTable
ALTER TABLE "creatives" ADD COLUMN     "edit_saved_at" TIMESTAMP(3),
ADD COLUMN     "edit_saved_by_id" TEXT;

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "proxy_of_file_id" TEXT;

-- AlterTable
ALTER TABLE "renders" ADD COLUMN     "fail_detail" JSONB;

-- CreateIndex
CREATE INDEX "files_proxy_of_file_id_idx" ON "files"("proxy_of_file_id");

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_edit_saved_by_id_fkey" FOREIGN KEY ("edit_saved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_proxy_of_file_id_fkey" FOREIGN KEY ("proxy_of_file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

