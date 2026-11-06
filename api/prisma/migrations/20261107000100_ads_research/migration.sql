-- ads-research-v1 (Ad Radar), Construção 04/11. Dono: maquina-arquiteto. ADITIVA: só CREATE TYPE/TABLE/INDEX e colunas opcionais
-- (champions.research_ad_id, cost_entries.research_sync_id/discovery_id). Nenhum DROP, nenhum dado mexido.
-- CreateEnum
CREATE TYPE "AdSourceStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "ResearchTrigger" AS ENUM ('INITIAL', 'SCHEDULED', 'MANUAL', 'MEDIA', 'DISCOVERY');

-- CreateEnum
CREATE TYPE "ResearchSyncStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'SUSPECT', 'FAILED');

-- CreateEnum
CREATE TYPE "ResearchScrapeKind" AS ENUM ('PAGE', 'KEYWORD');

-- CreateEnum
CREATE TYPE "LibraryAdFormat" AS ENUM ('VIDEO', 'IMAGE', 'CAROUSEL', 'DCO', 'DPA', 'OTHER');

-- CreateEnum
CREATE TYPE "CompetitorStatus" AS ENUM ('ACTIVE', 'DISMISSED', 'RETIRED');

-- CreateEnum
CREATE TYPE "CompetitorOrigin" AS ENUM ('DISCOVERED', 'MANUAL');

-- CreateEnum
CREATE TYPE "CompetitorRelation" AS ENUM ('DIRECT', 'ADJACENT');

-- CreateEnum
CREATE TYPE "DismissReason" AS ENUM ('not_competitor', 'not_relevant', 'own_brand', 'other');

-- CreateEnum
CREATE TYPE "DiscoveryTrigger" AS ENUM ('ONBOARDING', 'BRAIN_CHANGED', 'MANUAL');

-- CreateEnum
CREATE TYPE "DiscoveryStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'EMPTY', 'FAILED');

-- CreateEnum
CREATE TYPE "CandidateOrigin" AS ENUM ('LLM', 'KEYWORD', 'BOTH', 'MEMORY');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('FOLLOWED', 'RESERVE', 'REJECTED_NICHE', 'NOT_FOUND', 'TOO_FEW_ADS', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ResearchTermKind" AS ENUM ('PROMISE', 'PRODUCT', 'PAIN');

-- CreateEnum
CREATE TYPE "ResearchTermOrigin" AS ENUM ('NEW', 'REUSED');

-- CreateEnum
CREATE TYPE "ResearchTermOutcome" AS ENUM ('SEARCHED', 'EMPTY', 'DIFFUSE', 'UNUSED');

-- AlterTable
ALTER TABLE "champions" ADD COLUMN     "research_ad_id" TEXT;

-- AlterTable
ALTER TABLE "cost_entries" ADD COLUMN     "discovery_id" TEXT,
ADD COLUMN     "research_sync_id" TEXT;

-- CreateTable
CREATE TABLE "ad_sources" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "avatar_key" TEXT,
    "like_count" INTEGER,
    "status" "AdSourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_sync_at" TIMESTAMP(3),
    "last_valid_sync_at" TIMESTAMP(3),
    "next_sync_at" TIMESTAMP(3),
    "last_active_count" INTEGER NOT NULL DEFAULT 0,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_ads" (
    "id" TEXT NOT NULL,
    "ad_archive_id" TEXT NOT NULL,
    "page_id" TEXT,
    "page_name" TEXT NOT NULL,
    "format" "LibraryAdFormat" NOT NULL,
    "has_video" BOOLEAN NOT NULL,
    "primary_text" TEXT,
    "headline" TEXT,
    "cta_text" TEXT,
    "link_url" TEXT,
    "link_host" TEXT,
    "cards" JSONB,
    "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "start_date" DATE,
    "end_date" DATE,
    "is_active" BOOLEAN NOT NULL,
    "stopped_at" DATE,
    "collation_count" INTEGER,
    "eu_reach" INTEGER,
    "low_impressions" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT,
    "poster_key" TEXT,
    "video_key" TEXT,
    "video_source_url" TEXT,
    "media_expires_at" TIMESTAMP(3),
    "width" INTEGER,
    "height" INTEGER,
    "duration_sec" DECIMAL(8,3),
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_source_ads" (
    "source_id" TEXT NOT NULL,
    "ad_id" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_source_ads_pkey" PRIMARY KEY ("source_id","ad_id")
);

