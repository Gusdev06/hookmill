// Script de TESTE (não é produto): as 18 molduras (estatico-montado-e-molduras-v1 §B) com o campeão real do Gusta, num
// lote AUTO que já existe. Pedido do Gusta em 25/10, teto aprovado de US$ 1,50.
//
//   cd api && npx ts-node --transpile-only src/dev/molduras-todas.ts               # --dry-run (padrão): só mostra
//   cd api && npx ts-node --transpile-only src/dev/molduras-todas.ts --yes --ignorar-d10   # roda de verdade
//   cd api && npx ts-node --transpile-only src/dev/molduras-todas.ts --rerender            # 25/10: re-render das molduras do lote (dry-run)
//   cd api && npx ts-node --transpile-only src/dev/molduras-todas.ts --rerender --yes      # idem de verdade (teto US$ 2)
//   cd api && npx ts-node --transpile-only src/dev/molduras-todas.ts --rerender --so-duas-fontes [--nova-trilha] [--sem-imagem] [--yes]  # 25/10: só as 6 de 2 fontes com a trilha de b-roll (teto US$ 1; --sem-imagem = trecho sem clipe estende o vizinho)
//
// O que faz, por template que ainda não existe no lote (ou cuja peça antiga falhou):
//  1. textos pela MESMA chamada de detalhe da moldura do planAutoBatch (sistema AUTO_PLAN_SYSTEM + contexto do lote +
//     framesDetailMessage + FRAME_DETAIL_SCHEMA strict), na língua da tela, com custo gravado (cost_entries LLM no lote);
//  2. leitura pelo frameParamsOf da ia e validação pelo validatePlan do regras.ts (template que não passa sai, com motivo);
//  3. FrameSpec pelo frameSpecOf do regras.ts (marca, rosto) + 2ª fonte `champion_segment` nas 6 de 2 fontes;
//  4. item FRAME + criativo + render 9:16 QUEUED (priority 0, engine REMOTION), como o start do lote. A API no ar
//     (RENDER_IMPL=lambda) pega da fila no próximo ciclo do poller (RENDER_LAMBDA_POLL_MS) e manda pro Lambda.
// Fora da regra do produto, SÓ aqui e com flag explícita (--ignorar-d10): o máx. de 2 FRAME por lote (D10) e o bloqueio
// `two_sources` das 6 de 2 fontes (o B2 ainda não liberou no allowedFrames). O resto da validação vale igual.
import 'reflect-metadata';
import { FRAME_DUAS_FONTES, IMAGEM_RESERVA_USD, IMAGENS_POR_TRILHA, semRepetirDentro } from '../edicao/segunda-fonte';
import { VARIANTES, cortarFala } from '../edicao/trilha-broll';
import type { EditMap, TranscriptWord } from '@maquina/contratos';
import type { FrameTemplateId } from '@maquina/contratos';
import type { AutoFrameDraft, AutoPlanDraft, AutoPlanInput, FrameSecondSource, OfferBriefDraft } from '../integracoes/contrato';
import { FRAME_DETAIL_SCHEMA, framesDetailMessage, type DetailTarget } from '../integracoes/claude/auto-plano-detalhe';
import { FRAME_TEMPLATES, FRAME_TWO_SOURCE, frameParamsOf } from '../integracoes/claude/auto-plano-moldura';
import { AUTO_PLAN_SYSTEM, autoPlanContext, languageName } from '../integracoes/claude/auto-plano';
import { priceOf } from '../integracoes/claude/custo';
import {
  allowedFrames, codeFor, frameContentViolations, frameSpecOf, validatePlan,
  type AllowedType, type FinalParams, type PlanBlock, type PlanCtx, type Violation,
} from '../iteracao/regras';

// ───────── alvo (pedido do Gusta, 25/10) ─────────

export const ALVO = {
  batchId: 'cmvnlm4yd000l22emdoob1j5a',
  workspaceId: 'cmvnljsvj000122emb5rvumut',
  teardownId: 'cmvnlm9ov000r22em47tqhtyf',
  /** língua da tela pedida pelo Gusta (a fala do campeão está gravada como "zh"; o lote e a oferta são zh-TW) */
  screenLanguage: 'zh-TW',
} as const;
export const TETO_USD = 1.5;
/** 2ª fonte: trecho do campeão com pelo menos isto (§B3: ≥ 3 s). */
export const SEGMENTO_MIN_SEC = 3;
/** Saída de uma chamada de detalhe (tokens; as deste lote em 25/10 saíram com 0,4-1,7 mil). Estimativa pra cima. */
export const SAIDA_TOK_ESTIMADA = 1800;
/** Margem sobre a estimativa (tokenização de CJK é imprecisa). */
export const MARGEM = 1.2;
/** Render Lambda sem histórico no lote. */
export const RENDER_USD_PADRAO = 0.05;
/** Chamadas de detalhe em paralelo DEPOIS da 1ª (a 1ª grava o cache do prefixo; as outras leem). */
export const PARALELO = 4;

