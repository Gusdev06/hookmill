// Legenda queimada (troca-texto-queimado-v1 §4, §15.6, §16.2 A7): tipos locais da F2 e os portões PUROS. Dono: video.
// `CaptionTrack` ainda não está em `contratos/` (§16.5: "ficam para o F2"): vive aqui até o arquiteto promover (ver relatório).
// Sem Python, sem rede: o que for medido no pixel vem das ops `detectar` e `placa_legenda` (próxima rodada); aqui só a regra.
import type { CaptionSwapReason, EditMap, Rect, TranscriptWord } from '@maquina/contratos';

/** Sobe quando muda o método da placa de legenda: placa de versão antiga não vale (`champion_plates.version`, kind CAPTION). */
export const CAPTION_PLATE_VERSION = 1;
/** `LEGENDA_MAX_SEC` (§15.8): teto até a S1b provar o 120 s. */
export const LEGENDA_MAX_SEC_PADRAO = 60;
/** `champion_plates.layerKey` da legenda. */
export const CAPTION_LAYER_KEY = 'caption';

export interface CaptionTrecho {
  /** quadros [iniFrame, fimFrame) da página na tela */
  iniFrame: number; fimFrame: number;
  box: Rect;
  /** IoU entre o texto desenhado com o estilo estimado e a letra detectada */
  iou: number;
  /** palavras da página, como lidas (as MESMAS do original; §15.6: sem tradução, sem gancho) */
  texto: string;
  /** true = estilo herdado do vizinho (trecho sem medida própria); conta no portão `font_mismatch` */
  herdado: boolean;
}

export interface CaptionEstilo {
  /** id de texto do catálogo da LEGENDA ('gabarito-900', 'poppins-800'...): maior que o `FontId` da headline (Gabarito, Poppins 800/900, Archivo
   *  largo, Manrope não estão no `FONT_CATALOG`; ver relatório da F2, rodada 2) */
  fontId: string;
  tamPx: number; tracking: number; espaco: number; strokePx: number;
  /** sombra dura [dx, dy] em px (02 e 05 têm [5, 3]) */
  sombra: [number, number];
  corTexto: string; corDestaque: string | null; corTraco: string;
  /** px do campeão: linha de base e centro do texto medidos (o Remotion posiciona por eles) */
  baseY?: number; centroX?: number;
  caixaDestaque?: { cor: string; raioPx: number } | null;
  palavrasPorPagina: number;
  linhas: number;
}

/** Peso de um intervalo de quadros para o balanceamento de pedaços (§15.6.4): área do buraco × fator da tomada. */
export interface CaptionPegada { iniFrame: number; fimFrame: number; areaPx: number }

export interface CaptionTrack {
  version: 1;
  trechos: CaptionTrecho[];
  estilo: CaptionEstilo;
  /** a legenda do original aparece `atrasoSec` depois da fala (transcrição → tela) */
  atrasoSec: number;
  /** cada `detectar` já devolve a pegada: o balanceamento de pedaços da placa usa isto, sem medir de novo */
  pegada: CaptionPegada[];
  /** quadros de corte de tomada (a placa não atravessa corte; A7 ainda sem teste em página que atravessa corte) */
  cortes: number[];
  /** chave do storage com os trechos estáveis para a placa (`d.npz`); null = sem swap, nada guardado. O backend guarda o arquivo
   *  junto da placa (FileKind CHAMPION_PLATE, layerKey 'caption-data') e o devolve como `artefatoKey` ao pedir de novo */
  artefato: string | null;
  /** a legenda tem caixa de destaque (a placa exige detecção com caixa) */
  caixa: boolean;
  /** faixa [y0, y1] da legenda, px do campeão */
  faixa: [number, number] | null;
  quadros: number;
  fps: number;
  veredito: CaptionVeredito;
}

/** 'copiado' = a legenda nova usa o estilo medido do original; 'padrao' = não deu pra copiar (modo livre): estilo padrão do HookMill */
export type EstiloLegenda = 'copiado' | 'padrao';

/** Limites do que ainda impede a PLACA limpa (modo livre, 12/11). Acima/abaixo disso nem o estilo padrão salva. */
export const LIMITES_MODO_LIVRE = { cobertura: 0.75, linhas: 3, animacao: 0.3, fundoLap: 45 } as const;

