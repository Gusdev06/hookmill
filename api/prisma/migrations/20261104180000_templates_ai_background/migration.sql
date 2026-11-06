ALTER TYPE "AutoVariationType" ADD VALUE IF NOT EXISTS 'AI_VIDEO';
ALTER TABLE "scenes" ADD COLUMN "voice_id" TEXT, ADD COLUMN "face_id" TEXT;

-- Sem preço comercial presumido. Disponíveis para a equipe; admin define preço/publicação.
INSERT INTO "templates" ("id", "slug", "internal_key", "auto_type", "tier", "outputs", "category", "name_en", "name_pt", "desc_en", "desc_pt", "out_en", "out_pt", "order", "status", "updated_at") VALUES
('tpl_ai_faq', 'ai-faq', 'AI_VIDEO:F04', 'AI_VIDEO', 'AI', 1, 'remix', 'FAQ with AI', 'FAQ com IA', 'Turn your winning ad into a presenter answering an objection.', 'Transforme seu campeão em um apresentador respondendo uma objeção.', '1 video · 9:16', '1 vídeo · 9:16', 203, 'DRAFT', NOW()),
('tpl_ai_solo', 'podcast-solo', 'AI_VIDEO:F09', 'AI_VIDEO', 'AI', 1, 'remix', 'Solo podcast', 'Podcast solo', 'Your winning message as a short podcast segment with an AI presenter.', 'A mensagem do seu campeão em um corte de podcast com apresentador de IA.', '1 video · 9:16', '1 vídeo · 9:16', 204, 'DRAFT', NOW()),
('tpl_ai_duo', 'podcast-conversation', 'AI_VIDEO:F10', 'AI_VIDEO', 'AI', 1, 'remix', 'Podcast conversation', 'Conversa de podcast', 'Two AI presenters discuss your offer, with distinct voices and alternating shots.', 'Dois apresentadores de IA conversam sobre sua oferta, com vozes próprias e cortes entre as falas.', '1 video · 9:16', '1 vídeo · 9:16', 205, 'DRAFT', NOW())
ON CONFLICT ("slug") DO NOTHING;
