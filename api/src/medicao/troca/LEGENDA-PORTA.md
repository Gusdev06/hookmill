# Porta da legenda (F2) — o que o backend consome

Dono: video. Contrato: `docs/contratos/troca-texto-queimado-v1.md` §4, §15.6, §16.2 A7. Código: `porta.ts` (bloco "LEGENDA"), `legenda.ts`, `fake.ts`.
Estado (rodada 2, 11/11): **adaptador real pronto** (`TrocaTextoOrquestrada` sobre as ops Python `detectar`, `placa_legenda`, `conferir_legenda`; roda local e em Lambda de teste). Fake continua o caminho de desenvolvimento. **Mudanças da rodada 2 que afetam o backend: `artefatoKey` (§1), `pioresQuadros` (§2).** Portões ainda com valores iniciais; a S3 calibra.

## Injeção
Mesmo token da headline: `TROCA_TEXTO`, `PLATE_IMPL` decide o adaptador (`off` = `null` = nada de legenda). Tipo novo `TrocaPorta = TrocaTextoPort & TrocaLegendaPort` (`import ... from '../medicao/troca'`). `TrocaTextoPort` não mudou (os dobles do F1b continuam compilando).

## 1. Detectar (na leitura, ao montar o plano)
```ts
trocaPorta.detectarLegenda({
  workspaceId, championId,
  videoUrl,                // URL assinada do vídeo do campeão
  editMap,                 // da leitura: layers (kind 'caption'), protectedBands, faceTrack, frameCount, fps
  words,                   // transcript.words da leitura (TranscriptWord[]): as palavras NOVAS = as mesmas
  durationSec,
  captionBox?,             // Rect px do campeão; OBRIGATÓRIO na prática acima de 60 s (sem dica: 283 s)
  fontIdVisao?,            // omitido = layer.style.fontId da camada caption; null = sem dica
  legendaMaxSec?,          // env LEGENDA_MAX_SEC (padrão 60); acima disso devolve too_long SEM chamar a função (US$ 0)
  artefatoKey,             // OBRIGATÓRIO no adaptador real (o fake ignora): chave do storage onde a detecção fica para a placa, ver abaixo
}): Promise<{ captionTrack: CaptionTrack | null; costUsd: number; ms: number }>
```
- `captionTrack === null`: campeão sem legenda queimada (nenhuma camada `caption`). Não é reprovação: `captionMode` fica `avoid`.
- `captionTrack.veredito = { swap, reason: CaptionSwapReason | null, gates }`. `swap: false` = peça não oferecida (§15.1 regra 4), `reason` é o motivo para a tela. `gates` = números da §15.6.1 (chaves em `PORTAO_CHAVES`), vão para o log/medida, sem pixel.
- **Grave `captionTrack` em `editMap.captionTrack`** (JSON, sem coluna). Tipo `CaptionTrack` hoje é **local** (`legenda.ts`), pendente de promoção ao `contratos/` pelo arquiteto.
- **`artefatoKey` / `captionTrack.artefato`:** a placa precisa dos trechos estáveis (`d.npz`, ~centenas de KB, não vai no JSON). A porta grava o arquivo na `artefatoKey` (FileKind CHAMPION_PLATE, sugestão layerKey `caption-data`) e devolve a chave em `captionTrack.artefato` **só quando há swap** (senão apaga e devolve `null`). O backend guarda o arquivo junto da linha CAPTION e passa o `captionTrack` inteiro de volta ao pedir a placa. Perdeu o arquivo = detectar de novo.
- Custo: ~US$ 0,004-0,008 (30 s). Tempo ≤ 60 s (30 s) / ≤ 120 s (com `captionBox`).

## 2. Placa da legenda (quando o `allowed` precisa de `swap`)
```ts
trocaPorta.placaLegenda({
  workspaceId, championId, videoUrl,
  captionTrack,            // só com veredito.swap === true; senão lança ErroTroca (erro de uso)
  version: CAPTION_PLATE_VERSION,   // champion_plates.version, kind CAPTION, layerKey CAPTION_LAYER_KEY ('caption')
  outputKey,               // chave do storage (FileKind CHAMPION_PLATE)
}): Promise<PlacaLegendaResult>   // = PlacaHeadlineResult com reason: CaptionSwapReason | null
```
| `status` | `reason` | o que fazer |
|---|---|---|
| `READY` | `null` | `champion_plates` READY, `fileId` da placa; `metrics` gravadas; `swap` oferecido |
| `REJECTED` | `plate_rejected` \| `color_shift` | linha REJECTED com `reason`; **peça não oferecida e sem crédito reservado** (a placa roda antes do Gerar, §15.6.5) |
| `FAILED` | `plate_failed` | linha FAILED; mesma saída; pode repetir depois (a porta já repetiu 1 vez cada pedaço) |

`pioresQuadros?: number[]` (READY e REJECTED): os até 6 quadros (grade do campeão) das janelas mais ruins; extraia-os da PLACA (e do campeão) e mande ao `checkCaption` modo swap (`ghost`/`smear`/`wrong_text`). Os pedaços/conferências rodam em paralelo (4 execuções) e a porta repete 1 vez cada pedaço.

`metrics` (número, sem pixel, chaves em `PLACA_LEGENDA_METRICAS`): quadros, quadros_placa, janelas_ruins_pct, ruim_gancho_s, ruim_pct, lisura_min, trem_max, degrau_max, letra_p95_pct, fora_buraco_media, salto_emenda_db_min, cor_deslocamento, pedacos, pedaco_max_s, pico_MB. Vão direto para `champion_plates.metrics`.
Tempo: 30 s ≤ 90 s; 128 s ≤ 120 s (a medir na S1b). Custo: US$ 0,007-0,009 (30 s). O job é o mesmo `CHAMPION_PLATE` da headline; trava por `championId + kind + layerKey + version`; mesmo timeout de espera de 180 s no plano (`preparing_plate`).

## 3. Erros
- `ErroTroca` (`import { ErroTroca } from '../medicao/troca'`): falha de infraestrutura ou erro de uso (`op`, `message`, `detalhe`). **Não** é veredito do vídeo. Trate como `plate_failed`/`headline_pending`-equivalente: peça não oferecida, nada cobrado, tenta de novo no próximo lote.
- Veredito do vídeo nunca é exceção: vem em `captionTrack.veredito` (detectar) ou `status/reason` (placa).

## 4. Funções puras (use no `allowed`, sem chamar a porta)
- `avaliarPortoesLegenda(gates, { legendaMaxSec })` e `avaliarPlacaLegenda(metrics)`: a regra da §15.6.1, a mesma do fake e (próxima rodada) da op real. Úteis para reavaliar com `LEGENDA_MAX_SEC` novo sem medir de novo (só o `too_long` depende do env).
- `CAPTION_PLATE_VERSION = 1`, `CAPTION_LAYER_KEY = 'caption'`, `LEGENDA_MAX_SEC_PADRAO = 60`.

## 5. Fake (`FakeTrocaTexto`)
Opções novas: `motivoLegenda` (força o veredito de detectar: qualquer `CaptionSwapReason` pré-placa), `placaLegenda: 'READY' | 'REJECTED' | 'FAILED'`, `gravar` (o mesmo da headline), `atrasoMs`. Determinístico, sem rede. `chamadas` registra `detectar_legenda` e `placa_legenda`. Páginas = `wordsPerPage` da camada (padrão 3), `fimFrame` de cada página = `iniFrame` da próxima, a última vai até `frameCount` (A7).