export interface CaptionVeredito {
  swap: boolean;
  /** só com `swap` true: 'copiado' ou 'padrao' (estilo padrão do HookMill). Ausente em registro antigo = 'copiado' */
  estilo?: EstiloLegenda | null;
  /** null só quando `swap` é true */
  reason: CaptionSwapReason | null;
  /** números dos portões da §15.6.1 (chaves em `PORTAO_CHAVES`), sem pixel */
  gates: Record<string, number>;
}

/** Chaves de `gates` na ordem em que decidem. Valor 1/0 nos booleanos. */
export const PORTAO_CHAVES = {
  duracao_s: 'duração do vídeo (s)',
  alfabeto_fora: '1 = CJK/RTL na transcrição',
  emoji_legenda: '1 = emoji detectado na visão',
  cobertura: 'fração (0-1) dos quadros com fala cobertos por trechos',
  contorno: '1 = letra clara com contorno escuro a ≤ 6 px',
  linhas: 'nº de linhas da legenda',
  animacao: 'fração (0-1) de variação de largura/altura no trecho',
  iou_mediana: 'IoU mediano dos trechos',
  herdados: 'fração (0-1) de trechos herdados',
  estilo_var: 'variação do corpo entre 3 terços (fração)',
  pessoa_rosto: 'fração (0-1) dos quadros com legenda que têm rosto main',
  pessoa_fala: 'fração (0-1) desses quadros com fala',
  fundo_lap: '|Laplaciano| médio no anel, janelas de 0,5 s; vídeo = mediana das janelas (≤ 60)',
} as const;
export type PortaoChave = keyof typeof PORTAO_CHAVES;

/**
 * §15.6.1, RECALIBRADOS na S3 (12/11) e APERTADOS por decisão do Gusta (12/11): o mais justo que ainda aprova os que saem limpos (30, 27, 54, 07 e 26/05) e
 * reprova o 09 e o 37. Cada limite = pior dos 5 + folga mínima. Histórico "inicial → folgado (só 5 aprovados do Gusta, com o 09) → final" em
 * `research_notes/legenda-s3-2026-11-11/calibracao.md`. O `faceTrack` da S3 foi SUPOSTO (rosto principal o vídeo todo).
 */
export const PORTOES_LEGENDA = {
  /** inicial 0,80 · folgado 0,75 · final 0,79 (pior: 26/05 = 0,795; o 09 mede 0,764) */ cobertura: 0.79,
  /** inicial 0,60 · folgado 0,28 · final 0,365 (pior: 26 = 0,368; o 37 mede 0,363, o 09 0,291, o 02 0,273) */ iouMediana: 0.365,
  /** inicial 0,15 · folgado 0,88 · final 0,495 (pior: 26 = 0,489; o 37 mede 0,500, o 09 0,858) */ herdados: 0.495,
  /** inicial 0,05 · folgado 0,05 · final 0,04 (pior: 07 = 0,031; o 00 mede 0,074) */ estiloVar: 0.04,
  /** sem dado de verdade: o `faceTrack` da S3 foi suposto (=1) */ pessoaRosto: 0.9,
  /** inicial 0,80 · folgado 0,72 · final 0,74 (pior: 54 = 0,744; 29 e 11 medem 0,694 e 0,628) */ pessoaFala: 0.74,
  /** inicial 60 · folgado 45 · final 40 (pior: 30 = 37,6; 29 e 11 medem 47,1 e 52,7) */ fundoLap: 40,
  linhas: 1,
  /** inicial 0,08 · folgado 0,03 · final 0,02 (pior: 07 = 0,005; 29 e 11 medem 0,47 e 0,46) */ animacao: 0.02,
} as const;

/**
 * Portões DEPOIS da placa (§15.6.1 tabela 2), mesmo critério. Pior dos que passam (Lambda onde válido) → final; inicial → folgado → final:
 * ruim_pct 0,20 → 0,80 → 0,80 (07 = 0,77; 37 = 0,83); ruim_gancho_s <1 → 2,5 → 1,5 (pior 1,0; 09 = 2,0; 37 = 3,0);
 * letra_p95_pct 0,5 → 17 → 4 (07 = 3,45; 09 = 8,44 Lambda / 15 Mac); fora_buraco_media 1,5 → 1,65 → 1,3 (54 = 1,22; 09 = 1,56; 37 = 1,51).
 * O `ruim_pct` não separa o 07 do 09 (0,77 × 0,74): quem reprova o 09 é a letra detectável (as setas) e o fora do buraco.
 */