// ───────── tipos ─────────

export interface FrameExistente {
  template: FrameTemplateId; code: string; index: number; render: 'QUEUED' | 'RENDERING' | 'READY' | 'FAILED' | null;
  /** --rerender (25/10): item, criativo e estado dele */
  itemId?: string; creativeId?: string | null; creativeState?: string | null;
}

/** Tudo que o script precisa do banco (carregado uma vez; os testes montam à mão). */
export interface LoteDados {
  batchId: string; workspaceId: string; offerId: string; championId: string; championName: string;
  language: string; createdById: string;
  offer: OfferBriefDraft;
  ctx: PlanCtx;
  /** entrada do plano (só o contexto dela vai pro Claude: autoPlanContext) */
  input: AutoPlanInput;
  editMap: EditMap | null;
  whys: Record<string, string>;
  existentes: FrameExistente[];
  codigos: string[];
  maxIndex: number;
  /** 25/10: o lote já tem a trilha de b-roll gravada (settings.brollTrack) */
  trilhaSalva?: boolean;
  /** US$ de 1 render 9:16 (maior custo de render já gravado neste lote, ou o padrão) */
  renderUsd: number;
  model: string;
}

export interface LinhaPlano {
  template: FrameTemplateId;
  acao: 'criar' | 'pular';
  motivo: string | null;
  code: string | null;
  whyKey: 'hook' | 'proof' | 'cta';
  second: FrameSecondSource | null;
  secondNota: string | null;
  faceAtSec: number | null;
}

export interface Estimativa { chamadas: number; claudeUsd: number; renders: number; renderUsd: number; totalUsd: number; prefixoTok: number; pedidoTok: number }

export interface PecaPronta {
  template: FrameTemplateId; code: string; index: number; whyKey: 'hook' | 'proof' | 'cta';
  change: string; rationale: string; params: Extract<FinalParams, { type: 'FRAME' }>;
}

/** Porta da 2ª etapa do plano (ia): textos de UMA moldura. */
export interface EscritorDeTextos {
  escrever(alvo: DetailTarget, outros: DetailTarget[]): Promise<{ frame: Record<string, unknown>; costUsd: number }>;
}
export interface Deps {
  carregar(): Promise<LoteDados>;
  escritor(lote: LoteDados): EscritorDeTextos;
  /** teto mensal do workspace (CustosService.assertWithinCap): lança se estoura */
  tetoDoWorkspace(workspaceId: string, estimateUsd: number): Promise<void>;
  gravar(lote: LoteDados, pecas: PecaPronta[]): Promise<{ code: string; itemId: string; creativeId: string; renderId: string }[]>;
  /** --rerender: zera a 2ª fonte das de 2 fontes (a API resolve na ordem nova) e enfileira um 9:16 novo de cada peça */
  rerenderizar?(lote: LoteDados, linhas: LinhaRerender[], o?: { novaTrilha: boolean; semImagem?: boolean }): Promise<{ code: string; renderId: string }[]>;
  log(linha: string): void;
}
export interface Opcoes { yes: boolean; ignorarD10: boolean; rerender?: boolean; soDuasFontes?: boolean; novaTrilha?: boolean; semImagem?: boolean }

export interface Resultado {
  linhas: LinhaPlano[];
  estimativa: Estimativa;
  executado: boolean;
  gastoClaudeUsd: number;
  fora: { template: FrameTemplateId; motivo: string }[];
  criadas: { code: string; itemId: string; creativeId: string; renderId: string }[];
}

// ───────── por template ─────────

