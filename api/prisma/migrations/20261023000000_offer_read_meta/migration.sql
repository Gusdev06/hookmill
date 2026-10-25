-- briefing-leitura-v2.md §4.2 D5 (aprovado pelo Gusta em 22/10): "lido de" persistido na oferta. Aditiva, nullable, sem backfill
-- (ofertas de antes da v2 e criadas à mão ficam null; o web mostra o bloco só quando houver).

-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "read_meta" JSONB;
