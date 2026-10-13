// variacao-auto-v1 §7.6: funções puras de mídia da variação automática (maquina-video). Sem I/O.
import type { EditMap, TeardownSections, TranscriptWord } from '@maquina/contratos';

export interface Span { startSec: number; endSec: number }

/** Silêncio mínimo entre palavras pra uma emenda limpa (s). Abaixo disso, só se não houver nada melhor perto. */
const PAUSA_MIN = 0.08;
/** Até onde uma borda pode andar procurando uma pausa boa (s). */
const ALCANCE = 1.2;

/**
 * §7.6 snapSpans(spans, words, silences): move cada borda pro meio do silêncio entre palavras mais próximo, NUNCA no
 * meio de uma palavra. Pausa = intervalo entre o fim de uma palavra e o começo da próxima; quando um silêncio medido
 * (silencedetect) cai dentro dela, o meio é o do trecho silencioso de verdade (o Whisper estica a palavra). Prefere pausas
 * ≥ 80 ms a até 1,2 s; sem nenhuma, a pausa mais perto (mesmo colada). Borda antes da 1ª palavra vira 0 (início);
 * borda depois da última fica onde está. Trechos que encostam ou se sobrepõem depois do encaixe são fundidos; vazios saem.
 */
export function snapSpans(spans: Span[], words: TranscriptWord[], silences: Span[]): Span[] {
  const ws = [...words].filter((w) => w.endSec >= w.startSec).sort((a, b) => a.startSec - b.startSec);
  if (!ws.length) return mesclar(spans.map((s) => ({ ...s })));
  const sil = [...silences].sort((a, b) => a.startSec - b.startSec);
  // pausas entre palavras: [fim da i, começo da i+1] (sobreposição do Whisper = pausa de largura 0 no ponto médio)
  const pausas: { a: number; b: number; ponto: number; largura: number }[] = [];
  for (let i = 0; i + 1 < ws.length; i++) {
    let a = ws[i].endSec, b = ws[i + 1].startSec;
    if (b < a) { const m = (a + b) / 2; a = m; b = m; }
    // trecho realmente silencioso dentro da pausa, alargado pro silêncio medido que encosta nas palavras
    let melhor: Span | null = null;
    for (const s of sil) {
      const x = Math.max(a, s.startSec), y = Math.min(b, s.endSec);
      if (y > x && (!melhor || y - x > melhor.endSec - melhor.startSec)) melhor = { startSec: x, endSec: y };
    }
    const r = melhor ?? { startSec: a, endSec: b };
    pausas.push({ a, b, ponto: (r.startSec + r.endSec) / 2, largura: r.endSec - r.startSec });
  }
  const primeira = ws[0].startSec, ultima = ws[ws.length - 1].endSec;

  const encaixar = (t: number): number => {
    if (t <= primeira) return 0;
    if (t >= ultima) return t;
    const perto = pausas.filter((p) => Math.abs(p.ponto - t) <= ALCANCE && p.largura >= PAUSA_MIN);
    const lista = perto.length ? perto : pausas;
    let best = lista[0];
    for (const p of lista) if (Math.abs(p.ponto - t) < Math.abs(best.ponto - t)) best = p;
    return best ? best.ponto : t;
  };
  const r = spans.map((s) => ({ startSec: round3(encaixar(s.startSec)), endSec: round3(encaixar(s.endSec)) }));
  return mesclar(r.filter((s) => s.endSec - s.startSec > 0.05));
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Ordena e funde trechos que se tocam (≤ 1 frame de distância a 30 fps) ou se sobrepõem. */
function mesclar(spans: Span[]): Span[] {
  const s = [...spans].sort((a, b) => a.startSec - b.startSec);
  const out: Span[] = [];
  for (const x of s) {
    const u = out[out.length - 1];
    if (u && x.startSec <= u.endSec + 1 / 30) u.endSec = Math.max(u.endSec, x.endSec);
    else out.push({ ...x });
  }
  return out;
}

/**
 * Snap que preserva a ORDEM (COLD-OPEN: teaser antes do vídeo inteiro): encaixa cada trecho sem fundir com os outros.
 */
export function snapSpansEmOrdem(spans: Span[], words: TranscriptWord[], silences: Span[]): Span[] {
  return spans.map((s) => snapSpans([s], words, silences)[0] ?? s);
}

/** §7.6 hasWrittenHook(editMap, sec): o original já tem gancho escrito (headline/texto queimado, não a legenda) visível
 *  em algum frame dos primeiros `sec` segundos. Sem editMap = false. */
export function hasWrittenHook(editMap: EditMap | null, sec = 3): boolean {
  if (!editMap) return false;
  const lim = Math.round(sec * editMap.fps);
  return editMap.layers.some((l) => l.kind !== 'caption' && l.startFrame < lim && l.endFrame > 0 && (l.text ?? '').trim().length > 0);
}

/** Camada de gancho escrito do original nos primeiros `sec` segundos (a que o HOOK-TEXT tapa), ou null. */
export function writtenHookLayer(editMap: EditMap | null, sec = 3) {
  if (!editMap) return null;
  const lim = Math.round(sec * editMap.fps);
  const cs = editMap.layers.filter((l) => l.kind !== 'caption' && l.startFrame < lim && (l.text ?? '').trim().length > 0);
  cs.sort((a, b) => (a.kind === 'headline' ? -1 : 0) - (b.kind === 'headline' ? -1 : 0) || a.startFrame - b.startFrame);
  return cs[0] ?? null;
}

/**
 * §7.6 hasEndCard(editMap, teardown): o original já fecha com um cartão final. Sim quando (a) uma camada de texto que não
 * é legenda começa nos últimos 4 s e vai até o fim, ou (b) o último bloco do teardown tem texto na tela e o rosto principal
 * não aparece no último 1,5 s (timeline do editMap). Sem nenhum dado = false.
 */
export function hasEndCard(editMap: EditMap | null, teardown: TeardownSections | null): boolean {
  if (editMap) {
    const { fps, frameCount } = editMap;
    const camadaFinal = editMap.layers.some((l) => l.kind !== 'caption' && l.endFrame >= frameCount - 2 && l.startFrame >= frameCount - 4 * fps && (l.text ?? '').trim());
    if (camadaFinal) return true;
  }
  const blocos = teardown?.structure.status === 'ok' ? teardown.structure.data?.blocks ?? [] : [];
  const ult = blocos[blocos.length - 1];
  if (!ult || !ult.onScreen?.trim() || !editMap) return false;
  const fim = editMap.frameCount;
  const corte = fim - Math.round(1.5 * editMap.fps);
  const tl = editMap.timeline ?? editMap.faceTrack.map((s) => ({ startFrame: s.startFrame, endFrame: s.endFrame, kind: s.role ?? 'main' }));
  const rostoNoFim = tl.some((s) => s.kind === 'main' && s.endFrame > corte);
  return !rostoNoFim;
}
