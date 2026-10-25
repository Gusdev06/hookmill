-- campanhas-v1.md §2 (aprovado pelo Gusta em 22/10, D1-D12). Aditiva: snapshots de campanha/conjunto, auditoria MetaChange
-- e meta_ad_snapshots.status (status configurado do anúncio; default ACTIVE, o próximo META_SYNC grava o real).

-- CreateEnum
CREATE TYPE "MetaObjectLevel" AS ENUM ('CAMPAIGN', 'ADSET', 'AD');

-- CreateEnum
CREATE TYPE "MetaChangeField" AS ENUM ('STATUS', 'DAILY_BUDGET');

-- CreateEnum
CREATE TYPE "MetaChangeResult" AS ENUM ('APPLIED', 'FAILED');

-- CreateEnum
CREATE TYPE "MetaChangeSource" AS ENUM ('CAMPAIGNS', 'PUBLISH');

-- AlterTable
ALTER TABLE "meta_ad_snapshots" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "meta_campaign_snapshots" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "ad_account_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "effective_status" TEXT NOT NULL,
    "buying_type" TEXT,
    "bid_strategy" TEXT,
    "daily_budget_minor" INTEGER,
    "lifetime_budget_minor" INTEGER,
    "budget_remaining_minor" INTEGER,
    "special_ad_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "start_time" TIMESTAMP(3),
    "stop_time" TIMESTAMP(3),
    "created_time" TIMESTAMP(3),
    "metrics" JSONB NOT NULL,
    "metrics_7d" JSONB NOT NULL,
    "metrics_prev_7d" JSONB NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_campaign_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_adset_snapshots" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "ad_account_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "adset_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "effective_status" TEXT NOT NULL,
    "optimization_goal" TEXT,
    "billing_event" TEXT,
    "bid_strategy" TEXT,
    "daily_budget_minor" INTEGER,
    "lifetime_budget_minor" INTEGER,
    "budget_remaining_minor" INTEGER,
    "learning_stage" TEXT,
    "start_time" TIMESTAMP(3),
    "end_time" TIMESTAMP(3),
    "created_time" TIMESTAMP(3),
    "metrics" JSONB NOT NULL,
    "metrics_7d" JSONB NOT NULL,
    "metrics_prev_7d" JSONB NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_adset_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_changes" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "ad_account_id" TEXT NOT NULL,
    "level" "MetaObjectLevel" NOT NULL,
    "object_id" TEXT NOT NULL,
    "object_name" TEXT NOT NULL,
    "field" "MetaChangeField" NOT NULL,
    "from_value" TEXT,
    "to_value" TEXT NOT NULL,
    "also_changed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "result" "MetaChangeResult" NOT NULL,
    "error_code" TEXT,
    "fail_detail" TEXT,
    "source" "MetaChangeSource" NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meta_campaign_snapshots_workspace_id_effective_status_idx" ON "meta_campaign_snapshots"("workspace_id", "effective_status");

-- CreateIndex
CREATE UNIQUE INDEX "meta_campaign_snapshots_connection_id_campaign_id_key" ON "meta_campaign_snapshots"("connection_id", "campaign_id");

-- CreateIndex
CREATE INDEX "meta_adset_snapshots_connection_id_campaign_id_idx" ON "meta_adset_snapshots"("connection_id", "campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "meta_adset_snapshots_connection_id_adset_id_key" ON "meta_adset_snapshots"("connection_id", "adset_id");

-- CreateIndex
CREATE INDEX "meta_changes_workspace_id_created_at_idx" ON "meta_changes"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "meta_changes_object_id_created_at_idx" ON "meta_changes"("object_id", "created_at");

-- AddForeignKey
ALTER TABLE "meta_campaign_snapshots" ADD CONSTRAINT "meta_campaign_snapshots_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_campaign_snapshots" ADD CONSTRAINT "meta_campaign_snapshots_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "meta_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_adset_snapshots" ADD CONSTRAINT "meta_adset_snapshots_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_adset_snapshots" ADD CONSTRAINT "meta_adset_snapshots_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "meta_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_changes" ADD CONSTRAINT "meta_changes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_changes" ADD CONSTRAINT "meta_changes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

