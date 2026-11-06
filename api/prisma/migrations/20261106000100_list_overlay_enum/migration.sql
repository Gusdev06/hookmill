-- templates-lista-v1 §4 (T-B1, 04/11): tipo AUTO novo `LIST_OVERLAY` (templates `versus` e `value-stack`, motor ListOverlay).
-- Aditiva: só acrescenta o valor ao enum. Separada da migração de dados (o valor novo não pode ser usado na mesma transação).
ALTER TYPE "AutoVariationType" ADD VALUE IF NOT EXISTS 'LIST_OVERLAY';
