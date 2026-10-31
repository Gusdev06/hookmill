-- 29/10/2026: amostra grátis (amostra-gratis-v1) + templates de publicação no Meta (meta-templates-v1). Aditiva.
-- Quem já existe vira INTERNAL (nada muda pra quem já usa); conta nova nasce SAMPLE.
-- CreateEnum
CREATE TYPE "AccountAccess" AS ENUM ('SAMPLE', 'PAID', 'INTERNAL');

-- CreateEnum
CREATE TYPE "MetaTemplateSource" AS ENUM ('MANUAL', 'IMPORTED');

-- AlterTable
ALTER TABLE "meta_publications" ADD COLUMN     "group_key" TEXT,
ADD COLUMN     "template_id" TEXT;

-- AlterTable
ALTER TABLE "renders" ADD COLUMN     "preview_file_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "access" "AccountAccess" NOT NULL DEFAULT 'SAMPLE',
ADD COLUMN     "sample_used_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "meta_publish_templates" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "ad_account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "source" "MetaTemplateSource" NOT NULL DEFAULT 'MANUAL',
    "imported_from" JSONB,
    "campaign" JSONB NOT NULL,
    "adset" JSONB NOT NULL,
    "ad" JSONB NOT NULL,
    "reuse_campaign_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "meta_publish_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meta_publish_templates_workspace_id_ad_account_id_archived__idx" ON "meta_publish_templates"("workspace_id", "ad_account_id", "archived_at");

-- CreateIndex
CREATE INDEX "meta_publications_group_key_idx" ON "meta_publications"("group_key");

-- CreateIndex
CREATE UNIQUE INDEX "renders_preview_file_id_key" ON "renders"("preview_file_id");

-- AddForeignKey
ALTER TABLE "renders" ADD CONSTRAINT "renders_preview_file_id_fkey" FOREIGN KEY ("preview_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_publications" ADD CONSTRAINT "meta_publications_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "meta_publish_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_publish_templates" ADD CONSTRAINT "meta_publish_templates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_publish_templates" ADD CONSTRAINT "meta_publish_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill (§1): usuários anteriores à amostra nunca travam
UPDATE "users" SET "access" = 'INTERNAL';