/** Linha do porquê que cada moldura ataca (vai no framesDetailMessage, como a do plano). */
export const WHY_DE: Record<FrameTemplateId, 'hook' | 'proof' | 'cta'> = {
  question_box: 'hook', meme: 'hook', cinema: 'hook', post_card: 'hook', story: 'hook', live: 'hook',
  gossip_page: 'hook', gossip_white: 'hook', gossip_pink: 'hook',
  news: 'proof', read_caption: 'proof', pov_testimonial: 'proof', ranking: 'proof', split_stack: 'proof', split_torn: 'proof', call_dialog: 'proof',
  direct_offer: 'cta', call: 'cta',
};
/** Nome PT da moldura (o `change` vai no idioma da interface do lote, PT). */
const NOME_PT: Record<FrameTemplateId, string> = {
  question_box: 'Caixinha', gossip_page: 'Choquei', meme: 'Meme', cinema: 'Cinema', news: 'Notícia', split_stack: 'Tela dividida',
  split_torn: 'Tela dividida 2', call: 'Google Meet', call_dialog: 'Meet diálogo', ranking: 'Ranking', post_card: 'Tweet',
  direct_offer: 'Oferta direta', story: 'Story', read_caption: 'Leia a legenda', pov_testimonial: 'POV + depoimento', live: 'Live',
  gossip_white: 'Fofoca 1', gossip_pink: 'Fofoca 2',
};
const changeDe = (t: FrameTemplateId) => `Dentro da moldura ${NOME_PT[t]}: o campeão inteiro, textos novos`;
const RATIONALE = 'Teste das 18 molduras com o campeão real (script dev, 25/10).';

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

// ───────── 2ª fonte (§B3) ─────────

const PROVA_FALLBACK = ['story', 'testimonial', 'result', 'demo', 'social_proof'];

/** Trechos com rosto do faceTrack (role main ou sem role), em segundos. */
export function trechosComRosto(editMap: EditMap | null): { startSec: number; endSec: number }[] {
  if (!editMap?.faceTrack?.length || !editMap.fps) return [];
  return editMap.faceTrack
    .filter((f) => (f.role ?? 'main') === 'main' && f.endFrame > f.startFrame)
    .map((f) => ({ startSec: f.startFrame / editMap.fps, endSec: f.endFrame / editMap.fps }));
}

/** Borda dentro de uma palavra vai pro vão entre palavras mais perto PARA DENTRO do trecho (nunca sai do bloco nem do
 *  trecho com rosto; o snapSpans do produto escolhe o mais perto, que pode cair fora). */
export function snapParaDentro(s: { startSec: number; endSec: number }, words: TranscriptWord[]): { startSec: number; endSec: number } {
  if (!words.length) return s;
  const gaps: number[] = [];
  for (let i = 0; i < words.length - 1; i++) gaps.push((words[i].endSec + words[i + 1].startSec) / 2);
  const inside = (t: number) => words.some((w) => t > w.startSec + 0.01 && t < w.endSec - 0.01);
  const start = inside(s.startSec) ? gaps.find((g) => g >= s.startSec) ?? s.startSec : s.startSec;
  const end = inside(s.endSec) ? [...gaps].reverse().find((g) => g <= s.endSec) ?? s.endSec : s.endSec;
  return end > start ? { startSec: start, endSec: end } : s;
}

/**
 * Trecho de prova do teardown pra 2ª fonte: bloco `proof` (senão história/depoimento, senão o mais longo que não é gancho
 * nem CTA), ≥ 3 s, depois do gancho, bordas no vão entre palavras. `comRosto` (call_dialog): só a parte do bloco com rosto
 * no faceTrack (a maior, ≥ 3 s). Nada serve = null.
 */
export function segmentoDeProva(
  blocks: PlanBlock[], editMap: EditMap | null, words: TranscriptWord[], opts: { comRosto: boolean },
): { startSec: number; endSec: number; bloco: string } | null {
  if (!blocks.length) return null;
  const fn = (b: PlanBlock) => b.fn.trim().toLowerCase();
  const hook = blocks.find((b) => /hook|gancho/.test(fn(b))) ?? blocks[0];
  const rank = (b: PlanBlock) => (fn(b) === 'proof' ? 0 : PROVA_FALLBACK.includes(fn(b)) ? 1 : /cta/.test(fn(b)) ? 9 : 2);
  const cands = blocks
    .filter((b) => b !== hook && b.startSec >= hook.endSec - 0.01 && rank(b) < 9)
    .sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? b.endSec - b.startSec - (a.endSec - a.startSec) : a.startSec - b.startSec));
  const rostos = trechosComRosto(editMap);
  for (const b of cands) {
    let spans = [{ startSec: b.startSec, endSec: b.endSec }];
    if (opts.comRosto) {
      spans = rostos
        .map((f) => ({ startSec: Math.max(f.startSec, b.startSec), endSec: Math.min(f.endSec, b.endSec) }))
        .filter((s) => s.endSec - s.startSec > 0)
        .sort((x, y) => y.endSec - y.startSec - (x.endSec - x.startSec));
    }
    const s = spans[0];
    if (!s || s.endSec - s.startSec < SEGMENTO_MIN_SEC) continue;
    const snap = snapParaDentro(s, words);
    const out = snap.endSec - snap.startSec >= SEGMENTO_MIN_SEC ? snap : s;
    return { startSec: r3(out.startSec), endSec: r3(out.endSec), bloco: `${b.label} (${b.fn})` };
  }
  return null;
}

