-- fase2-agencia.md §1 (aprovado 12/10): cliente = workspace, papel CLIENT, Creative.adName. Aditiva.

-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('ONLINE_STORE', 'LOCAL_BUSINESS', 'APP');

-- AlterEnum
ALTER TYPE "MemberRole" ADD VALUE 'CLIENT';

-- AlterTable
ALTER TABLE "creatives" ADD COLUMN     "ad_name" TEXT;

-- AlterTable (short_code nasce nullable pro backfill; NOT NULL no fim)
ALTER TABLE "workspaces" ADD COLUMN     "business_type" "BusinessType",
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "market" TEXT,
ADD COLUMN     "onboarding_completed_at" TIMESTAMP(3),
ADD COLUMN     "onboarding_step" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "paused_at" TIMESTAMP(3),
ADD COLUMN     "short_code" TEXT,
ADD COLUMN     "website_url" TEXT;

-- Backfill: os workspaces de hoje já operam (LIVE, nunca SETUP); short_code = 2 primeiras letras/dígitos do nome, senão 'WS'
UPDATE "workspaces" SET
  "onboarding_completed_at" = "created_at",
  "onboarding_step" = 6,
  "short_code" = CASE
    WHEN length(regexp_replace(upper("name"), '[^A-Z0-9]', '', 'g')) >= 2
      THEN left(regexp_replace(upper("name"), '[^A-Z0-9]', '', 'g'), 2)
    ELSE 'WS'
  END;

ALTER TABLE "workspaces" ALTER COLUMN "short_code" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "creatives_workspace_id_ad_name_key" ON "creatives"("workspace_id", "ad_name");
