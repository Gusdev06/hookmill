-- variacao-auto-v1.md, Revisão 23/10 (aprovada pelo Gusta 23/10): lote gera só o 9:16; 4:5 e 1:1 sob demanda com prioridade na fila;
-- STATIC criado do zero no GPT Image 2 (WaveSpeed), fora da fila do Remotion, ligado ao render pela provider_task. Aditiva.

-- CreateEnum
CREATE TYPE "RenderEngine" AS ENUM ('REMOTION', 'IMAGE_GEN');

-- AlterEnum
ALTER TYPE "ProviderTaskKind" ADD VALUE 'STATIC_IMAGE';

-- AlterTable
ALTER TABLE "provider_tasks" ADD COLUMN     "render_id" TEXT;

-- AlterTable
ALTER TABLE "renders" ADD COLUMN     "engine" "RenderEngine" NOT NULL DEFAULT 'REMOTION',
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "provider_tasks_render_id_idx" ON "provider_tasks"("render_id");

-- CreateIndex
CREATE INDEX "renders_status_engine_priority_created_at_idx" ON "renders"("status", "engine", "priority", "created_at");

-- AddForeignKey
ALTER TABLE "provider_tasks" ADD CONSTRAINT "provider_tasks_render_id_fkey" FOREIGN KEY ("render_id") REFERENCES "renders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

