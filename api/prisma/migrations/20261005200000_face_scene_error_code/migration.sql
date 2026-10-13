-- error_code em faces e scenes: código máquina da falha (AsyncErrorCode), separado do texto humano em fail_reason.
-- Contrato: docs/contratos/modelo-de-dados.md (Mudanças 05/10, onda 2).
ALTER TABLE "faces" ADD COLUMN "error_code" TEXT;

ALTER TABLE "scenes" ADD COLUMN "error_code" TEXT;
