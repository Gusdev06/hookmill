-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "UiLocale" AS ENUM ('EN', 'PT_BR');

-- CreateEnum
CREATE TYPE "CreativeState" AS ENUM ('SCRIPTS_WRITING', 'SCRIPTS_READY', 'SCRIPTS_FAILED', 'AVATAR_PENDING', 'FACES_GENERATING', 'FACES_READY', 'FACES_FAILED', 'ENGINE_PENDING', 'SCENES_GENERATING', 'SCENES_FAILED', 'EDIT_PENDING', 'RENDERING', 'RENDER_FAILED', 'RENDER_READY', 'APPROVED');

-- CreateEnum
CREATE TYPE "Engine" AS ENUM ('SCENES', 'LIPSYNC');

-- CreateEnum
CREATE TYPE "VideoFormat" AS ENUM ('VERTICAL_9_16', 'PORTRAIT_4_5', 'SQUARE_1_1');

-- CreateEnum
CREATE TYPE "ScriptStatus" AS ENUM ('WRITING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('QUEUED', 'GENERATING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('OFFER_EXTRACT', 'SCRIPTS_GENERATE', 'SCRIPT_REGENERATE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('ANTHROPIC', 'WAVESPEED');

-- CreateEnum
CREATE TYPE "ProviderTaskKind" AS ENUM ('FACE_IMAGE', 'SCENE_VIDEO', 'TTS', 'LIPSYNC', 'TRANSCRIBE');

-- CreateEnum
CREATE TYPE "ProviderTaskStatus" AS ENUM ('SUBMITTED', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "RenderStatus" AS ENUM ('QUEUED', 'RENDERING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('FACE_IMAGE', 'SCENE_CLIP', 'SCENE_AUDIO', 'RENDER_VIDEO', 'THUMBNAIL');

-- CreateEnum
CREATE TYPE "CostKind" AS ENUM ('LLM', 'IMAGE', 'VIDEO', 'TTS', 'LIPSYNC', 'TRANSCRIBE');

-- CreateEnum
CREATE TYPE "ChangeType" AS ENUM ('SCENE', 'TEXT', 'LINE', 'FACE');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ui_locale" "UiLocale" NOT NULL DEFAULT 'EN',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ui_locale" "UiLocale" NOT NULL DEFAULT 'EN',
    "monthly_spend_cap_usd" DECIMAL(12,4),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "source_url" TEXT,
    "kind" TEXT,
    "what" TEXT,
    "audience" TEXT,
    "promise" TEXT,
    "pains" TEXT,
    "proof" TEXT,
    "offer_and_price" TEXT,
    "cta" TEXT,
    "notes" TEXT,
    "field_sources" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" TEXT NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creatives" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "state" "CreativeState" NOT NULL DEFAULT 'SCRIPTS_WRITING',
    "state_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "selected_script_id" TEXT,
    "selected_face_id" TEXT,
    "face_description" TEXT,
    "engine" "Engine",
    "engine_model" TEXT,
    "voice_id" TEXT,
    "format" "VideoFormat" NOT NULL DEFAULT 'VERTICAL_9_16',
    "estimated_cost_usd" DECIMAL(12,4),
    "generated_at" TIMESTAMP(3),
    "edit_settings" JSONB NOT NULL DEFAULT '{}',
    "edit_dirty" BOOLEAN NOT NULL DEFAULT false,
    "final_render_id" TEXT,
    "thumbnail_file_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "is_winner" BOOLEAN NOT NULL DEFAULT false,
    "winner_marked_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scripts" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "creative_id" TEXT NOT NULL,
    "letter" TEXT NOT NULL,
    "status" "ScriptStatus" NOT NULL DEFAULT 'WRITING',
    "angle" TEXT,
    "rationale" TEXT,
    "duration_sec" DECIMAL(8,3),
    "blocks" JSONB NOT NULL DEFAULT '[]',
    "informed_by_creative_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "edited_by_user" BOOLEAN NOT NULL DEFAULT false,
    "fail_reason" TEXT,
    "job_id" TEXT,
    "discarded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faces" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "creative_id" TEXT NOT NULL,
    "batch" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'QUEUED',
    "file_id" TEXT,
    "fail_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenes" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "creative_id" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "start_sec" DECIMAL(8,3) NOT NULL,
    "end_sec" DECIMAL(8,3) NOT NULL,
    "speech" TEXT NOT NULL,
    "visual_prompt" TEXT NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "fail_reason" TEXT,
    "clip_file_id" TEXT,
    "audio_file_id" TEXT,
    "words" JSONB,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scenes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "renders" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "creative_id" TEXT NOT NULL,
    "status" "RenderStatus" NOT NULL DEFAULT 'QUEUED',
    "stage" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "frame" INTEGER,
    "total_frames" INTEGER,
    "settings" JSONB NOT NULL,
    "input" JSONB NOT NULL,
    "fail_reason" TEXT,
    "failed_frame" INTEGER,
    "file_id" TEXT,
    "duration_sec" DECIMAL(8,3),
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "renders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "kind" "FileKind" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "duration_sec" DECIMAL(8,3),
    "width" INTEGER,
    "height" INTEGER,
    "sha256" TEXT,
    "source_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "stage" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "eta_sec" INTEGER,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error_code" TEXT,
    "fail_reason" TEXT,
    "offer_id" TEXT,
    "creative_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_tasks" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL DEFAULT 'WAVESPEED',
    "kind" "ProviderTaskKind" NOT NULL,
    "model" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "status" "ProviderTaskStatus" NOT NULL DEFAULT 'SUBMITTED',
    "input" JSONB NOT NULL,
    "output_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "output" JSONB,
    "error_code" TEXT,
    "error_raw" TEXT,
    "estimated_usd" DECIMAL(12,4),
    "face_id" TEXT,
    "scene_id" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "handled_at" TIMESTAMP(3),
    "last_polled_at" TIMESTAMP(3),

    CONSTRAINT "provider_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_entries" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "creative_id" TEXT,
    "provider" "Provider" NOT NULL,
    "kind" "CostKind" NOT NULL,
    "model" TEXT NOT NULL,
    "units" DECIMAL(14,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "amount_usd" DECIMAL(12,4) NOT NULL,
    "provider_task_id" TEXT,
    "job_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_requests" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "creative_id" TEXT NOT NULL,
    "type" "ChangeType" NOT NULL,
    "scene_index" INTEGER,
    "new_speech" TEXT,
    "note" TEXT,
    "returned_to" "CreativeState" NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_workspace_id_user_id_key" ON "memberships"("workspace_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invites_token_hash_key" ON "invites"("token_hash");

-- CreateIndex
CREATE INDEX "invites_workspace_id_idx" ON "invites"("workspace_id");

-- CreateIndex
CREATE INDEX "offers_workspace_id_archived_at_idx" ON "offers"("workspace_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "creatives_selected_script_id_key" ON "creatives"("selected_script_id");

-- CreateIndex
CREATE UNIQUE INDEX "creatives_final_render_id_key" ON "creatives"("final_render_id");

-- CreateIndex
CREATE INDEX "creatives_workspace_id_archived_at_updated_at_idx" ON "creatives"("workspace_id", "archived_at", "updated_at");

-- CreateIndex
CREATE INDEX "creatives_workspace_id_state_idx" ON "creatives"("workspace_id", "state");

-- CreateIndex
CREATE INDEX "creatives_offer_id_is_winner_idx" ON "creatives"("offer_id", "is_winner");

-- CreateIndex
CREATE INDEX "scripts_creative_id_discarded_at_idx" ON "scripts"("creative_id", "discarded_at");

-- CreateIndex
CREATE UNIQUE INDEX "faces_file_id_key" ON "faces"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "faces_creative_id_batch_position_key" ON "faces"("creative_id", "batch", "position");

-- CreateIndex
CREATE INDEX "scenes_creative_id_stale_idx" ON "scenes"("creative_id", "stale");

-- CreateIndex
CREATE UNIQUE INDEX "scenes_creative_id_generation_index_key" ON "scenes"("creative_id", "generation", "index");

-- CreateIndex
CREATE UNIQUE INDEX "renders_file_id_key" ON "renders"("file_id");

-- CreateIndex
CREATE INDEX "renders_creative_id_created_at_idx" ON "renders"("creative_id", "created_at");

-- CreateIndex
CREATE INDEX "renders_status_created_at_idx" ON "renders"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "files_storage_key_key" ON "files"("storage_key");

-- CreateIndex
CREATE INDEX "files_workspace_id_kind_idx" ON "files"("workspace_id", "kind");

-- CreateIndex
CREATE INDEX "jobs_workspace_id_created_at_idx" ON "jobs"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "jobs_status_idx" ON "jobs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "provider_tasks_external_id_key" ON "provider_tasks"("external_id");

-- CreateIndex
CREATE INDEX "provider_tasks_status_submitted_at_idx" ON "provider_tasks"("status", "submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "cost_entries_provider_task_id_key" ON "cost_entries"("provider_task_id");

-- CreateIndex
CREATE INDEX "cost_entries_workspace_id_created_at_idx" ON "cost_entries"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "cost_entries_creative_id_idx" ON "cost_entries"("creative_id");

-- CreateIndex
CREATE INDEX "change_requests_creative_id_idx" ON "change_requests"("creative_id");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_selected_script_id_fkey" FOREIGN KEY ("selected_script_id") REFERENCES "scripts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_selected_face_id_fkey" FOREIGN KEY ("selected_face_id") REFERENCES "faces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_final_render_id_fkey" FOREIGN KEY ("final_render_id") REFERENCES "renders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_thumbnail_file_id_fkey" FOREIGN KEY ("thumbnail_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_creative_id_fkey" FOREIGN KEY ("creative_id") REFERENCES "creatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faces" ADD CONSTRAINT "faces_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faces" ADD CONSTRAINT "faces_creative_id_fkey" FOREIGN KEY ("creative_id") REFERENCES "creatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faces" ADD CONSTRAINT "faces_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_creative_id_fkey" FOREIGN KEY ("creative_id") REFERENCES "creatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_clip_file_id_fkey" FOREIGN KEY ("clip_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_audio_file_id_fkey" FOREIGN KEY ("audio_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renders" ADD CONSTRAINT "renders_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renders" ADD CONSTRAINT "renders_creative_id_fkey" FOREIGN KEY ("creative_id") REFERENCES "creatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renders" ADD CONSTRAINT "renders_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_creative_id_fkey" FOREIGN KEY ("creative_id") REFERENCES "creatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_tasks" ADD CONSTRAINT "provider_tasks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_tasks" ADD CONSTRAINT "provider_tasks_face_id_fkey" FOREIGN KEY ("face_id") REFERENCES "faces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_tasks" ADD CONSTRAINT "provider_tasks_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "scenes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_creative_id_fkey" FOREIGN KEY ("creative_id") REFERENCES "creatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_provider_task_id_fkey" FOREIGN KEY ("provider_task_id") REFERENCES "provider_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_creative_id_fkey" FOREIGN KEY ("creative_id") REFERENCES "creatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