// ───────── plano (sem custo) ─────────

/** Código único no lote: o do catálogo (§B7) e, se já existe (peça antiga que falhou), `-2`, `-3`… */
export function codigoUnico(template: FrameTemplateId, ctx: PlanCtx, usados: Set<string>): string {
  const base = codeFor('FRAME', template, 1, ctx.lang);
  let code = base;
  for (let n = 2; usados.has(code); n++) code = `${base}-${n}`;
  usados.add(code);
  return code;
}

/** As 18 linhas: o que cria, o que pula (e por quê), código, 2ª fonte e rosto. Puro. */
export function planejar(lote: LoteDados): LinhaPlano[] {
  const usados = new Set(lote.codigos);
  const permitidas = new Map(allowedFrames(lote.ctx).map((f) => [f.template, f]));
  return FRAME_TEMPLATES.map((template): LinhaPlano => {
    const base = { template, whyKey: WHY_DE[template], second: null, secondNota: null, faceAtSec: null, code: null } as LinhaPlano;
    const mesmas = lote.existentes.filter((e) => e.template === template);
    const viva = mesmas.find((e) => e.render !== 'FAILED');
    if (viva) return { ...base, acao: 'pular', motivo: `já existe no lote (${viva.code}, render ${viva.render ?? 'sem render'})` };
    const regra = permitidas.get(template);
    // two_sources = bloqueio de fase (B2 não liberou), não de dado: o script passa por cima. Os outros são do Brain.
    if (regra && !regra.allowed && regra.blockedReason !== 'two_sources') {
      return { ...base, acao: 'pular', motivo: `bloqueada pelo allowedFrames do produto (${regra.blockedReason})` };
    }
    const linha: LinhaPlano = { ...base, acao: 'criar', motivo: mesmas.length ? `a antiga falhou (${mesmas.map((m) => m.code).join(', ')}): de novo` : null };
    if ((FRAME_TWO_SOURCE as FrameTemplateId[]).includes(template)) {
      const seg = segmentoDeProva(lote.ctx.blocks, lote.editMap, lote.ctx.words, { comRosto: template === 'call_dialog' });
      if (!seg) return { ...base, acao: 'pular', motivo: `sem trecho de prova ≥ ${SEGMENTO_MIN_SEC} s${template === 'call_dialog' ? ' com rosto' : ''} no teardown` };
      // feedback 25/10: o painel de baixo nunca mostra o momento que toca em cima (o trecho em loop fica ≥ 2 s longe)
      const sem = semRepetirDentro(seg, lote.ctx.durationSec);
      if (!sem) return { ...base, acao: 'pular', motivo: `o trecho de prova ${seg.startSec}-${seg.endSec} s repetiria o de cima` };
      linha.second = { kind: 'champion_segment', startSec: sem.startSec, endSec: sem.endSec };
      linha.secondNota = `${seg.bloco} (fallback; com a porta de b-roll da ia ligada a API escolhe Pexels antes)`;
    }
    // rosto redondo: o mesmo do frameSpecOf (FRAME_WITH_FACE ← ctx.frame.faceAtSec)
    linha.faceAtSec = ['question_box', 'live', 'gossip_page', 'gossip_white', 'gossip_pink'].includes(template) ? lote.ctx.frame?.faceAtSec ?? null : null;
    linha.code = codigoUnico(template, lote.ctx, usados);
    return linha;
  });
}

/** Alvo da 2ª etapa (o que o plano do lote teria escolhido). `live` não tem texto: dispensa a chamada. */
export function alvoDe(l: LinhaPlano, index: number): DetailTarget {
  return { index, kind: 'FRAME', whyKey: l.whyKey, change: changeDe(l.template), rationale: RATIONALE, concept: '', emotion: null, template: l.template };
}

// ───────── custo ─────────

/** Tokens aproximados: ~3,5 caracteres ASCII por token; CJK e outros ~1,3 token por caractere (pra cima). */
export function tokensDe(s: string): number {
  let ascii = 0;
  let outros = 0;
  for (const ch of s) (ch.charCodeAt(0) < 128 ? ascii++ : outros++);
  return Math.ceil(ascii / 3.5 + outros * 1.3);
}

