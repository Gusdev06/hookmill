-- 05/11/2026: meta-oferta-v1 §2.4. Link de destino do criativo no snapshot (reaproveitado entre syncs) e a correção
-- manual anúncio/campanha → oferta (meta_offer_links), que sobrevive ao sync porque usa os ids da Meta.
-- CreateEnum
CREATE TYPE "MetaOfferDecision" AS ENUM ('BELONGS', 'NOT_BELONGS');

-- AlterTable
ALTER TABLE "meta_ad_snapshots" ADD COLUMN     "destination_source" TEXT,
ADD COLUMN     "destination_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "url_tags" TEXT;

-- CreateTable
CREATE TABLE "meta_offer_links" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "ad_account_id" TEXT NOT NULL,
    "level" "MetaObjectLevel" NOT NULL,
    "object_id" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "decision" "MetaOfferDecision" NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_offer_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meta_offer_links_workspace_id_ad_account_id_idx" ON "meta_offer_links"("workspace_id", "ad_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "meta_offer_links_workspace_id_ad_account_id_level_object_id_key" ON "meta_offer_links"("workspace_id", "ad_account_id", "level", "object_id", "offer_id");

-- AddForeignKey
ALTER TABLE "meta_offer_links" ADD CONSTRAINT "meta_offer_links_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_offer_links" ADD CONSTRAINT "meta_offer_links_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_offer_links" ADD CONSTRAINT "meta_offer_links_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

