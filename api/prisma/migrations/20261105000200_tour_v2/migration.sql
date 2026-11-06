-- 04/11/2026: tour-v2 (docs/contratos/tour-v2.md). Aditiva: dicas vistas por membro, 4 marcos de ativação no workspace
-- e a tabela de eventos de produto (tour/dicas). Backfill dos marcos a partir do que já existe (só lotes AUTO).
-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "tour_tips_seen" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "first_batch_at" TIMESTAMP(3),
ADD COLUMN     "first_generate_at" TIMESTAMP(3),
ADD COLUMN     "first_ready_at" TIMESTAMP(3),
ADD COLUMN     "first_send_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "product_events" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "props" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_events_workspace_id_name_at_idx" ON "product_events"("workspace_id", "name", "at");

-- AddForeignKey
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill dos marcos (workspaces que já tinham feito a ação antes desta migração)
UPDATE "workspaces" w SET "first_batch_at" = x.at
  FROM (SELECT "workspace_id", MIN("created_at") AS at FROM "variation_batches" WHERE "mode" = 'AUTO' GROUP BY 1) x
  WHERE x."workspace_id" = w."id";
UPDATE "workspaces" w SET "first_generate_at" = x.at
  FROM (SELECT "workspace_id", MIN("launched_at") AS at FROM "variation_batches" WHERE "mode" = 'AUTO' AND "launched_at" IS NOT NULL GROUP BY 1) x
  WHERE x."workspace_id" = w."id";
UPDATE "workspaces" w SET "first_ready_at" = x.at
  FROM (SELECT "workspace_id", MIN("approved_at") AS at FROM "creatives" WHERE "variation_item_id" IS NOT NULL AND "approved_at" IS NOT NULL GROUP BY 1) x
  WHERE x."workspace_id" = w."id";
UPDATE "workspaces" w SET "first_send_at" = x.at
  FROM (SELECT "workspace_id", MIN("published_at") AS at FROM "meta_publications" WHERE "published_at" IS NOT NULL GROUP BY 1) x
  WHERE x."workspace_id" = w."id";