-- CreateTable
CREATE TABLE "competitor_discoveries" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "trigger" "DiscoveryTrigger" NOT NULL,
    "status" "DiscoveryStatus" NOT NULL DEFAULT 'QUEUED',
    "stage" TEXT,
    "input_hash" TEXT NOT NULL,
    "country_code" TEXT,
    "country_reason" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "candidates_found" INTEGER NOT NULL DEFAULT 0,
    "followed" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "not_before" TIMESTAMP(3),
    "error_code" TEXT,
    "fail_reason" TEXT,
    "requested_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "competitor_discoveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitor_candidates" (
    "id" TEXT NOT NULL,
    "discovery_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "source_id" TEXT,
    "term_id" TEXT,
    "brand_name" TEXT,
    "domain" TEXT,
    "page_id" TEXT,
    "page_name" TEXT,
    "origin" "CandidateOrigin" NOT NULL,
    "status" "CandidateStatus" NOT NULL,
    "relation" "CompetitorRelation",
    "rank" INTEGER,
    "active_ads_seen" INTEGER NOT NULL DEFAULT 0,
    "oldest_days" INTEGER,
    "niche_score" INTEGER,
    "suspect_disposable" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competitor_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_terms" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "discovery_id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "kind" "ResearchTermKind" NOT NULL,
    "origin" "ResearchTermOrigin" NOT NULL DEFAULT 'NEW',
    "outcome" "ResearchTermOutcome" NOT NULL,
    "pages_found" INTEGER NOT NULL DEFAULT 0,
    "pages_multi_ad" INTEGER NOT NULL DEFAULT 0,
    "approved_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitors" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "origin" "CompetitorOrigin" NOT NULL,
    "relation" "CompetitorRelation" NOT NULL DEFAULT 'DIRECT',
    "niche_score" INTEGER,
    "discovery_id" TEXT,
    "reason" TEXT,
    "status" "CompetitorStatus" NOT NULL DEFAULT 'ACTIVE',
    "domain" TEXT,
    "dismissed_at" TIMESTAMP(3),
    "dismissed_by_id" TEXT,
    "dismiss_reason" "DismissReason",
    "retired_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_syncs" (
    "id" TEXT NOT NULL,
    "source_id" TEXT,
    "kind" "ResearchScrapeKind" NOT NULL,
    "query" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "trigger" "ResearchTrigger" NOT NULL,
    "status" "ResearchSyncStatus" NOT NULL DEFAULT 'QUEUED',
    "requested_by_workspace_id" TEXT,
    "requested_by_id" TEXT,
    "discovery_id" TEXT,
    "target_ad_id" TEXT,
    "apify_run_id" TEXT,
    "requested_limit" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "items_raw" INTEGER NOT NULL DEFAULT 0,
    "items_error" INTEGER NOT NULL DEFAULT 0,
    "ads_active" INTEGER NOT NULL DEFAULT 0,
    "ads_new" INTEGER NOT NULL DEFAULT 0,
    "ads_stopped" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "not_before" TIMESTAMP(3),
    "error_code" TEXT,
    "fail_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "research_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_ads" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "ad_id" TEXT NOT NULL,
    "saved_by_id" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_ads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ad_sources_status_next_sync_at_idx" ON "ad_sources"("status", "next_sync_at");

-- CreateIndex
CREATE UNIQUE INDEX "ad_sources_page_id_country_code_key" ON "ad_sources"("page_id", "country_code");

-- CreateIndex
CREATE UNIQUE INDEX "library_ads_ad_archive_id_key" ON "library_ads"("ad_archive_id");

-- CreateIndex
CREATE INDEX "library_ads_page_id_idx" ON "library_ads"("page_id");

-- CreateIndex
CREATE INDEX "library_ads_is_active_start_date_idx" ON "library_ads"("is_active", "start_date");

-- CreateIndex
CREATE INDEX "library_ads_last_seen_at_idx" ON "library_ads"("last_seen_at");

-- CreateIndex
CREATE INDEX "ad_source_ads_ad_id_idx" ON "ad_source_ads"("ad_id");

-- CreateIndex
CREATE INDEX "competitor_discoveries_workspace_id_created_at_idx" ON "competitor_discoveries"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "competitor_discoveries_status_not_before_idx" ON "competitor_discoveries"("status", "not_before");

-- CreateIndex
CREATE INDEX "competitor_candidates_workspace_id_status_rank_idx" ON "competitor_candidates"("workspace_id", "status", "rank");

-- CreateIndex
CREATE INDEX "competitor_candidates_workspace_id_page_id_idx" ON "competitor_candidates"("workspace_id", "page_id");

-- CreateIndex
CREATE INDEX "competitor_candidates_discovery_id_idx" ON "competitor_candidates"("discovery_id");

-- CreateIndex
CREATE INDEX "research_terms_workspace_id_approved_count_idx" ON "research_terms"("workspace_id", "approved_count");

-- CreateIndex
CREATE INDEX "research_terms_discovery_id_idx" ON "research_terms"("discovery_id");

-- CreateIndex
CREATE INDEX "competitors_workspace_id_status_idx" ON "competitors"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "competitors_source_id_status_idx" ON "competitors"("source_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "competitors_workspace_id_source_id_key" ON "competitors"("workspace_id", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "research_syncs_apify_run_id_key" ON "research_syncs"("apify_run_id");

-- CreateIndex
CREATE INDEX "research_syncs_source_id_created_at_idx" ON "research_syncs"("source_id", "created_at");

-- CreateIndex
CREATE INDEX "research_syncs_status_not_before_idx" ON "research_syncs"("status", "not_before");

-- CreateIndex
CREATE INDEX "research_syncs_discovery_id_idx" ON "research_syncs"("discovery_id");

-- CreateIndex
CREATE INDEX "research_syncs_target_ad_id_status_idx" ON "research_syncs"("target_ad_id", "status");

-- CreateIndex
CREATE INDEX "research_syncs_created_at_idx" ON "research_syncs"("created_at");

-- CreateIndex
CREATE INDEX "saved_ads_workspace_id_created_at_idx" ON "saved_ads"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "saved_ads_workspace_id_ad_id_key" ON "saved_ads"("workspace_id", "ad_id");

-- CreateIndex
CREATE UNIQUE INDEX "champions_workspace_id_research_ad_id_key" ON "champions"("workspace_id", "research_ad_id");

-- CreateIndex
CREATE INDEX "cost_entries_research_sync_id_idx" ON "cost_entries"("research_sync_id");

-- CreateIndex
CREATE INDEX "cost_entries_discovery_id_idx" ON "cost_entries"("discovery_id");

-- AddForeignKey
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_research_sync_id_fkey" FOREIGN KEY ("research_sync_id") REFERENCES "research_syncs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_discovery_id_fkey" FOREIGN KEY ("discovery_id") REFERENCES "competitor_discoveries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "champions" ADD CONSTRAINT "champions_research_ad_id_fkey" FOREIGN KEY ("research_ad_id") REFERENCES "library_ads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_source_ads" ADD CONSTRAINT "ad_source_ads_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "ad_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_source_ads" ADD CONSTRAINT "ad_source_ads_ad_id_fkey" FOREIGN KEY ("ad_id") REFERENCES "library_ads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_discoveries" ADD CONSTRAINT "competitor_discoveries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_candidates" ADD CONSTRAINT "competitor_candidates_discovery_id_fkey" FOREIGN KEY ("discovery_id") REFERENCES "competitor_discoveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_candidates" ADD CONSTRAINT "competitor_candidates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_candidates" ADD CONSTRAINT "competitor_candidates_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "ad_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_candidates" ADD CONSTRAINT "competitor_candidates_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "research_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_terms" ADD CONSTRAINT "research_terms_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_terms" ADD CONSTRAINT "research_terms_discovery_id_fkey" FOREIGN KEY ("discovery_id") REFERENCES "competitor_discoveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "ad_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_discovery_id_fkey" FOREIGN KEY ("discovery_id") REFERENCES "competitor_discoveries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_syncs" ADD CONSTRAINT "research_syncs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "ad_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_syncs" ADD CONSTRAINT "research_syncs_discovery_id_fkey" FOREIGN KEY ("discovery_id") REFERENCES "competitor_discoveries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_syncs" ADD CONSTRAINT "research_syncs_target_ad_id_fkey" FOREIGN KEY ("target_ad_id") REFERENCES "library_ads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_ads" ADD CONSTRAINT "saved_ads_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_ads" ADD CONSTRAINT "saved_ads_ad_id_fkey" FOREIGN KEY ("ad_id") REFERENCES "library_ads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_ads" ADD CONSTRAINT "saved_ads_saved_by_id_fkey" FOREIGN KEY ("saved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

