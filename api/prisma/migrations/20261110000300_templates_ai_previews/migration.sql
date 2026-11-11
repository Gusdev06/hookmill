-- templates-ia-previas-v1 §8 (07/11, aprovado): aditiva. 4 prévias em imagem antes do vídeo nos templates With AI (F04/F09/F10).
-- Enum AiPreviewStatus + 4 colunas em variation_items (null/0 nos itens de hoje) + índice; outputs dos 3 templates IA de 1 para 4.
-- Sem templates.preview_credits: prévias grátis (P3). Aplicar só com backup antes; nesta fatia, só nos bancos locais do worktree.

-- CreateEnum
CREATE TYPE "AiPreviewStatus" AS ENUM ('PLANNED', 'IMAGING', 'READY', 'FAILED', 'APPROVED');

-- AlterTable
ALTER TABLE "variation_items" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "preview_regens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "preview_retries" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "preview_status" "AiPreviewStatus";

-- CreateIndex
CREATE INDEX "variation_items_batch_id_preview_status_idx" ON "variation_items"("batch_id", "preview_status");

-- Seed: card "até 4 vídeos"
UPDATE "templates" SET "outputs" = 4, "out_en" = 'Up to 4 videos · 9:16', "out_pt" = 'Até 4 vídeos · 9:16', "updated_at" = NOW()
WHERE "internal_key" IN ('AI_VIDEO:F04', 'AI_VIDEO:F09', 'AI_VIDEO:F10');
