-- estatico-montado-e-molduras-v1.md (aprovado pelo Gusta 25/10): tipo FRAME (molduras do pack) na variação AUTO e
-- cor da marca do workspace (D3). Aditiva, sem backfill.

-- AlterEnum
ALTER TYPE "AutoVariationType" ADD VALUE 'FRAME';

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "brand_color" TEXT;
