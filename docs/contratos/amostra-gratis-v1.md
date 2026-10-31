# Amostra grátis com prévia borrada — contrato v1
Data: 2026-10-29 · Dono: maquina-arquiteto · Status: **PROPOSTA. Nenhum código. Precisa do ok do Gusta vendo o mockup (`design/mockup-amostra-gratis.html`).**
Origem: decisão do Gusta de 29/10 (`decisions/log.md` do AIS-OS), em cima do Loom do Tordan de 29/10 (`feedback/tordan-loom-2026-10-29.md` §1) e do reverse engineer do Superscale (`reports/superscale-reverse-engineer-2026-10-29.md`).
Vale por cima de `iterate-v2-quiz-templates-ia.md` e `variacao-auto-v1.md` só no que muda aqui.

## 0. Em 5 linhas
1. Conta nova (modo "próprio", não agência) sobe o criativo → o Iterate roda normal, mas **só com tipos grátis** (edição e template, nunca IA nem STATIC) e **no máximo 4 peças**.
2. As peças renderizam de verdade (custo nosso ≈ análise + ~US$ 0,02–0,03 por peça), mas a pessoa só recebe uma **prévia borrada**: os 3 primeiros segundos nítidos (o gancho) e o resto borrado, em 480p, com selo "HookMill".
3. Baixar, publicar no Meta, editar ou gerar de novo exige plano pago → **402 `PAYMENT_REQUIRED`**. Pagou: as mesmas peças destravam na hora, sem render novo.
4. Variação **com IA** (F3: avatar, remix) e STATIC continuam só no plano pago.
5. Uma amostra por conta. O teto de custo da amostra é fixo (US$ 1) e fica fora do teto mensal do cliente.

## 1. Estado de acesso (novo)
| conceito | onde | valores |
|---|---|---|
| `access` | `Workspace.access` (enum novo `WorkspaceAccess`) | `SAMPLE` (conta nova, ainda não pagou) · `PAID` · `INTERNAL` (Gusta/Tordan/agência, nunca trava) |
| `sampleUsedAt` | `Workspace.sampleUsedAt` | quando o lote da amostra foi criado; não nulo = amostra gasta |
| `locked` | derivado na peça (`IteratePiece.locked`) | `true` se o lote é a amostra e `access ≠ PAID/INTERNAL` |

- Workspaces que já existem ficam `INTERNAL` (backfill), pra nada mudar pra quem já usa.
- **Pendente do Gusta (P1):** o acesso pago é por workspace ou pela conta do dono? Pra agência, faz mais sentido pela conta, porque um pagamento libera todos os clientes. Proposta: por conta (`User.access`), com o workspace herdando. Muda só onde a coluna mora.

## 2. Lote da amostra
- `POST /iterate` com `access = SAMPLE` e `sampleUsedAt = null` → `VariationBatch.settings.sample = true`. Com a amostra já gasta, retorna 402 `PAYMENT_REQUIRED { reason: 'sample_used' }`.
- O plano usa os mesmos `allowedFor`, filtrados por `TIER_OF = free` e **sem STATIC**, com teto de 4 peças selecionadas. O quiz roda igual. A Q2 (IA) não aparece.
- Lançamento automático: na amostra não tem botão "Generate" com preço. O lote nasce e já gera, porque o custo é nosso e fixo.
- O custo da amostra entra em `CostEntry` com `kind: 'sample'` e **não conta** no `assertWithinCap` do cliente.

## 3. Prévia borrada
- Depois do render de cada peça, o backend gera `preview.mp4`: 480p, `0–3 s` nítido, depois `boxblur=20:2` até o fim, com selo no canto e áudio mantido (a pessoa ouve o ritmo). Custo: ffmpeg na API, alguns segundos por peça.
- A vista do lote (`GET /iterate/:id`) devolve, para a peça travada, **só** `preview` (URL assinada curta). `file`, `formats[].file` e o zip ficam `null`, e o arquivo original nunca sai por URL assinada enquanto estiver travado. O blur é feito no servidor, não em CSS.
- Peça destravada: igual hoje (`file`, `formats`, zip) e `preview: null`.

## 4. O que trava (402 `PAYMENT_REQUIRED`)
`details: { reason: 'locked' | 'sample_used', unlock: { pieces: number } }`
- `GET /iterate/:id/zip`, `POST /iterate/:id/pieces/:pieceId/formats` (4:5 e 1:1), download do arquivo, abrir no editor, publicar no Meta, Retry de peça, Novo lote.
- Ler o lote, assistir à prévia, ver o "por quê" de cada variação e responder o quiz **não** travam.

## 5. Destravar
- `POST /billing/checkout` → `{ url }`. O provedor e o preço estão pendentes (P2). O webhook do provedor marca `access = PAID`, e a vista passa a devolver os arquivos originais sem nenhum render novo.
- Antes de existir checkout, o botão "Unlock" leva a uma tela de espera ("fale com a gente") e o admin libera manualmente com `PATCH /admin/workspaces/:id { access: 'PAID' }`. Isso dá pra testar com o Tordan sem gateway.

## 6. Abuso
- 1 amostra por usuário (e-mail verificado) e por conta de anúncio Meta conectada. Uma segunda conta com o mesmo `adAccountId` herda `sampleUsedAt`.
- Teto global de amostras por dia (`SAMPLE_DAILY_MAX`, padrão 50) pra segurar o custo se um anúncio nosso viralizar.

## 7. Pendente do Gusta
- **P1:** acesso pago por conta ou por workspace (proposta: conta).
- **P2:** provedor e preço (Stripe pros EUA? Cakto? qual plano?).
- **P3:** os 3 segundos nítidos (o gancho) ou tudo borrado? Proposta: 3 s nítidos. A pessoa sente que funciona e não leva o anúncio pronto.
- **P4:** a amostra fica só pra "próprio" ou também pra agência em teste?
