-- resultado-v1 (28/10/2026, teste manual A3): "What counts as a result?" substitui o BusinessType. Aditiva.
-- business_type fica (derivado do result_type, gravado pela API) por 1 versão; sai numa migração própria depois do deploy.

-- CreateEnum
CREATE TYPE "ResultType" AS ENUM ('PURCHASE', 'LEAD', 'MESSAGE', 'APPOINTMENT', 'SIGNUP', 'SUBSCRIPTION', 'APP_INSTALL', 'OTHER');

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "result_type" "ResultType",
ADD COLUMN     "result_type_other" TEXT;

-- Backfill: ONLINE_STORE → PURCHASE, LOCAL_BUSINESS → LEAD, APP → APP_INSTALL
UPDATE "workspaces" SET "result_type" = CASE "business_type"
  WHEN 'ONLINE_STORE' THEN 'PURCHASE'::"ResultType"
  WHEN 'LOCAL_BUSINESS' THEN 'LEAD'::"ResultType"
  WHEN 'APP' THEN 'APP_INSTALL'::"ResultType"
END
WHERE "business_type" IS NOT NULL;