/** 1ª chamada grava o cache do prefixo (sistema + contexto + esquema, 1,25×); as outras leem (preço de cache read). */
export function estimar(lote: LoteDados, linhas: LinhaPlano[]): Estimativa {
  const criar = linhas.filter((l) => l.acao === 'criar');
  const comTexto = criar.filter((l) => l.template !== 'live');
  const p = priceOf(lote.model);
  const prefixoTok = tokensDe(AUTO_PLAN_SYSTEM) + tokensDe(autoPlanContext(lote.input)) + tokensDe(JSON.stringify(FRAME_DETAIL_SCHEMA));
  const pedidos = comTexto.map((l, k) => tokensDe(framesDetailMessage([alvoDe(l, k)], { screenLanguage: languageName(lote.ctx.screenLanguage ?? 'en'), whys: lote.whys })));
  let claude = 0;
  pedidos.forEach((pedido, k) => {
    const prefixo = k === 0 ? prefixoTok * p.input * 1.25 : prefixoTok * p.cacheRead;
    claude += (prefixo + pedido * p.input + SAIDA_TOK_ESTIMADA * p.output) / 1e6;
  });
  claude *= MARGEM;
  const renderUsd = criar.length * lote.renderUsd;
  return {
    chamadas: pedidos.length, claudeUsd: r4(claude), renders: criar.length, renderUsd: r4(renderUsd), totalUsd: r4(claude + renderUsd),
    prefixoTok, pedidoTok: pedidos.length ? Math.round(pedidos.reduce((a, b) => a + b, 0) / pedidos.length) : 0,
  };
}

// ───────── validação (a mesma do plano) ─────────

/**
 * validatePlan do regras.ts sobre um plano de 1 peça (as violações do PLANO — contagem, diversidade, porquê — não se
 * aplicam a um teste de 1 moldura). Com `ignorarD10`, o `allowed` libera FRAME e o bloqueio `two_sources` das 6 de 2 fontes
 * troca pela validação de conteúdo delas (frameContentViolations: limites, nada inventado, fontes).
 */
export function validarMoldura(draft: AutoFrameDraft, l: LinhaPlano, ctx: PlanCtx, opts: { ignorarD10: boolean }): Violation[] {
  const allowed: AllowedType[] = [{ type: 'FRAME', max: opts.ignorarD10 ? FRAME_TEMPLATES.length : 2, blockedReason: null }];
  const item = { type: 'FRAME', whyKey: l.whyKey, change: changeDe(l.template), rationale: RATIONALE, params: draft };
  const plan = { blocks: [], why: { hook: { text: 'x' }, proof: { text: 'x' }, cta: { text: 'x' } }, kept: [], items: [item] } as unknown as AutoPlanDraft;
  const vs = validatePlan(plan, ctx, allowed).filter((v) => v.item !== null);
  const fase = vs.find((v) => v.rule === 'frame_not_allowed' && v.detail.includes('two_sources'));
  if (!fase) return vs;
  if (!opts.ignorarD10) return vs;
  return [...vs.filter((v) => v !== fase), ...frameContentViolations(draft, 0, ctx)];
}

// ───────── execução ─────────

async function emLotes<T, R>(xs: T[], n: number, f: (x: T, k: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => {
    while (next < xs.length) {
      const k = next++;
      out[k] = await f(xs[k], k);
    }
  }));
  return out;
}

const fmt = (n: number) => `US$ ${n.toFixed(4)}`;

