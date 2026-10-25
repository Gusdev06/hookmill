-- onboarding-v2.md §1 (aprovado pelo Gusta em 21/10): accountMode, tour por membership, quem mexeu no setup. Aditiva, com backfill.

-- CreateEnum
CREATE TYPE "AccountMode" AS ENUM ('AGENCY', 'OWN');

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "tour_completed_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN     "account_mode" "AccountMode";
ALTER TABLE "workspaces" ADD COLUMN     "onboarding_updated_at" TIMESTAMP(3),
ADD COLUMN     "onboarding_updated_by_id" TEXT;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_onboarding_updated_by_id_fkey" FOREIGN KEY ("onboarding_updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill (D2): quem já tem conta é agência; a pergunta /start só aparece pra conta nova (account_mode null).
UPDATE "users" SET "account_mode" = 'AGENCY' WHERE "account_mode" IS NULL;

-- Backfill (D4): quem já usa não é preso no tour; conta e membro novos nascem com null e fazem o tour na 1ª entrada.
UPDATE "memberships" SET "tour_completed_at" = "created_at" WHERE "tour_completed_at" IS NULL;

-- onboarding_updated_by_id fica null (os workspaces de hoje já estão LIVE; a tela "Setup in progress" não aparece).
