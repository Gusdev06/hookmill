# Template de publicação no Meta — contrato v1
Data: 2026-10-29 · Dono: maquina-arquiteto · Status: **PROPOSTA. Nenhum código. Precisa do ok do Gusta vendo o mockup (`design/mockup-meta-templates.html`).**
Origem: Loom do Tordan de 29/10 (`feedback/tordan-loom-2026-10-29.md` §2 e §5). Vale por cima de `meta-v1.md` §3.3 só no que muda aqui. Erros, envelope e papéis: `api.md` §1 e `meta-v1.md` §3.4.

## 0. Em 5 linhas
1. **Hoje** cada "Publish to Meta" cria 1 campanha + 1 ad set + 1 anúncio, com o formulário preenchido na hora.
2. **Novo:** o cliente salva **templates de publicação** com a mesma estrutura do Gerenciador (Campanha → Conjunto → Anúncio). Ele preenche uma vez e usa sempre. Um deles é o padrão.
3. Dá pra criar o template **do zero** (janela no formato do Gerenciador) ou **importando** uma campanha, ad set ou anúncio que já roda na conta.
4. O padrão de fábrica é o do Tordan: **CBO, 4 a 8 anúncios por ad set**. Publicar um lote enche um ad set até 8 e abre outro quando lota.
5. O template vai pro Brain e pro prompt da IA (o que ela pode sugerir publicar e como).

## 1. Modelo de dados (migração aditiva, nada muda nas tabelas atuais)
`MetaPublishTemplate` (por workspace, com `connectionId` e `adAccountId`, porque o template vale para uma conta de anúncio):
| grupo | campos | observação |
|---|---|---|
| identidade | `id`, `workspaceId`, `adAccountId`, `name` (≤ 60), `isDefault`, `source: MANUAL \| IMPORTED`, `importedFrom: { level: 'campaign'\|'adset'\|'ad', id, name } \| null`, `createdById`, timestamps, `archivedAt` | 1 `isDefault` por conta de anúncio |
| campanha | `objective`, `budgetMode: CBO \| ABO`, `dailyBudgetMinor` (CBO: na campanha; ABO: por ad set), `bidStrategy: LOWEST_COST \| COST_CAP \| BID_CAP`, `bidAmountMinor?` (cap), `specialAdCategories`, `campaignNamePattern` | padrão: `CBO`, `LOWEST_COST` |
| destino | `destination: NEW_CAMPAIGN \| REUSE_CAMPAIGN`, `reuseCampaignId?` | REUSE = toda publicação cai na mesma campanha de teste (o HookMill cria a 1ª vez e guarda o id) |
| conjunto | `optimization` (`pixelEvent` ou `LINK_CLICKS`/`APP_INSTALLS`), `pixelId?`, `countries`, `ageMin`, `ageMax`, `genders: ALL\|MALE\|FEMALE`, `advantageAudience: boolean`, `placements: AUTO \| { platforms[], positions[] }`, `adsPerAdset: { min, max }` (padrão 4–8, limite 1–50), `adsetNamePattern` | |
| anúncio | `primaryText?`, `headline?`, `description?`, `callToAction`, `link`, `urlTags?` (UTM), `adNamePattern` | vazio = herda do criativo/oferta como hoje |

Padrões de nome usam variáveis: `{offer}`, `{code}` (código da peça, ex. `HEADLINE-02`), `{date}`, `{n}`.

## 2. Endpoints
| método e rota | entrada | saída | erros |
|---|---|---|---|
| `GET /meta/templates` | — | `MetaPublishTemplate[]` da conta selecionada, padrão primeiro | 422 `META_SELECTION_MISSING` |
| `POST /meta/templates` | `TemplateBody` | `201 MetaPublishTemplate` | 400; 422 `META_PIXEL_REQUIRED` |
| `PATCH /meta/templates/:id` · `DELETE` (arquiva) | parcial | template | 404; 409 se for o único padrão em uso por lote rodando |
| `POST /meta/templates/import` | `{ level, id }` (lista vem de `GET /meta/campaigns`, já existe) | `{ template: TemplateBody, unsupported: { field, value }[] }`. **Não salva**: a janela abre preenchida e a pessoa revisa | 404 `META_OBJECT_GONE`; 422 `META_PERMISSION` |
| `POST /creatives/:id/meta/publish` | `MetaPublishBody` (hoje) **ou** `{ templateId, overrides? }` | igual hoje | igual hoje |
| `POST /meta/publish-batch` | `{ creativeIds[] (1–50), templateId }` | `202 { publications: MetaPublication[], plan: { adsets: { name, creativeIds[] }[] } }` | 409 algum não `APPROVED`; demais iguais |

- O `publish-batch` agrupa em ad sets de até `adsPerAdset.max`. O último ad set fica com o resto, e o plano avisa quando ele fica abaixo do `min` (ex.: 3 com mínimo 4). Com `REUSE_CAMPAIGN`, entra na campanha guardada se ela ainda existir; se não existir, cria e atualiza o id.
- O job continua o `META_PUBLISH` atual, com uma diferença: campanha e ad set são criados **uma vez por grupo**, e não por anúncio. Tudo nasce `PAUSED`, como hoje (ativar continua sendo OWNER/ADMIN).

## 3. Importar de uma campanha existente
- `level: 'campaign'` lê a campanha, o 1º ad set ativo e o 1º anúncio. `adset` lê o ad set e a campanha-mãe. `ad` lê os três.
- Mapeia o que o template conhece. O resto vai em `unsupported` e aparece na janela como "não copiado: …" (ex.: público personalizado, exclusões, agendamento, regras de lance por posicionamento).
- Público salvo ou personalizado: v1 **não copia** (aparece em `unsupported`). Fica pra v2, com `customAudienceIds`.

## 4. Brain e IA
- O template padrão aparece no nó Goal do Brain ("Publica em CBO, 4–8 por ad set, US$ X/dia").
- Quando a skill do Tordan chegar (§5 do feedback), ela lê o template e as métricas pra sugerir onde publicar. Fica fora desta v1.

## 5. Pendente do Gusta
- **P1:** o destino padrão de fábrica é `REUSE_CAMPAIGN` (uma campanha "HookMill — testes" que acumula ad sets) ou `NEW_CAMPAIGN` (uma por lote)? Proposta: REUSE. É o que o Tordan descreveu ("dentro de uma campanha").
- **P2:** orçamento padrão de fábrica (hoje o mínimo da conta). Proposta: pedir na criação do primeiro template, sem padrão escondido.
- **P3:** publicar o lote inteiro de uma vez (`publish-batch`) já na v1, ou só peça a peça com o template? Proposta: o lote, porque é o que dá sentido ao 4–8.