// 12/11 (modo livre, decisão do Claude com delegação do Gusta): letra p95 4 → 5 — libera o 02 (4,42, caixa mista) e o 07 em
// 720p (4,17); o 09 (8,44, setas brancas) segue reprovado. Gancho e cor ficam (o 00 tinha borrão visível).
export const PORTOES_PLACA = { ruimPct: 0.8, ruimGanchoS: 1.5, letraP95Pct: 5, foraBuracoMedia: 1.3, corDeslocamento: 1.3 } as const;

/**
 * Antes da placa (§15.6.1, tabela 1). Pura e determinística: a mesma no fake, no teste e na orquestra.
 * Ordem = a da tabela, para o motivo ser estável. Chave ausente em `g` = portão não medido: NÃO reprova (a op decide
 * se mede; o que vier sem medida cai em `swap` só se a op o devolveu assim).
 */
export function avaliarPortoesLegenda(g: Record<string, number>, o: { legendaMaxSec?: number } = {}): { swap: boolean; reason: CaptionSwapReason | null; estilo: EstiloLegenda | null } {
  const max = o.legendaMaxSec ?? LEGENDA_MAX_SEC_PADRAO;
  const P = PORTOES_LEGENDA;
  const L = LIMITES_MODO_LIVRE;
  const tem = (k: string) => typeof g[k] === 'number' && Number.isFinite(g[k]);
  // MODO LIVRE (12/11, decisão do Gusta): o que bloqueia é só o que impede a PLACA limpa (achar a legenda, contorno, fundo, texto fora do alfabeto,
  // duração). O que só impede COPIAR o estilo vira "estilo padrão" do HookMill: a troca acontece e a legenda nova usa o estilo padrão.
  const duros: Array<[CaptionSwapReason, boolean]> = [
    ['too_long', tem('duracao_s') && g.duracao_s > max],
    ['script_unsupported', tem('alfabeto_fora') && g.alfabeto_fora >= 1],
    ['not_detected', tem('cobertura') && g.cobertura < L.cobertura],
    ['no_outline', tem('contorno') && g.contorno < 1],
    ['multi_line', tem('linhas') && g.linhas > L.linhas],
    ['animated', tem('animacao') && g.animacao > L.animacao],
    ['busy_background', tem('fundo_lap') && g.fundo_lap > L.fundoLap],
  ];
  const duro = duros.find(([, falhou]) => falhou);
  if (duro) return { swap: false, reason: duro[0], estilo: null };
  const macios: Array<[CaptionSwapReason, boolean]> = [
    ['caption_emoji', tem('emoji_legenda') && g.emoji_legenda >= 1],
    ['not_detected', tem('cobertura') && g.cobertura < P.cobertura],
    ['multi_line', tem('linhas') && g.linhas > P.linhas],
    ['animated', tem('animacao') && g.animacao > P.animacao],
    ['font_mismatch', (tem('iou_mediana') && g.iou_mediana < P.iouMediana) || (tem('herdados') && g.herdados > P.herdados)],
    ['style_unstable', tem('estilo_var') && g.estilo_var > P.estiloVar],
    ['no_person', (tem('pessoa_rosto') && g.pessoa_rosto < P.pessoaRosto) || (tem('pessoa_fala') && g.pessoa_fala < P.pessoaFala)],
    ['busy_background', tem('fundo_lap') && g.fundo_lap > P.fundoLap],
  ];
  const macio = macios.find(([, falhou]) => falhou);
  return { swap: true, reason: null, estilo: macio ? 'padrao' : 'copiado' };
}

/** `metrics` da placa de legenda (§15.6.1 tabela 2 + §15.6.4). Todos número, sem pixel; vão para `champion_plates.metrics`. */
export const PLACA_LEGENDA_METRICAS = {
  pedacos: 'nº de execuções (≤ 4)',
  quadros: 'quadros do campeão',
  quadros_placa: 'quadros da placa (tem de ser iguais)',
  janelas: 'janelas de 0,5 s medidas (só tomadas com legenda, sem as com corte)',
  janelas_ruins_pct: 'fração (0-1) de janelas ruins (lisura < 0,5, trem > 3,5 ou degrau > 3)',
  ruim_gancho_s: 'segundos ruins nos 3 primeiros s',
  ruim_pct: 'fração (0-1) da duração ruim',
  lisura_min: 'pior lisura (preenchido ÷ anel); ruim < 0,5',
  trem_max: 'pior variação quadro a quadro no buraco; ruim > 3,5',
  degrau_max: 'pior diferença de tom na borda; ruim > 3',
  letra_p95_pct: 'letra detectável na placa, p95 (%); limite 0,5',
  fora_buraco_media: 'média fora do buraco, em níveis; limite 1,5',
  salto_emenda_db_min: 'pior PSNR na emenda dos pedaços (só registra; calibrar)',
  cor_deslocamento: 'deslocamento de cor fora do buraco, em níveis (§15.6.6; > 1,5 = color_shift)',
  pedaco_max_s: 'maior tempo de pedaço (s)',
  pico_MB: 'pico de RSS da árvore (MB)',
} as const;

