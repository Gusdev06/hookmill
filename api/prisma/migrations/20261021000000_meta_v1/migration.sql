-- meta-v1.md §1 (aprovado pelo Gusta em 21/10): conexão Meta por workspace, snapshots de anúncios, publicações. Aditiva.

-- CreateEnum
CREATE TYPE "MetaConnectionStatus" AS ENUM ('ACTIVE', 'TOKEN_INVALID', 'DISCONNECTED');
CREATE TYPE "MetaTokenType" AS ENUM ('USER_LONG_LIVED', 'SYSTEM_USER');
CREATE TYPE "MetaAdVerdict" AS ENUM ('WINNER', 'OK', 'LOW_DATA');
CREATE TYPE "MetaAdTrend" AS ENUM ('WORKING', 'STEADY', 'TIRING');
CREATE TYPE "MetaPublicationStatus" AS ENUM ('PUBLISHING', 'PAUSED', 'ACTIVE', 'FAILED', 'DELETED');

-- AlterEnum (Postgres 17: vários valores na mesma migração é ok)
ALTER TYPE "JobType" ADD VALUE 'META_SYNC';
ALTER TYPE "JobType" ADD VALUE 'META_IMPORT';
ALTER TYPE "JobType" ADD VALUE 'META_PUBLISH';

-- AlterTable (D13: campeão vindo do "Pick from Meta")
ALTER TABLE "champions" ADD COLUMN     "meta_ad_account_id" TEXT,
ADD COLUMN     "meta_ad_id" TEXT;

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "meta_publication_id" TEXT;

-- CreateTable (D2: 1 por workspace; token cifrado, nunca sai da API)
CREATE TABLE "meta_connections" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "status" "MetaConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "token_type" "MetaTokenType" NOT NULL DEFAULT 'USER_LONG_LIVED',
    "token_ciphertext" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "meta_user_id" TEXT NOT NULL,
    "meta_user_name" TEXT NOT NULL,
    "ad_account_id" TEXT,
    "ad_account_name" TEXT,
    "currency" TEXT,
    "timezone_name" TEXT,
    "account_status" INTEGER,
    "business_id" TEXT,
    "page_id" TEXT,
    "page_name" TEXT,
    "pixel_id" TEXT,
    "pixel_name" TEXT,
    "last_health" JSONB,
    "last_health_at" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),
    "last_sync_job_id" TEXT,
    "last_sync_error" TEXT,
    "connected_by_id" TEXT NOT NULL,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable (substituída inteira a cada META_SYNC)
CREATE TABLE "meta_ad_snapshots" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "ad_account_id" TEXT NOT NULL,
    "meta_ad_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "effective_status" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "campaign_name" TEXT NOT NULL,
    "adset_id" TEXT NOT NULL,
    "adset_name" TEXT NOT NULL,
    "meta_creative_id" TEXT,
    "video_id" TEXT,
    "thumbnail_url" TEXT,
    "result_type" TEXT,
    "metrics" JSONB NOT NULL,
    "metrics_7d" JSONB NOT NULL,
    "metrics_prev_7d" JSONB NOT NULL,
    "verdict" "MetaAdVerdict" NOT NULL DEFAULT 'LOW_DATA',
    "trend" "MetaAdTrend",
    "ad_created_time" TIMESTAMP(3),
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_ad_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable (D7: ids da Meta por etapa; retry retoma sem duplicar)
CREATE TABLE "meta_publications" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "creative_id" TEXT NOT NULL,
    "status" "MetaPublicationStatus" NOT NULL DEFAULT 'PUBLISHING',
    "ad_account_id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "pixel_id" TEXT,
    "settings" JSONB NOT NULL,
    "render_file_id" TEXT NOT NULL,
    "video_id" TEXT,
    "meta_creative_id" TEXT,
    "campaign_id" TEXT,
    "adset_id" TEXT,
    "meta_ad_id" TEXT,
    "preview_url" TEXT,
    "error_code" TEXT,
    "fail_reason" TEXT,
    "fail_detail" TEXT,
    "failed_stage" TEXT,
    "job_id" TEXT,
    "published_at" TIMESTAMP(3),
    "activated_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_publications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meta_connections_workspace_id_key" ON "meta_connections"("workspace_id");
CREATE INDEX "meta_ad_snapshots_workspace_id_verdict_idx" ON "meta_ad_snapshots"("workspace_id", "verdict");
CREATE UNIQUE INDEX "meta_ad_snapshots_connection_id_meta_ad_id_key" ON "meta_ad_snapshots"("connection_id", "meta_ad_id");
CREATE INDEX "meta_publications_creative_id_created_at_idx" ON "meta_publications"("creative_id", "created_at");
CREATE INDEX "meta_publications_workspace_id_status_idx" ON "meta_publications"("workspace_id", "status");
CREATE INDEX "champions_workspace_id_meta_ad_id_idx" ON "champions"("workspace_id", "meta_ad_id");

-- AddForeignKey
ALTER TABLE "meta_connections" ADD CONSTRAINT "meta_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meta_connections" ADD CONSTRAINT "meta_connections_connected_by_id_fkey" FOREIGN KEY ("connected_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "meta_ad_snapshots" ADD CONSTRAINT "meta_ad_snapshots_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meta_ad_snapshots" ADD CONSTRAINT "meta_ad_snapshots_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "meta_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meta_publications" ADD CONSTRAINT "meta_publications_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meta_publications" ADD CONSTRAINT "meta_publications_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "meta_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "meta_publications" ADD CONSTRAINT "meta_publications_creative_id_fkey" FOREIGN KEY ("creative_id") REFERENCES "creatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meta_publications" ADD CONSTRAINT "meta_publications_render_file_id_fkey" FOREIGN KEY ("render_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "meta_publications" ADD CONSTRAINT "meta_publications_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
