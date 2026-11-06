-- troca-texto-queimado-v1 §15.8 e §16.6 (F0b, 06/11): aditiva. Placa do campeão: tabela champion_plates, enums PlateKind e PlateStatus,
-- FileKind + CHAMPION_PLATE, JobType + CHAMPION_PLATE. Gerada offline pelo prisma migrate diff, entre schemas, sem conectar em banco.
-- NÃO APLICADA em nenhum banco ao ser escrita. O bloco correspondente do schema.prisma está em modelo-de-dados.md e entra na fase A0.
-- CreateEnum
CREATE TYPE "PlateKind" AS ENUM ('HEADLINE', 'CAPTION');

-- CreateEnum
CREATE TYPE "PlateStatus" AS ENUM ('QUEUED', 'RUNNING', 'READY', 'REJECTED', 'FAILED');

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'CHAMPION_PLATE';

-- AlterEnum
ALTER TYPE "FileKind" ADD VALUE 'CHAMPION_PLATE';

-- CreateTable
CREATE TABLE "champion_plates" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "champion_id" TEXT NOT NULL,
    "kind" "PlateKind" NOT NULL,
    "layer_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "PlateStatus" NOT NULL DEFAULT 'QUEUED',
    "file_id" TEXT,
    "reason" TEXT,
    "metrics" JSONB,
    "cost_usd" DECIMAL(10,6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "champion_plates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "champion_plates_workspace_id_idx" ON "champion_plates"("workspace_id");

-- CreateIndex
CREATE INDEX "champion_plates_file_id_idx" ON "champion_plates"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "champion_plates_champion_id_kind_layer_key_version_key" ON "champion_plates"("champion_id", "kind", "layer_key", "version");

-- AddForeignKey
ALTER TABLE "champion_plates" ADD CONSTRAINT "champion_plates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "champion_plates" ADD CONSTRAINT "champion_plates_champion_id_fkey" FOREIGN KEY ("champion_id") REFERENCES "champions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "champion_plates" ADD CONSTRAINT "champion_plates_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

