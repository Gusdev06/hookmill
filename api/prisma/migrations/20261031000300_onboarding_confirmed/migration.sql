-- 31/10/2026: lacunas da Home v2 e do Eddy (docs/contratos/lacunas-home-eddy-v1.md §1). Aditiva: enum novo e 1 coluna.

-- CreateEnum
CREATE TYPE "OnboardingConfirm" AS ENUM ('business', 'offer', 'meta', 'goals', 'kit');

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "onboarding_confirmed" "OnboardingConfirm"[] DEFAULT ARRAY[]::"OnboardingConfirm"[];