export function relatorioPlano(lote: LoteDados, linhas: LinhaPlano[], e: Estimativa, opts: Opcoes): string[] {
  const out = [
    `lote ${lote.batchId} · workspace ${lote.workspaceId} · campeão "${lote.championName}" (${lote.ctx.durationSec.toFixed(1)} s)`,
    `tela: ${lote.ctx.screenLanguage} · modelo ${lote.model} · rosto redondo em ${lote.ctx.frame?.faceAtSec ?? 'nenhum'} s · códigos ${lote.ctx.lang}`,
    `D10 (máx. 2 FRAME) e two_sources: ${opts.ignorarD10 ? 'ignorados (--ignorar-d10)' : 'valem (sem --ignorar-d10, o --yes não roda)'}`,
    '',
  ];
  linhas.forEach((l, k) => {
    const sec = l.second?.kind === 'champion_segment' ? ` · 2ª: champion_segment ${l.second.startSec}-${l.second.endSec} s [${l.secondNota}]` : l.template === 'call' ? ' · sem 2ª mídia (slide)' : '';
    const face = l.faceAtSec !== null ? ` · rosto ${l.faceAtSec} s` : '';
    const chamada = l.acao === 'criar' ? (l.template === 'live' ? ' · sem chamada (sem texto)' : ' · 1 chamada') : '';
    out.push(`${String(k + 1).padStart(2)}. ${l.template.padEnd(16)} ${l.acao === 'criar' ? `CRIA  ${l.code}` : 'PULA'}${chamada}${sec}${face}${l.motivo ? ` · ${l.motivo}` : ''}`);
  });
  out.push(
    '',
    `custo estimado: Claude ${e.chamadas} chamadas ${fmt(e.claudeUsd)} (prefixo ~${e.prefixoTok} tok cacheado, pedido ~${e.pedidoTok} tok, saída ${SAIDA_TOK_ESTIMADA} tok, margem ${MARGEM}×)` +
      ` + ${e.renders} renders 9:16 × ${fmt(lote.renderUsd)} = ${fmt(e.renderUsd)} → total ${fmt(e.totalUsd)} (teto ${fmt(TETO_USD)}: ${e.totalUsd <= TETO_USD ? 'cabe' : 'NÃO cabe'})`,
  );
  return out;
}

/** Dry-run: carrega, planeja, estima e mostra. `--yes`: teto → textos → validação → grava. */
export async function executar(deps: Deps, opts: Opcoes): Promise<Resultado> {
  const lote = await deps.carregar();
  const linhas = planejar(lote);
  const estimativa = estimar(lote, linhas);
  for (const s of relatorioPlano(lote, linhas, estimativa, opts)) deps.log(s);
  const res: Resultado = { linhas, estimativa, executado: false, gastoClaudeUsd: 0, fora: [], criadas: [] };
  if (!opts.yes) {
    deps.log('');
    deps.log('dry-run: nada chamado, nada criado. Rodar de verdade: --yes --ignorar-d10');
    return res;
  }
  if (!opts.ignorarD10) throw new Error('--yes precisa de --ignorar-d10 (passa por cima do máx. de 2 FRAME por lote só neste script)');
  if (estimativa.totalUsd > TETO_USD) throw new Error(`estimativa ${fmt(estimativa.totalUsd)} acima do teto de ${fmt(TETO_USD)}: nada foi chamado`);
  await deps.tetoDoWorkspace(lote.workspaceId, estimativa.totalUsd);
  res.executado = true;

  // textos: a 1ª chamada sozinha (grava o cache do prefixo), as outras em paralelo; teto checado com o gasto REAL
  const criar = linhas.filter((l) => l.acao === 'criar');
  const comTexto = criar.filter((l) => l.template !== 'live');
  const alvos = comTexto.map((l, k) => alvoDe(l, k));
  const outrosExistentes: DetailTarget[] = lote.existentes.filter((e) => e.render !== 'FAILED').map((e, k) => ({ ...alvoDe({ template: e.template, whyKey: WHY_DE[e.template] } as LinhaPlano, 100 + k) }));
  const porChamada = estimativa.chamadas ? estimativa.claudeUsd / estimativa.chamadas : 0;
  const escritor = deps.escritor(lote);
  const textos = new Map<FrameTemplateId, Record<string, unknown>>();
  let feitas = 0;
  const escrever = async (alvo: DetailTarget) => {
    const restante = (alvos.length - feitas) * porChamada + estimativa.renderUsd;
    if (res.gastoClaudeUsd + restante > TETO_USD) {
      res.fora.push({ template: alvo.template!, motivo: `teto: gasto real ${fmt(res.gastoClaudeUsd)} + restante ${fmt(restante)} > ${fmt(TETO_USD)}` });
      return;
    }
    feitas++;
    let ultimo: Error | null = null;
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      try {
        const r = await escritor.escrever(alvo, outrosExistentes);
        res.gastoClaudeUsd = r4(res.gastoClaudeUsd + r.costUsd);
        textos.set(alvo.template!, r.frame);
        return;
      } catch (e) {
        ultimo = e as Error;
      }
    }
    res.fora.push({ template: alvo.template!, motivo: `a chamada de detalhe falhou 2x: ${ultimo?.message}` });
  };
  if (alvos.length) await escrever(alvos[0]);
  await emLotes(alvos.slice(1), PARALELO, (a) => escrever(a));

  // leitura (ia) → validação (regras.ts) → FrameSpec (regras.ts) + 2ª fonte
  const prontas: PecaPronta[] = [];
  let index = lote.maxIndex;
  for (const l of criar) {
    if (res.fora.some((f) => f.template === l.template)) continue;
    const frame = l.template === 'live' ? {} : textos.get(l.template);
    if (!frame) continue;
    const draft = frameParamsOf({ template: l.template, frame }, FRAME_TEMPLATES, lote.offer);
    if (!draft) {
      res.fora.push({ template: l.template, motivo: 'faltou texto obrigatório na resposta (frameParamsOf)' });
      continue;
    }
    const vs = validarMoldura(draft, l, lote.ctx, opts);
    if (vs.length) {
      res.fora.push({ template: l.template, motivo: vs.map((v) => `${v.rule}: ${v.detail}`).join('; ') });
      continue;
    }
    const params = { ...frameSpecOf(draft, lote.ctx), second: l.second };
    prontas.push({ template: l.template, code: l.code!, index: ++index, whyKey: l.whyKey, change: changeDe(l.template), rationale: RATIONALE, params });
  }

  // renders: só o que ainda cabe no teto com o gasto real do Claude
  const cabem = Math.max(0, Math.floor((TETO_USD - res.gastoClaudeUsd) / Math.max(lote.renderUsd, 1e-9)));
  for (const p of prontas.splice(cabem)) res.fora.push({ template: p.template, motivo: `teto: sem saldo pro render depois de ${fmt(res.gastoClaudeUsd)} de Claude` });
  if (prontas.length) res.criadas = await deps.gravar(lote, prontas);

  deps.log('');
  deps.log(`Claude real: ${fmt(res.gastoClaudeUsd)} · renders enfileirados: ${res.criadas.length} × ~${fmt(lote.renderUsd)}`);
  for (const c of res.criadas) deps.log(`  ${c.code}: item ${c.itemId} · criativo ${c.creativeId} · render ${c.renderId} (QUEUED, 9:16, prioridade 0)`);
  for (const f of res.fora) deps.log(`  FORA ${f.template}: ${f.motivo}`);
  return res;
}

