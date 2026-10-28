ALTER TABLE "workspaces" ADD COLUMN "iterate_preferences" JSONB;
ALTER TABLE "variation_batches" ADD COLUMN "answers" JSONB,
  ADD COLUMN "answers_at" TIMESTAMP(3), ADD COLUMN "answers_by_id" TEXT;
ALTER TABLE "variation_items" ADD COLUMN "want_key" TEXT,
  ADD COLUMN "selection" TEXT, ADD COLUMN "priority" INTEGER;
ALTER TABLE "variation_batches" ADD CONSTRAINT "variation_batches_answers_by_id_fkey" FOREIGN KEY ("answers_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
