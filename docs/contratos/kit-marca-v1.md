# Kit da marca — contrato v1
Data: 2026-10-31 · Dono: maquina-backend (pedido do Gusta em 31/10; revisão do maquina-arquiteto) · Status: **API implementada e testada localmente. A tela vem depois.**
Substitui o bloco "Em breve — Kit da marca" do onboarding. Tipos: `contratos/src/brand-kit.ts`. Erros, envelope e papéis: `api.md` §1 e `fase2-agencia.md` §4.

## 1. Escopo: por cliente (workspace), com oferta opcional
Decisão: **o kit é do workspace**. Logo, prints e demo são da marca e valem para todas as ofertas. O `offerId` opcional cobre o caso de a peça ser de um produto só (por exemplo, o vídeo demo do app X).

## 2. Assets e limites
| kind | purpose do upload | tipos | teto | quantos |
|---|---|---|---|---|
| `LOGO` | `BRAND_LOGO` | png, jpeg, webp, svg | 5 MB | 1 (o novo troca o anterior) |
| `FILE` | `BRAND_FILE` | png, jpeg, webp, pdf | 25 MB | 30 |
| `DEMO_VIDEO` | `BRAND_VIDEO` | mp4, mov | `UPLOAD_MAX_BYTES` (o mesmo do campeão) · 1 s a 10 min · lado ≥ 240 px | 5 |

- O upload reaproveita o fluxo atual: `POST /uploads { purpose }` → PUT → `POST /uploads/:id/complete`. Os erros também são os de hoje: `MEDIA_INVALID { reason: 'mime' }` (tipo declarado ou assinatura real), `MEDIA_TOO_LARGE`, `MEDIA_TOO_SHORT`, `MEDIA_TOO_LONG`.
- No complete, a assinatura de imagem e de PDF (`%PDF-`) é conferida pelos primeiros bytes. No SVG, procura `<svg` no 1º KB. O vídeo passa pelo ffprobe. O File criado é `BRAND_LOGO`, `BRAND_FILE` ou `BRAND_VIDEO`.
- O logo guarda até 5 **cores dominantes** (`colors`, `#RRGGBB`). No PNG, JPG e WEBP elas vêm da paleta da medição. No SVG, vêm das cores escritas no arquivo, por frequência, com branco e preto no fim. Se a medição falhar, fica `[]`, sem erro.
- O SVG é servido só por URL assinada do storage, que é outra origem. O web deve exibi-lo em `<img>`, nunca inline.

## 3. Endpoints
| método e rota | entrada | saída | papéis e erros |
|---|---|---|---|
| `GET /brand-kit` | — | `BrandKit { logo, files[], demoVideos[] }` com `file: FileRef` (URL assinada) | todos, inclusive CLIENT |
| `POST /brand-kit/assets` | `{ kind, uploadId, label?, offerId? }` | `201 BrandAsset` | CLIENT 403 · upload de outro purpose 422 `MEDIA_INVALID` · upload ou oferta de outro workspace 404 · upload não pronto 409 `UPLOAD_INCOMPLETE` · cheio 409 `INVALID_STATE { reason: 'brand_kit_full', kind, max }` · mesmo upload 2× = o mesmo asset |
| `PATCH /brand-kit/assets/:id` | `{ label?, offerId? }` (null limpa) | `BrandAsset` | CLIENT 403 · 404 |
| `DELETE /brand-kit/assets/:id` | — | `{ ok: true }` | CLIENT 403 · 404. O File fica, porque peças já renderizadas podem apontar pra ele |

`label` tem até 80 caracteres e chega aparado. O CLIENT também não sobe arquivo, porque `POST /uploads` já dá 403 pra ele.

## 4. Modelo (migração `20261031000100_kit_marca`, aditiva)
Entram o enum `BrandAssetKind (LOGO, FILE, DEMO_VIDEO)` e os valores `BRAND_LOGO | BRAND_FILE | BRAND_VIDEO` no `FileKind`. A tabela nova é `brand_assets`: `id, workspace_id, kind, label?, file_id, offer_id? (SET NULL), colors text[], created_by_id, created_at`, com índice `(workspace_id, kind)`. O "1 logo por cliente" é garantido pelo service (troca na mesma transação), sem índice parcial.

## 5. O que já usa o kit e o que fica pra depois
**Já usa**
- **FrameBrand** (molduras B2, CHAT_DM, PERSON_MOTION), em `iteracao/contexto.ts` `frameBrandOf`. Ganhou `logoFileId?: string | null`. A cor da marca passou a seguir esta ordem: `brandColor` do cadastro, depois a dominante saturada do logo, depois o campeão, depois o padrão. Antes era só cadastro, campeão e padrão. O plano do lote AUTO já carrega o logo junto do workspace.
- **Brain**: o drawer do nó `business` mostra `brand.logo`, `brand.colors`, `brand.files` e `brand.demoVideos`. A mídia traz o logo como pôster e o 1º vídeo demo como vídeo.

**Depois (fica a porta)**
- **Render do logo** (maquina-video, **feito em 31/10**, render local; Lambda pede site novo): `api/src/render/logo.ts` `resolverLogoDaMarca` assina a URL na hora em `edicao.service` `autoContext` (`ctx.brandLogo`). Spec com marca usa o `logoFileId` gravado e, com null, ficam as iniciais. Auto-edit (STORY, ENDCARD) usa o logo atual do kit. As composições trocam as iniciais pelo logo (`brand.logo` / `brandLogo`, placa clara ou escura pela cor do logo, contain + respiro): avatar do post_card, marca do slide do call, assinatura do cinema, Chat DM (cabeçalho, bolhas, perfil e cena final), endcard do PERSON_MOTION, avatar do STORY e topo do ENDCARD. Galeria: `video/out/logo-kit-2026-10-31/index.html`.
- **Vídeo demo como b-roll ou tela de produto**: `BrandKitService.demoVideosFor(workspaceId, offerId)` devolve os demos, os da oferta primeiro. Ainda não tem consumidor.
- **STATIC montado** (`edicao/imagem-estatica.service.ts`) e a cor do `edicao.service`: ainda usam só `brandColor`, página e campeão. Ligar a cor do logo é uma linha em cada um.
- **Prompt do Claude** (plano e roteiros): ainda não recebe o kit. Os PDFs e prints podem virar contexto do Cérebro mais adiante.
- O nó `business` do Brain só aparece se o cliente tiver tipo, setor, mercado ou site preenchido. Um kit sem nenhum desses não cria o nó.