// ───────── --rerender (feedback do Gusta 25/10: 2ª fonte nova + contentBox) ─────────

/** Teto do re-render das molduras do lote (pedido do Gusta 25/10). */
export const TETO_RERENDER_USD = 2;
/** Seleção do b-roll por visão (Haiku, ~6 folhas de quadros × US$ 0,004, §B3.1) por moldura de 2 fontes. */
export const BROLL_USD_POR_PECA = 0.03;
/** 25/10 (trilha): só as 6 de 2 fontes, teto US$ 1 (pedido do Gusta). */
export const TETO_RERENDER_DUAS_FONTES_USD = 1;
/** Sonda da ia (25/10): ~US$ 0,013 por trecho escolhido; imagem de reserva US$ 0,22 (no máx. IMAGENS_POR_TRILHA por lote). */
export const TRILHA_USD_POR_TRECHO = 0.013;

export interface LinhaRerender {
  template: FrameTemplateId; code: string; itemId: string; creativeId: string; creativeState: string | null;
  duasFontes: boolean; acao: 'refazer' | 'pular'; motivo: string | null;
}

/** As peças FRAME do lote com criativo; render no ar = pular (não empilha). Puro. */
export function planejarRerender(lote: LoteDados, o: { soDuasFontes?: boolean; novaTrilha?: boolean; semImagem?: boolean } = {}): { linhas: LinhaRerender[]; usd: number; trechos: number } {
  const linhas = lote.existentes.filter((e) => !o.soDuasFontes || (FRAME_DUAS_FONTES as readonly string[]).includes(e.template)).map((e): LinhaRerender => {
    const base = {
      template: e.template, code: e.code, itemId: e.itemId ?? '', creativeId: e.creativeId ?? '', creativeState: e.creativeState ?? null,
      duasFontes: (FRAME_DUAS_FONTES as readonly string[]).includes(e.template),
    };
    if (!e.itemId || !e.creativeId) return { ...base, acao: 'pular', motivo: 'sem criativo (o lote não lançou essa peça)' };
    if (e.render === 'QUEUED' || e.render === 'RENDERING') return { ...base, acao: 'pular', motivo: `render ${e.render} no ar` };
    return { ...base, acao: 'refazer', motivo: null };
  });
  const refazer = linhas.filter((l) => l.acao === 'refazer');
  // trilha: 1 busca por LOTE (reaproveitada); já gravada e sem --nova-trilha = custo 0; pior caso com as imagens de reserva
  const trechos = cortarFala(lote.ctx.words, { startSec: 0, endSec: lote.ctx.durationSec }).length;
  const comTrilha = refazer.some((l) => l.duasFontes) && (o.novaTrilha || !lote.trilhaSalva);
  const trilhaUsd = comTrilha ? trechos * TRILHA_USD_POR_TRECHO + (o.semImagem ? 0 : IMAGENS_POR_TRILHA * IMAGEM_RESERVA_USD) : 0;
  const usd = r4(refazer.length * lote.renderUsd + trilhaUsd);
  return { linhas, usd, trechos };
}

