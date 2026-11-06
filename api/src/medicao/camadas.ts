// Refino por pixel das camadas de texto (§13.2, "layerPresence"): a visão (Claude) dá caixa e intervalo aproximados;
// aqui o intervalo vira número de frame e o fundo chapado vira caixa medida + cor (ou degradê) reconstruída.
// Nada de limiar absoluto na decisão: presença = penhasco na distribuição das distâncias ao frame de referência.
import type { Rect } from '@maquina/contratos';
import { run, streamFrames, type Bins } from './ffmpeg';

// Laço por pixel usa `abs` do módulo, não `Math.abs`: no Jest (vm própria) cada leitura do global `Math` é ~20x mais
// lenta e a API dos int specs travava o event loop por segundos (F3 do QA 01/11). Em node puro dá na mesma.
const abs = Math.abs;

const hex = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
const toHex = (c: number[]) => `#${hex(c[0])}${hex(c[1])}${hex(c[2])}`;

function median(v: number[]): number {
  const a = [...v].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Corte entre "igual à referência" e "diferente": maior salto entre valores ordenados, aceito só se for grande contra
 * a dispersão do grupo de baixo (4x o desvio absoluto mediano + 1 nível) E se o lado de cima mudar uma fração real do
 * contraste do próprio recorte (`contrast` = desvio absoluto médio do recorte de referência; texto que some muda da
 * ordem disso; recompressão/pulsar de brilho muda 1-3 níveis). Sem salto assim = tudo presente.
 * Devolve o maior valor ainda considerado presente.
 */
export function presenceCut(d: number[], contrast = 0): number {
  const s = [...d].sort((a, b) => a - b);
  if (s.length < 2) return Infinity;
  let k = -1, g = 0;
  for (let i = 0; i < s.length - 1; i++) if (s[i + 1] - s[i] > g) { g = s[i + 1] - s[i]; k = i; }
  if (k < 0) return Infinity;
  const low = s.slice(0, k + 1);
  const m = median(low);
  const mad = median(low.map((x) => Math.abs(x - m)));
  return g > 4 * mad + 1 && s[k + 1] >= 0.25 * contrast ? s[k] : Infinity;
}

/** Corrida contígua de frames presentes em volta do frame de referência: [start, end). */
export function presenceRun(d: number[], refFrame: number, contrast = 0): { startFrame: number; endFrame: number } {
  const cut = presenceCut(d, contrast);
  let a = Math.min(Math.max(0, refFrame), d.length - 1), b = a;
  while (a > 0 && d[a - 1] <= cut) a--;
  while (b < d.length - 1 && d[b + 1] <= cut) b++;
  return { startFrame: a, endFrame: b + 1 };
}

/** Distância média por pixel do recorte `box` de cada frame do vídeo ao mesmo recorte no frame `refFrame`. */
export async function boxDistances(bins: Bins, file: string, box: Rect, refFrame: number): Promise<{ d: number[]; contrast: number }> {
  const [r] = await boxDistancesMany(bins, file, null, [{ box, refFrame }]);
  if (r instanceof Error) throw r;
  return r;
}

export interface PedidoPresenca { box: Rect; refFrame: number }

/**
 * `boxDistances` de várias caixas com DUAS decodificações no total, não duas por caixa (F3 do QA 01/11): 1) os frames de
 * referência de todas (select por índice, para no último); 2) uma passada pelo vídeo com split → crop → scale de cada
 * caixa empilhados (vstack). Mesmos pixels do caminho de uma caixa só: o crop/scale de cada ramo é o mesmo e o rgb24 sai
 * do próprio scale. Erro de uma caixa (maior que o quadro, referência além do fim) volta só nela. `frame` = tamanho do
 * quadro (null = não confere; o ffmpeg falha se a caixa não couber).
 */
export async function boxDistancesMany(bins: Bins, file: string, frame: { w: number; h: number } | null, pedidos: PedidoPresenca[]):
  Promise<({ d: number[]; contrast: number } | Error)[]> {
  const res: ({ d: number[]; contrast: number } | Error)[] = pedidos.map(() => new Error('não medida'));
  const itens = pedidos.map((p, k) => {
    const bx = { x: Math.round(p.box.x), y: Math.round(p.box.y), w: Math.max(2, Math.round(p.box.w) & ~1), h: Math.max(2, Math.round(p.box.h) & ~1) };
    // reduz o recorte pra no máximo ~200 px de largura: presença de texto não precisa de resolução cheia
    const f = Math.min(1, 200 / bx.w);
    const sw = Math.max(2, Math.round(bx.w * f)), sh = Math.max(2, Math.round(bx.h * f));
    return { k, bx, sw, sh, ref: Math.max(0, Math.round(p.refFrame)), off: 0 };
  }).filter((it) => {
    if (frame && (it.bx.w > frame.w || it.bx.h > frame.h)) { res[it.k] = new RangeError(`caixa ${it.bx.w}x${it.bx.h} maior que o quadro ${frame.w}x${frame.h}`); return false; }
    return true;
  });
  if (!itens.length) return res;
  const W = Math.max(...itens.map((it) => it.sw));
  let H = 0;
  for (const it of itens) { it.off = H; H += it.sh; }
  const bytes = W * H * 3;
  // um ramo por caixa, empilhados: linha y do bloco da caixa i = linha it.off + y do quadro empilhado
  const grafo = (entrada: string) => {
    if (itens.length === 1) { const it = itens[0]; return `${entrada}crop=${it.bx.w}:${it.bx.h}:${it.bx.x}:${it.bx.y},scale=${it.sw}:${it.sh}:flags=area[out]`; }
    const ramos = itens.map((it, i) => `[r${i}]crop=${it.bx.w}:${it.bx.h}:${it.bx.x}:${it.bx.y},scale=${it.sw}:${it.sh}:flags=area,format=rgb24,pad=${W}:${it.sh}:0:0[c${i}]`);
    return `${entrada}split=${itens.length}${itens.map((_, i) => `[r${i}]`).join('')};${ramos.join(';')};${itens.map((_, i) => `[c${i}]`).join('')}vstack=inputs=${itens.length}[out]`;
  };
  const bloco = (buf: Uint8Array, it: (typeof itens)[number]) => {
    const out = Buffer.alloc(it.sw * it.sh * 3);
    for (let y = 0; y < it.sh; y++) out.set(buf.subarray(((it.off + y) * W) * 3, ((it.off + y) * W + it.sw) * 3), y * it.sw * 3);
    return out;
  };
  const base = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', file, '-an'];
  const saida = ['-map', '[out]', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'];
  // 1. referências: frames por índice (como o select de uma caixa só), na ordem; o ffmpeg para no último
  const refs = [...new Set(itens.map((it) => it.ref))].sort((a, b) => a - b);
  const refBuf = new Map<number, Buffer>();
  let ri = 0;
  await streamFrames(bins.ffmpeg, [...base, '-filter_complex', grafo(`[0:v]select='${refs.map((n) => `eq(n\\,${n})`).join('+')}',`), ...saida.slice(0, 4),
    '-frames:v', String(refs.length), ...saida.slice(4)], bytes, (buf) => { refBuf.set(refs[ri++], Buffer.from(buf)); });
  const vivos: { it: (typeof itens)[number]; ref: Buffer; d: number[]; contrast: number }[] = [];
  for (const it of itens) {
    const rb = refBuf.get(it.ref);
    if (!rb) { res[it.k] = new RangeError(`frame de referência ${it.ref} não existe`); continue; }
    const ref = bloco(rb, it);
    const n = ref.length;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += ref[i];
    mean /= n;
    let contrast = 0;
    for (let i = 0; i < n; i++) contrast += abs(ref[i] - mean);
    vivos.push({ it, ref, d: [], contrast: contrast / n });
  }
  if (!vivos.length) return res;
  // 2. uma passada: cada frame empilhado dá a distância de todas as caixas (1 frame reduzido em memória por vez)
  await streamFrames(bins.ffmpeg, [...base, '-filter_complex', grafo('[0:v]'), ...saida], bytes, (buf) => {
    for (const v of vivos) {
      const { sw, sh, off } = v.it;
      const ref = v.ref, linha = sw * 3;
      let t = 0;
      for (let y = 0; y < sh; y++) {
        const o = (off + y) * W * 3, r = y * linha;
        for (let i = 0; i < linha; i++) t += abs(buf[o + i] - ref[r + i]);
      }
      v.d.push(t / (sw * sh * 3));
    }
  });
  for (const v of vivos) res[v.it.k] = { d: v.d, contrast: v.contrast };
  return res;
}

export interface SolidBackground {
  box: Rect;
  /** hex quando a faixa é de cor única; `linear-gradient(...)` CSS (paradas em px a partir do topo da caixa) quando a
   *  cor muda de linha pra linha (faixa em degradê, ex.: barra vermelha do zap-working-late). Reconstruída das
   *  medianas de cada linha: o texto (minoria dos pixels) some. */
  color: string;
}

/**
 * Fundo chapado de uma camada. Linha de "fundo" = metade ou mais dos pixels perto da mediana da linha. Dentro da caixa
 * aproximada (a do texto, vinda da visão) a linha só conta como fundo se a cor bater com o fundo logo acima/abaixo da
 * caixa (linha cheia de letra tem a mediana na cor da letra) e toda linha entra na caixa final; pra fora
 * dela cresce enquanto houver linha de fundo com a cor andando pouco em relação à última linha de fundo (degradê sim,
 * borda de outra coisa não), pulando até `bridge` linhas de texto se o fundo voltar depois. A cor das linhas de texto
 * é interpolada entre as linhas de fundo vizinhas: o texto antigo some, a faixa é reconstruída. Depois as colunas.
 */
export function solidFromFrame(rgb: Uint8Array, w: number, h: number, approx: Rect, tol = 24): SolidBackground | null {
  const ax0 = Math.max(0, Math.round(approx.x)), ax1 = Math.min(w, Math.round(approx.x + approx.w));
  const ay0 = Math.max(0, Math.round(approx.y)), ay1 = Math.min(h, Math.round(approx.y + approx.h));
  if (ax1 - ax0 < 2 || ay1 - ay0 < 1) return null;
  const lineStats = (y: number) => {
    const rs: number[] = [], gs: number[] = [], bs: number[] = [];
    for (let x = ax0; x < ax1; x++) { const o = (y * w + x) * 3; rs.push(rgb[o]); gs.push(rgb[o + 1]); bs.push(rgb[o + 2]); }
    const m = [median(rs), median(gs), median(bs)];
    let ok = 0;
    for (let i = 0; i < rs.length; i++) if ((abs(rs[i] - m[0]) + abs(gs[i] - m[1]) + abs(bs[i] - m[2])) / 3 < tol) ok++;
    return { m, bg: ok / rs.length >= 0.5, frac: ok / rs.length };
  };
  const step = (a: number[], b: number[]) => (abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])) / 3;
  const st = new Map<number, { m: number[]; bg: boolean; frac: number }>();
  const get = (y: number) => { let v = st.get(y); if (!v) { v = lineStats(y); st.set(y, v); } return v; };
  // semente: a linha MAIS PURA (maior fração de pixels na cor dela) na caixa ou logo acima/abaixo (até a altura da caixa):
  // linha de faixa sem letra é ~100 % uma cor; linha de letra tem a letra misturada (mesmo quando a letra é maioria)
  const folga = Math.max(4, ay1 - ay0);
  const cy = (ay0 + ay1) / 2;
  let semente: [number, number[]] | null = null;
  let melhor = -1;
  for (let y = Math.max(0, ay0 - folga); y < Math.min(h, ay1 + folga); y++) {
    const v = get(y);
    const nota = v.frac - Math.abs(y - cy) / (100 * h);   // empate: a mais perto do centro da caixa
    if (v.bg && nota > melhor) { melhor = nota; semente = [y, v.m]; }
  }
  if (!semente) return null;
  // cresce da semente pros dois lados: aceita linha de fundo com a cor andando pouco (degradê sim, borda não); pula
  // linha de texto (até 60 % da altura da caixa dentro dela; 1 % do quadro fora) se o fundo voltar depois
  const sem = semente;
  const aceitas = new Map<number, number[]>([[sem[0], sem[1]]]);
  // a caixa da visão é aproximada (pode cortar uma linha de texto ao meio, ou ser justa no bloco de texto inteiro):
  // a ponte é a altura da caixa, dentro e fora dela; a continuidade de cor impede atravessar pra outra coisa
  const bridgeOut = Math.max(4, Math.round(h * 0.01), ay1 - ay0);
  const bridgeIn = bridgeOut;
  const grow = (dir: 1 | -1) => {
    let edge = sem[0], last = sem[1], miss = 0;
    for (let y = sem[0] + dir; y >= 0 && y < h; y += dir) {
      const v = get(y);
      if (v.bg && step(v.m, last) <= Math.min(tol, Math.max(12, 3 * Math.abs(y - edge)))) { edge = y; last = v.m; miss = 0; aceitas.set(y, v.m); continue; }
      if (++miss > (y >= ay0 && y < ay1 ? bridgeIn : bridgeOut)) break;
    }
    return edge;
  };
  const y0 = grow(-1), y1 = grow(1);
  // cor por linha: fundo = mediana; texto = interpolada entre as linhas de fundo mais próximas
  const bgRows = [...aceitas.entries()].sort((a, b) => a[0] - b[0]);
  if (!bgRows.length) return null;
  const rows = new Map<number, number[]>();
  let k = 0;
  for (let y = y0; y <= y1; y++) {
    while (k < bgRows.length - 1 && bgRows[k + 1][0] <= y) k++;
    const [ya, ca] = bgRows[k];
    const nxt = bgRows.find(([yy]) => yy >= y) ?? bgRows[bgRows.length - 1];
    if (ya === y || ya > y) { rows.set(y, ya > y ? nxt[1] : ca); continue; }
    const [yb, cb] = nxt;
    const t = yb === ya ? 0 : (y - ya) / (yb - ya);
    rows.set(y, [0, 1, 2].map((c) => ca[c] + (cb[c] - ca[c]) * t));
  }
  // colunas: pixel da coluna perto da cor da SUA linha (linhas de fundo só)
  const colOk = (x: number) => {
    let ok = 0;
    for (const [y, m] of bgRows) { const o = (y * w + x) * 3; if (step([rgb[o], rgb[o + 1], rgb[o + 2]], m) < tol) ok++; }
    return ok / bgRows.length >= 0.5;
  };
  let x0 = Math.round(approx.x + approx.w / 2), x1 = x0;
  while (x0 > 0 && colOk(x0 - 1)) x0--;
  while (x1 < w - 1 && colOk(x1 + 1)) x1++;
  const box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  // faixa de verdade atravessa o texto: cobre ≥ 90 % da largura e ≥ 50 % da altura da caixa da visão. Senão é texto
  // direto sobre o vídeo (gancho sem fundo → background 'none', hook_text_over_video) e não há faixa pra repintar
  const cobreX = Math.max(0, Math.min(x1 + 1, ax1) - Math.max(x0, ax0)) / (ax1 - ax0);
  const cobreY = Math.max(0, Math.min(y1 + 1, ay1) - Math.max(y0, ay0)) / (ay1 - ay0);
  if (cobreX < 0.9 || cobreY < 0.5) return null;
  const all = [...rows.entries()].sort((a, b) => a[0] - b[0]);
  const overall = [0, 1, 2].map((c) => median(all.map(([, m]) => m[c])));
  if (all.every(([, m]) => step(m, overall) < 6)) return { box, color: toHex(overall) };
  const stops: string[] = [];
  let last: number[] | null = null;
  for (const [y, m] of all) {
    if (!last || step(m, last) >= 3 || y === y1) { stops.push(`${toHex(m)} ${y - y0}px`); last = m; }
  }
  return { box, color: `linear-gradient(180deg, ${stops.join(', ')})` };
}

export async function solidBackground(bins: Bins, file: string, info: { w: number; h: number }, atSec: number, approx: Rect):
  Promise<SolidBackground | null> {
  const r = await run(bins.ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-ss', atSec.toFixed(3), '-i', file,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  if (r.stdout.length < info.w * info.h * 3) return null;
  return solidFromFrame(r.stdout, info.w, info.h, approx);
}