/** Portões depois da placa (§15.6.1, tabela 2; limites em `PORTOES_PLACA`). Pura. `null` = passa. */
export function avaliarPlacaLegenda(m: Record<string, number>): CaptionSwapReason | null {
  const v = (k: string) => (typeof m[k] === 'number' && Number.isFinite(m[k]) ? m[k] : null);
  if (v('quadros') !== null && v('quadros_placa') !== null && m.quadros !== m.quadros_placa) return 'plate_failed';
  const P = PORTOES_PLACA;
  if ((v('cor_deslocamento') ?? 0) > P.corDeslocamento) return 'color_shift';
  if ((v('letra_p95_pct') ?? 0) > P.letraP95Pct) return 'plate_rejected';
  if ((v('fora_buraco_media') ?? 0) > P.foraBuracoMedia) return 'plate_rejected';
  if ((v('ruim_gancho_s') ?? 0) > P.ruimGanchoS) return 'plate_rejected';
  if ((v('ruim_pct') ?? 0) > P.ruimPct) return 'plate_rejected';
  return null;
}

/** Estilo neutro do track sem detecção (nada a desenhar; só para o tipo ser total). */
export const ESTILO_VAZIO: CaptionEstilo = {
  fontId: 'montserrat-700', tamPx: 0, tracking: 0, espaco: 1, strokePx: 0, sombra: [0, 0], corTexto: '#ffffff', corDestaque: null, corTraco: '#000000',
  caixaDestaque: null, palavrasPorPagina: 3, linhas: 1,
};

const frameCom = (sec: number, fps: number) => Math.round(sec * fps);

/**
 * `pessoa_rosto` e `pessoa_fala` (§15.6.1 `no_person`): nos quadros com legenda, fração com rosto `main` (faceTrack) e, nesses, com fala
 * (palavra + atraso da legenda). Puro. Sem faceTrack = 0 (ninguém falando para a câmera: a legenda não tem pessoa para proteger).
 */
export function portoesPessoa(m: EditMap, trechos: Array<{ iniFrame: number; fimFrame: number }>, words: TranscriptWord[], atrasoSec: number): { pessoa_rosto: number; pessoa_fala: number } {
  const N = m.frameCount;
  const leg = new Uint8Array(N), rosto = new Uint8Array(N), fala = new Uint8Array(N);
  for (const t of trechos) for (let i = Math.max(0, t.iniFrame); i < Math.min(N, t.fimFrame); i++) leg[i] = 1;
  for (const s of m.faceTrack) if ((s.role ?? 'main') === 'main') for (let i = Math.max(0, s.startFrame); i < Math.min(N, s.endFrame); i++) rosto[i] = 1;
  for (const w of words) for (let i = Math.max(0, frameCom(w.startSec + atrasoSec, m.fps)); i < Math.min(N, frameCom(w.endSec + atrasoSec, m.fps)); i++) fala[i] = 1;
  let nl = 0, nr = 0, nf = 0;
  for (let i = 0; i < N; i++) {
    if (!leg[i]) continue;
    nl++;
    if (rosto[i]) { nr++; if (fala[i]) nf++; }
  }
  return { pessoa_rosto: nl ? nr / nl : 0, pessoa_fala: nr ? nf / nr : 0 };
}

/**
 * Pedaços da placa de legenda (§15.6.4): até `max` (4), balanceados pelo CUSTO (peso de cada quadro = área do buraco do trecho, mais 1 para
 * recodificar), corte em troca de tomada se houver uma a ± 10 % do alvo; senão em troca de trecho; senão no quadro. Mínimo `minQuadros` por pedaço.
 * Cobre [0, n) sem buraco. Puro.
 */