export async function executarRerender(deps: Deps, opts: Opcoes): Promise<{ linhas: LinhaRerender[]; usd: number; enfileirados: { code: string; renderId: string }[] }> {
  const lote = await deps.carregar();
  const { linhas, usd, trechos } = planejarRerender(lote, opts);
  const teto = opts.soDuasFontes ? TETO_RERENDER_DUAS_FONTES_USD : TETO_RERENDER_USD;
  deps.log(`lote ${lote.batchId}: ${linhas.filter((l) => l.acao === 'refazer').length} moldura(s) pra re-renderizar · estimativa ${fmt(usd)} (teto ${fmt(teto)})`);
  deps.log(`  trilha de b-roll: ${trechos} trechos de 2-5 s; ${lote.trilhaSalva && !opts.novaTrilha ? 'a gravada no lote é reaproveitada (US$ 0)' : '1 busca nova pro lote'}`);
  let k = 0;
  for (const l of linhas) {
    // 25/10 (Gusta): cada moldura de 2 fontes numa variante da trilha (rodízio 0, 1, 2), mesma busca do lote
    const variante = l.duasFontes ? ` · trilha variante ${k++ % VARIANTES}` : '';
    deps.log(`  ${l.code} (${l.template}): ${l.acao}${l.motivo ? ` · ${l.motivo}` : ''}${l.acao === 'refazer' && l.duasFontes ? ' · 2ª fonte: trilha de b-roll Pexels › imagem › trecho do campeão sem repetir' : ''}${variante} · contentBox do editMap`);
  }
  if (!opts.yes) {
    deps.log('');
    deps.log(`dry-run: nada chamado, nada criado. Re-renderizar de verdade: --rerender${opts.soDuasFontes ? ' --so-duas-fontes' : ''}${opts.semImagem ? ' --sem-imagem' : ''} --yes`);
    return { linhas, usd, enfileirados: [] };
  }
  if (usd > teto) throw new Error(`estimativa ${fmt(usd)} acima do teto de ${fmt(teto)}: nada foi feito`);
  if (!deps.rerenderizar) throw new Error('rerenderizar não ligado');
  await deps.tetoDoWorkspace(lote.workspaceId, usd);
  const enfileirados = await deps.rerenderizar(lote, linhas.filter((l) => l.acao === 'refazer'), { novaTrilha: !!opts.novaTrilha, semImagem: !!opts.semImagem });
  for (const e of enfileirados) deps.log(`  ${e.code}: render ${e.renderId} QUEUED (9:16, prioridade 10)`);
  return { linhas, usd, enfileirados };
}

// ───────── ligação real (Nest + Prisma + Anthropic) ─────────

/* istanbul ignore next -- roda só pela linha de comando */
async function main() {
  const args = new Set(process.argv.slice(2));
  const opts: Opcoes = { yes: args.has('--yes'), ignorarD10: args.has('--ignorar-d10'), rerender: args.has('--rerender'), soDuasFontes: args.has('--so-duas-fontes'), novaTrilha: args.has('--nova-trilha'), semImagem: args.has('--sem-imagem') };
  const url = process.env.DATABASE_URL ?? require('dotenv').config({ path: '.env' }).parsed?.DATABASE_URL ?? '';
  const host = (() => { try { const u = new URL(url); return `${u.hostname}:${u.port}${u.pathname}`; } catch { return '?'; } })();
  if (!/^(localhost|127\.0\.0\.1):/.test(host)) throw new Error(`DATABASE_URL não é local (${host}): o script só roda no banco de desenvolvimento`);
  console.log(`banco: ${host} · modo: ${opts.yes ? '--yes (de verdade)' : '--dry-run'}`);
  const { reais } = await import('./molduras-todas.live');
  const { deps, fechar } = await reais();
  try {
    if (opts.rerender) await executarRerender(deps, opts);
    else await executar(deps, opts);
  } finally {
    await fechar();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`erro: ${(e as Error).message}`);
    process.exit(1);
  });
}
