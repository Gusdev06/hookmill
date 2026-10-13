-- docs/contratos/editor-v1.md §4 (09/10): editor no vídeo v1. Dono: maquina-arquiteto.
-- Só aditiva (colunas nulas ou com default): segura com a API rodando no client Prisma antigo.
-- AlterTable
ALTER TABLE "creatives" ADD COLUMN     "edit_doc" JSONB,
ADD COLUMN     "edit_revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "remix_base" JSONB;

-- AlterTable
ALTER TABLE "renders" ADD COLUMN     "doc" JSONB,
ADD COLUMN     "edit_revision" INTEGER;