export function planejarPedacosLegenda(n: number, pegada: CaptionPegada[], cortes: number[], max = 4, minQuadros = 30): Array<[number, number]> {
  const custo = new Float64Array(n).fill(1);
  for (const p of pegada) for (let i = Math.max(0, p.iniFrame); i < Math.min(n, p.fimFrame); i++) custo[i] += p.areaPx;
  const k = Math.max(1, Math.min(max, Math.floor(n / minQuadros)));
  const pref = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pref[i + 1] = pref[i] + custo[i];
  const total = pref[n], alvo = total / k;
  const trechosFim = pegada.map((p) => p.fimFrame);
  const cuts: number[] = [0];
  for (let j = 1; j < k; j++) {
    const ideal = (() => { let lo = cuts[cuts.length - 1] + minQuadros; while (lo < n - minQuadros && pref[lo] < alvo * j) lo++; return lo; })();
    const tol = 0.1 * (n / k);
    const perto = (arr: number[]) => arr.filter((x) => Math.abs(x - ideal) <= tol && x - cuts[cuts.length - 1] >= minQuadros && n - x >= minQuadros)
      .sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal))[0];
    const c = perto(cortes) ?? perto(trechosFim) ?? ideal;
    if (c - cuts[cuts.length - 1] >= minQuadros && n - c >= minQuadros) cuts.push(c);
  }
  cuts.push(n);
  return cuts.slice(0, -1).map((a, i) => [a, cuts[i + 1]] as [number, number]);
}

/** Junta as conferências por intervalo nas métricas da placa (§15.6.1 tabela 2). Puro. Janela ruim = lisura < 0,5, trem > 3,5 ou degrau > 3 (feito no Python). */
export function agregarConferencias(partes: Array<{
  janelas: Array<{ iniFrame: number; ruim: boolean | null; lisura: number | null; trem: number | null; degrau: number | null }>;
  fora_valor_soma: number; fora_valor_n: number; letra_valores: number[]; salto_emenda_db: number[]; matriz_desconhecida: boolean;
}>, fps: number, janelaQuadros = Math.max(8, Math.round(fps / 2))): Record<string, number> {
  const jan = partes.flatMap((p) => p.janelas).filter((j) => j.ruim !== null);
  const ruins = jan.filter((j) => j.ruim);
  const letra = partes.flatMap((p) => p.letra_valores).sort((a, b) => a - b);
  const p95 = letra.length ? letra[Math.min(letra.length - 1, Math.ceil(0.95 * letra.length) - 1)] : 0;
  const fn = partes.reduce((s, p) => s + p.fora_valor_n, 0);
  const fora = fn ? partes.reduce((s, p) => s + p.fora_valor_soma, 0) / fn : 0;
  const nums = (k: 'lisura' | 'trem' | 'degrau') => jan.map((j) => j[k]).filter((x): x is number => x !== null);
  const salto = partes.flatMap((p) => p.salto_emenda_db);
  return {
    janelas: jan.length,
    janelas_ruins_pct: jan.length ? ruins.length / jan.length : 0,
    ruim_gancho_s: ruins.filter((j) => j.iniFrame / fps < 3).length * (janelaQuadros / fps),
    ruim_pct: jan.length ? ruins.length / jan.length : 0,
    lisura_min: nums('lisura').length ? Math.min(...nums('lisura')) : 1,
    trem_max: nums('trem').length ? Math.max(...nums('trem')) : 0,
    degrau_max: nums('degrau').length ? Math.max(...nums('degrau')) : 0,
    letra_p95_pct: p95,
    fora_buraco_media: fora,
    salto_emenda_db_min: salto.length ? Math.min(...salto) : 0,
    cor_deslocamento: partes.some((p) => p.matriz_desconhecida) ? fora : 0,
  };
}

/**
 * Os `n` piores quadros da placa para a checagem por visão (`checkCaption` modo swap, §15.6.1: "Sobra visão nos 6 piores quadros"): o quadro do
 * meio das `n` janelas mais ruins (nota = o maior de trem ÷ 3,5, degrau ÷ 3 e 0,5 ÷ lisura), em ordem crescente de quadro. Só janelas medidas. Puro.
 */
export function pioresQuadros(partes: Array<{ janelas: Array<{ iniFrame: number; ruim: boolean | null; lisura: number | null; trem: number | null; degrau: number | null }> }>, n = 6): number[] {
  const nota = (j: { lisura: number | null; trem: number | null; degrau: number | null }) =>
    Math.max((j.trem ?? 0) / 3.5, (j.degrau ?? 0) / 3, j.lisura ? 0.5 / j.lisura : 0);
  return partes.flatMap((p) => p.janelas).filter((j) => j.ruim !== null)
    .sort((a, b) => nota(b) - nota(a)).slice(0, n).map((j) => j.iniFrame + 7).sort((a, b) => a - b);
}
