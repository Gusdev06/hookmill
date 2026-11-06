// Editor universal v1 (docs/contratos/editor-universal-v1.md, F-U1): peças PURAS do editor da peça AUTO (FRAME e HEADLINE),
// sem banco: chave do template, vista do export, "dirty" por doc, fatos (números), proveniência dos textos, o que a
// checagem de texto por visão confere e a `PieceEditorView` do card. Testadas em editor-auto.spec.ts.
// A regra do doc (manifesto, resolver, validação, checagens) é do @maquina/video/lib; aqui só o que é do backend.
import type { BrainField, EditMap, EditTemplateKey, EditorExportStage, EditorExportView, PieceEditorView, TextProvenance } from '@maquina/contratos';
import type { VideoFormat } from '@prisma/client';
import { numbersIn } from '../iteracao/regras';
import { docV3TemConteudo, editedFromRenders, frameTemplateOf, isEditorExport, latestReadyByFormat, type PieceRenderState } from './pecas';

/** Tipos AUTO que abrem no editor no F-U1 (§2). Os outros: `editor.available: false` (`auto_type_not_editable`). */
export function templateKeyOf(autoType: string | null | undefined, params: Record<string, unknown> | null | undefined): EditTemplateKey | null {
  if (autoType === 'HEADLINE') return 'headline';
  if (autoType === 'FRAME') {
    const t = frameTemplateOf(params);
    return t ? (`frame:${t}` as EditTemplateKey) : null;
  }
  return null;
}

/** §6.2: rosto no espaço da guarda (px e fps do arquivo). O editMap pode ter sido medido em outra grade. */
export function faceTrackDoArquivo(m: EditMap | null, source: { width: number; height: number; fps: number }): EditMap['faceTrack'] {
  if (!m) return [];
  const ex = source.width / m.width, ey = source.height / m.height, ef = source.fps / (m.fps || source.fps);
  if (ex === 1 && ey === 1 && ef === 1) return m.faceTrack;
  return m.faceTrack.map((s) => ({
    ...s,
    startFrame: s.startFrame * ef, endFrame: s.endFrame * ef,
    region: { x: s.region.x * ex, y: s.region.y * ey, w: s.region.w * ex, h: s.region.h * ey },
    faceInRegion: s.faceInRegion.map((q) => ({ ...q, atFrame: q.atFrame * ef })),
  }));
}

/** Falhas do export que o "Retry check" refaz no mesmo arquivo (§9.4). */
export const RECHECKABLE_CODES = new Set(['CAPTION_COVERED', 'TEXT_MISMATCH']);

/** `renders.fail_detail` (§9.4). */
export interface ExportFailDetail { rule: string; atSec: number | null; layerId: string | null }

export interface ExportRenderRow {
  id: string; status: string; stage: string | null; progress: number; errorCode: string | null; failDetail: unknown;
  fileId: string | null; editRevision: number | null; startedAt: Date | null; createdAt: Date; finishedAt?: Date | null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Render de export → `EditorExportView` (§7.2, SSE `editor.export`). QUEUED = 'saving' (o snapshot do doc já foi gravado). */
export function exportViewOf(r: ExportRenderRow): EditorExportView {
  const stage: EditorExportStage = r.status === 'READY' ? 'done' : r.status === 'FAILED' ? 'failed' : r.status === 'QUEUED' ? 'saving'
    : r.stage === 'caption_check' || r.stage === 'text_check' ? r.stage : 'rendering';
  const detail = (r.failDetail ?? null) as Partial<ExportFailDetail> | null;
  const code = r.errorCode ?? 'RENDER_ERROR';
  return {
    renderId: r.id,
    revision: r.editRevision ?? 0,
    stage,
    progress: stage === 'done' ? 100 : stage === 'saving' ? 0 : Math.max(0, Math.min(100, r.progress)),
    error: stage === 'failed'
      ? { code, atSec: typeof detail?.atSec === 'number' ? detail.atSec : null, layerId: typeof detail?.layerId === 'string' ? detail.layerId : null, canRecheck: RECHECKABLE_CODES.has(code) && !!r.fileId }
      : null,
    startedAt: (r.startedAt ?? r.createdAt).toISOString(),
  };
}

type ExportCandidate = ExportRenderRow & PieceRenderState & { settings: unknown; doc: unknown };

/** §7.2 `export`: o export em curso ou o último que falhou (mais novo que o último que passou); null = nada pendente. */
export function pendingExportOf<R extends ExportCandidate>(renders: R[]): R | null {
  const exps = renders.filter((r) => isEditorExport(r.settings)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const last = exps[exps.length - 1];
  return last && last.status !== 'READY' ? last : null;
}

/** Último export que passou (READY) no formato principal: o doc dele é o "exportado". */
export function lastPassedExportOf<R extends ExportCandidate>(renders: R[], primary: VideoFormat): R | null {
  const r = latestReadyByFormat(renders.filter((x) => isEditorExport(x.settings))).get(primary);
  return r ?? null;
}

/** JSON com chaves em ordem (comparação de doc independente da ordem dos campos). */
function estavel(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(estavel);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, estavel((v as Record<string, unknown>)[k])]));
  return v;
}
/** Os dois docs mudam a peça do mesmo jeito (vazio = null). */
export function sameDoc(a: unknown, b: unknown): boolean {
  const x = docV3TemConteudo(a) ? a : null, y = docV3TemConteudo(b) ? b : null;
  return JSON.stringify(estavel(x)) === JSON.stringify(estavel(y));
}

/**
 * §7.2 `dirty` / §7.5 `pendingExport`: o doc salvo ≠ o doc do último export que passou (nunca exportado = doc salvo com
 * conteúdo). "Discard edits" que volta ao exportado deixa de ser pendente; desfazer até o doc vazio também.
 */
