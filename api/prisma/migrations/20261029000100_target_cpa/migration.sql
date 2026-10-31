-- 29/10/2026 (Loom do Tordan): faixa de CPA alvo do cliente, coletada no onboarding e usada pelo Brain/IA. Aditiva.

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "target_cpa_currency" TEXT,
ADD COLUMN     "target_cpa_max" DECIMAL(12,2),
ADD COLUMN     "target_cpa_min" DECIMAL(12,2);
