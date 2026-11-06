-- 01/11/2026: templates-creditos-v1 A6 (Gusta 31/10, ok do trabalho 01/11). "Cold open" e "Offer end card" voltam ao catálogo
-- como LIVE, 1 crédito, Edição. O plano volta a gerá-los SÓ no lote de template (regras.ts `templateOnlyTypes`); o Iterate
-- normal segue sem eles (decisão de 25/10). Só dados, sem mudança de schema. Continuam fora da galeria do cliente até ter
-- vídeo de exemplo (`visibleToCustomer` exige example_key); a equipe (INTERNAL) já usa.
-- O end card não exige preço (a variante `cta` sai do CTA do Brain ou do falado): `needs` vazio no lugar de 'price'.
UPDATE "templates"
SET "status" = 'LIVE', "credits" = 1, "tier" = 'EDIT', "updated_at" = CURRENT_TIMESTAMP
WHERE "slug" IN ('cold-open', 'offer-end-card');

UPDATE "templates"
SET "needs" = ARRAY[]::TEXT[],
    "desc_en" = 'Adds an end card with your offer, guarantee, price or call to action, taken from the Brain.',
    "desc_pt" = 'Acrescenta um cartão final com oferta, garantia, preço ou chamada, tirados do Cérebro.'
WHERE "slug" = 'offer-end-card';
