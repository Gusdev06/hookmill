-- 04/11/2026: meta-templates-v2 §14 (envio com override). Estrutura resolvida (template + override do envio) gravada na
-- publicação; o job, o retry e o structureOf leem daqui. Publicação antiga (NULL) continua lendo o template ao vivo.
-- AlterTable
ALTER TABLE "meta_publications" ADD COLUMN     "template_snapshot" JSONB;
