-- campanhas-v1.md §11 (23/10, decisão do arquiteto sobre o QA): META_POLICY barrado pela trava do HookMill entra no History
-- como BLOCKED (nenhuma escrita na Meta). Aditiva: só um valor novo no enum.

-- AlterEnum
ALTER TYPE "MetaChangeResult" ADD VALUE 'BLOCKED';