export function pendingFromDocs(savedDoc: unknown, exportedDoc: unknown): boolean {
  return !sameDoc(savedDoc, exportedDoc);
}

/** §7.2 `facts.numbers`: números da fala, do CTA falado e do Brain, com a normalização do `numbersIn` (= inventedNumbers). */
export function factsNumbersOf(src: { brain: Record<string, string | null | undefined>; spokenCta: string | null; words: { word: string }[] }): string[] {
  const textos = [...Object.values(src.brain), src.spokenCta, src.words.map((w) => w.word).join(' ')].filter((s): s is string => !!s && !!s.trim());
  return [...new Set(textos.flatMap(numbersIn))].sort();
}

const BRAIN: ReadonlySet<string> = new Set(['what', 'audience', 'pains', 'promise', 'proof', 'offerAndPrice', 'cta', 'notes', 'page']);

/** Caminho do `sources` do plano ("headline", "items.0", "price.to") → caminho do editor (`layer:slot:*` / `item:slot:*\/iN`). */
export function editorPathOfSource(p: string, textos: ReadonlyMap<string, string>, kind: 'frame' | 'headline'): string | null {
  if (kind === 'headline') return 'layer:headline';
  const m = /^(.*)\.(\d+)$/.exec(p);
  if (m) {
    const item = `item:slot:${m[1]}/i${Number(m[2]) + 1}`;
    if (textos.has(item)) return item;
  }
  const layer = `layer:slot:${p}`;
  return textos.has(layer) ? layer : null;
}

/**
 * §7.2 `provenance`: de onde veio cada texto (o plano tem `sources` por caminho; o resto = 'template'). `original` = o texto
 * que a IA escreveu (o da base). Sem citação da fala no F-U1 (`quote` só com campo do Brain).
 */
export function provenanceOf(
  textos: ReadonlyMap<string, string>, sources: Record<string, unknown> | null | undefined, brain: Record<string, string | null | undefined>, kind: 'frame' | 'headline',
): Record<string, TextProvenance> {
  const out: Record<string, TextProvenance> = {};
  for (const [path, original] of textos) out[path] = { source: 'template', field: null, quote: null, anchorWordIndex: null, original };
  for (const [p, s] of Object.entries(sources ?? {})) {
    const path = editorPathOfSource(p, textos, kind);
    if (!path || typeof s !== 'string') continue;
    const original = textos.get(path) ?? '';
    if (s === 'transcript') out[path] = { source: 'transcript', field: null, quote: null, anchorWordIndex: null, original };
    else if (s === 'generic') out[path] = { source: 'generic', field: null, quote: null, anchorWordIndex: null, original };
    else if (s === 'name') out[path] = { source: 'brain', field: 'name', quote: null, anchorWordIndex: null, original };
    else if (BRAIN.has(s)) {
      const q = brain[s];
      out[path] = { source: 'brain', field: s as BrainField, quote: q && q.trim() ? q.trim().slice(0, 120) : null, anchorWordIndex: null, original };
    } else out[path] = { source: 'brain', field: null, quote: null, anchorWordIndex: null, original };
  }
  return out;
}

/** Texto que a checagem por visão confere depois do render (D-E1-5: só os editados). `key` = caminho do editor. */
export interface EditedTextCheck { key: string; text: string; layerId: string; atSec: number }

/**
 * Do resultado do resolver: os textos EDITADOS e visíveis, cada um com um instante em que ele está na tela (1 s depois de
 * aparecer, ou o meio do intervalo se for curto). Sem `*` (marcação do destaque).
 */
export function editedTextsToCheck(r: { layout: { layers: { id: string; fromSec: number; toSec: number; visible: boolean }[] }; textos: { path: string; layerId: string; text: string; edited: boolean }[] }): EditedTextCheck[] {
  const camadas = new Map(r.layout.layers.map((l) => [l.id, l]));
  const out: EditedTextCheck[] = [];
  for (const t of r.textos) {
    const l = camadas.get(t.layerId);
    const text = t.text.replace(/\*/g, '').trim();
    if (!t.edited || !l || !l.visible || !text || l.toSec <= l.fromSec) continue;
    out.push({ key: t.path, text, layerId: t.layerId, atSec: r2(l.fromSec + Math.min(1, (l.toSec - l.fromSec) / 2)) });
  }
  return out;
}

/** troca-texto-queimado-v1 §15.3.1: HEADLINE `replace` antigo não abre no editor, porque não tem build até o F1b. */
export function headlineRetiredOf(autoType: string | null | undefined, params: Record<string, unknown> | null | undefined): boolean {
  return autoType === 'HEADLINE' && params?.mode !== 'add';
}

/** §7.5 `IteratePiece.editor`. `renders` = TODOS os não stale (inclusive exports em curso/reprovados). */
export function pieceEditorViewOf(i: {
  key: EditTemplateKey | null; status: string; locked: boolean; editDoc: unknown; primary: VideoFormat;
  renders: ExportCandidate[]; headlineRetired?: boolean;
}): PieceEditorView {
  const reason: PieceEditorView['reason'] = !i.key ? 'auto_type_not_editable' : i.headlineRetired ? 'headline_plate_retired' : i.locked ? 'sample_locked' : i.status !== 'ready' ? 'piece_not_ready' : null;
  const exported = lastPassedExportOf(i.renders, i.primary);
  const pend = pendingExportOf(i.renders);
  return {
    available: reason === null,
    reason,
    edited: editedFromRenders(i.renders, i.primary),
    pendingExport: !!i.key && pendingFromDocs(i.editDoc, exported?.doc ?? null),
    export: pend ? exportViewOf(pend) : null,
  };
}

/** Início do dia UTC (limite de exports por workspace por dia, §7.1). */
export function utcDayStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
