# F1a: handoff backend → frontend (06/11)
Dono: maquina-backend. Fonte: `troca-texto-queimado-v1.md` §15.3, §15.3.1, §15.4, §15.8. Tipos em `contratos/src/iteracao.ts`, `templates.ts`, `editor.ts`.

## Rotas
- `POST` e `DELETE /iterate/:id/caption-blocked/force` respondem **410** com o envelope de erro de sempre e `code: 'CAPTION_FORCE_RETIRED'`, para qualquer corpo. Sem `details`. Tela antiga mostra toast comum.

## Saem da resposta (e dos tipos)
- `IteratePiece.captionOverride`
- `AutoInsight.captionBlocked[].forced`
- `AutoInsight.captionNote` (também em lote antigo: a API tira do JSON guardado)
- tipo `ForceCaptionBlockedBody`

## Ficam
- `insight.captionBlocked[]` = `{ type, template, reason: 'burned_captions', listTemplate? }`. **Agora vem também em lote de template.**
- `IteratePiece.captionNote: 'replaced' | null`, `retryHint`, enviar versão sem legenda, outro template/moldura.
- Faixa de cor e "encolher" nas molduras (decisão do Gusta, §15.13).

## Forma de `headline_pending`
| onde | valor |
|---|---|
| Lote, `insight.headlineBlocked` | `{ reason: 'headline_pending', mode: 'replace' }` (campo em transição, igual aos outros motivos) |
| Galeria e lote, `TemplateFit` do Headline | `{ level: 'hard', reason: 'headline_pending' }` |
| `POST` de usar template | 422 `TEMPLATE_DOESNT_FIT`, `details.reason: 'headline_pending'` |
| Pack ou seleção | segue `ok` se outra peça couber; seleção lista `{ slug, reason: 'headline_pending' }` em `skipped` |
| Peça antiga refeita ou na fila | `errorCode: 'HEADLINE_PENDING'`, `retryHint: 'leave_out'`, `failReason` em EN |

Texto (§15.4): "This video's headline can't be rewritten yet" + as saídas. Nunca prometer data.
HEADLINE `add` (campeão sem headline) segue oferecido. `headline_aspect` continua valendo para aspecto sem formato.

## Lote de template com legenda queimada
- Formato que cobriria a legenda: `template.fit = { level: 'soft', reason: 'burned_captions' }`, `pieces: []`, sem "Generate anyway". Mostrar a faixa `soft` com: enviar versão sem legenda, outro template.
- Seleção: marcado `soft` não entra no plano e aparece em `skipped` com `reason: 'burned_captions'`.
- Pack: `ok` se algum couber.
- Sem cobertura, a checagem `CAPTION_COVERED` agora vale para toda peça com legenda queimada, inclusive no export do editor.

## Peças antigas (§15.3.1)
- Pronta: continua baixável, sem selo. Sem reembolso retroativo.
- Item marcado em `PLAN_READY`, e HEADLINE `replace` em `PLAN_READY`: não aparece no plano nem conta no quote. Se o lote de template ficar vazio, `template.fit` vira `soft`.
- Editor em HEADLINE `replace` antigo: `editor: { available: false, reason: 'headline_plate_retired' }`. **Novo valor de `EditorUnavailableReason`.** Vale para placa e caixa, porque nenhum dos dois tem build no F1a.
