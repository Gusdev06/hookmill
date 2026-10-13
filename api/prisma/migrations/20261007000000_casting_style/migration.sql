-- §13.13 de docs/contratos/feature-2-variar-campeao.md (07/10): elenco diverso por padrão nas variações. Dono: maquina-arquiteto.
-- CreateEnum
CREATE TYPE "CastingStyle" AS ENUM ('DIVERSE', 'MATCH_ORIGINAL');

-- AlterTable: lotes que já existem foram planejados pelo perfil do original; os novos nascem DIVERSE.
ALTER TABLE "variation_batches" ADD COLUMN "casting_style" "CastingStyle" NOT NULL DEFAULT 'MATCH_ORIGINAL';
ALTER TABLE "variation_batches" ALTER COLUMN "casting_style" SET DEFAULT 'DIVERSE';
