-- 04/11/2026: templates-multi-v1 §2 (M7). Linha de SISTEMA do catálogo: âncora do TemplateRun dos lotes de "vários templates"
-- marcados pela pessoa (slug 'selection', internalKey 'SELECTION'). HIDDEN e sem preço: nunca aparece na galeria, o admin não
-- lista nem edita, `POST /ad-templates/selection/use` = 404 (catalogo.ts `isSelectionRow`). O `uses` dela conta os lotes de
-- seleção. Só dados, sem mudança de schema; idempotente.
INSERT INTO "templates" ("id", "slug", "internal_key", "auto_type", "frame_id", "pack", "tier", "credits", "outputs", "category", "name_en", "name_pt", "desc_en", "desc_pt", "out_en", "out_pt", "needs", "order", "status", "beta", "updated_at") VALUES
('tpl_selection', 'selection', 'SELECTION', NULL, NULL, false, 'EDIT', NULL, 0, 'pack', 'Your selection', 'Sua seleção', 'Templates you picked', 'Templates que você marcou', '', '', ARRAY[]::TEXT[], 0, 'HIDDEN', false, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
