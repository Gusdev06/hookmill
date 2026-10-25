// §A6 (estatico-montado-e-molduras-v1): checagem de texto do STATIC por visão. O Claude (modelo barato) só TRANSCREVE o
// que está escrito na imagem pra cada texto esperado, sem corrigir; quem compara (NFC, caixa/espaço ignorados, acento
// conta) é o backend (`compararTexto`). Saída estruturada (JSON Schema), nunca texto pra parsear na mão.
// Imagem: o 2k 9:16 (1440×2560, ~5 MB em PNG) passa do limite de 5 MB por imagem e o Claude reduziria pra 882×1568, onde
// acento pequeno some. Por isso vai em 2 metades sobrepostas (≤ 1568 px no lado maior cada), em JPEG, pelo ffmpeg.
import { spawn } from 'node:child_process';
import type { CheckStaticTextInput, CheckStaticTextResult } from '../contrato';
import { IntegracaoError } from '../erros';
import { STATIC_TEXT_CHECK_MODEL } from '../catalogo/precos';
import { parseJsonObject } from './validacao-campeao';
import type { ClaudeImage } from './transporte';

const obj = (properties: Record<string, object>, description?: string) => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties, ...(description ? { description } : {}),
});

export const TEXT_CHECK_SCHEMA = obj({
  items: {
    type: 'array',
    description: 'One entry per expected text, same keys, same order.',
    items: obj({
      key: { type: 'string', description: 'The key of the expected text.' },
      found: { type: 'boolean', description: 'true when this text (or a misspelled version of it) is written in the image.' },
      seen: { type: 'string', description: 'Exactly what is written in the image for this text, character by character, with the accents as drawn. Empty string when not found.' },
    }),
  },
  extraText: { type: 'array', items: { type: 'string' }, description: 'Any other words written in the image that match none of the expected texts. Empty list when none.' },
});

export const TEXT_CHECK_SYSTEM = `You proofread the text rendered inside an ad image made by an image model. You get the list of texts that should be in the image, each with a key. For each one, find it in the image and transcribe EXACTLY what is drawn, character by character: keep every accent mark as drawn (an accent that should not be there, or a missing one, must show in your transcription), keep wrong letters, doubled or missing words. Never correct, never normalize, never copy the expected text when the image differs. Line breaks become single spaces; letter case does not matter. When a text is not in the image at all, found is false and seen is empty. In extraText list any other words written in the image (not icons, not the shapes of an interface). The image may come in two overlapping parts: a text cut by the edge of one part is whole in the other.`;

export function textCheckUserMessage(i: Pick<CheckStaticTextInput, 'expected' | 'language'>, parts: number): string {
  return [
    `Language of the texts: ${i.language}.`,
    parts > 1 ? `The image comes in ${parts} overlapping parts, top first.` : 'The image comes whole.',
    `<expected>\n${i.expected.map((e) => `${e.key}: ${e.text}`).join('\n')}\n</expected>`,
    'Transcribe what is drawn for each key.',
  ].join('\n\n');
}

const s = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const o = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Um item por chave esperada, na ordem; chave que o modelo esqueceu = não achada. */
export function parseTextCheck(text: string, expected: CheckStaticTextInput['expected']): CheckStaticTextResult {
  const root = parseJsonObject(text);
  const byKey = new Map<string, { found: boolean; seen: string | null }>();
  for (const it of (Array.isArray(root.items) ? root.items : []).map(o)) {
    const key = s(it.key);
    if (!key || byKey.has(key)) continue;
    const seen = s(it.seen);
    byKey.set(key, { found: it.found === true && !!seen, seen: seen || null });
  }
  return {
    items: expected.map((e) => ({ key: e.key, found: byKey.get(e.key)?.found ?? false, seen: byKey.get(e.key)?.found ? byKey.get(e.key)!.seen : null })),
    extraText: (Array.isArray(root.extraText) ? root.extraText : []).map(s).filter(Boolean).slice(0, 20),
  };
}

// ---------------------------------------------------------------- imagem

/** Largura × altura do PNG (IHDR) ou do JPEG (SOFn); null se não reconhecer. */
export function imageSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length > 24 && buf[0] === 0x89 && buf.subarray(1, 4).toString() === 'PNG') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const m = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}

/** Recortes (fração da altura) que vão pro Claude: retrato alto = 2 metades com 10 % de sobreposição. */
export function cropPlan(size: { w: number; h: number } | null): { y0: number; y1: number }[] {
  if (size && size.h > size.w * 1.4) return [{ y0: 0, y1: 0.55 }, { y0: 0.45, y1: 1 }];
  return [{ y0: 0, y1: 1 }];
}

export type RunFfmpeg = (args: string[], input: Buffer) => Promise<Buffer>;

export function ffmpegRunner(bin: string, timeoutMs = 30_000): RunFfmpeg {
  return (args, input) =>
    new Promise((resolve, reject) => {
      const p = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      const out: Buffer[] = [];
      let err = '';
      const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
      p.stdout.on('data', (d: Buffer) => out.push(d));
      p.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-2000)));
      p.on('error', (e) => { clearTimeout(timer); reject(e); });
      p.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && out.length) resolve(Buffer.concat(out));
        else reject(new Error(`ffmpeg exited ${code}: ${err.trim().split('\n').pop() ?? ''}`));
      });
      p.stdin.on('error', () => undefined); // ffmpeg pode fechar o stdin antes (erro já sai no close)
      p.stdin.end(input);
    });
}

/** Limite seguro de bytes por imagem crua (o da API é 5 MB por imagem). */
const MAX_RAW = 3_700_000;

/** Imagem → 1 ou 2 recortes JPEG com lado maior ≤ 1568 px. Sem ffmpeg: a original, se couber; senão erro (o backend
 *  marca a checagem como `skipped`). */
export async function prepareCheckImages(buf: Buffer, run: RunFfmpeg | null): Promise<ClaudeImage[]> {
  const size = imageSize(buf);
  const plan = cropPlan(size);
  const max = STATIC_TEXT_CHECK_MODEL.maxSidePx;
  if (run) {
    try {
      const parts = await Promise.all(
        plan.map(({ y0, y1 }) => {
          const crop = `crop=iw:trunc(ih*${(y1 - y0).toFixed(2)}/2)*2:0:trunc(ih*${y0.toFixed(2)}/2)*2`;
          const scale = `scale='if(gt(iw,ih),min(${max},iw),-2)':'if(gt(iw,ih),-2,min(${max},ih))'`;
          return run(['-hide_banner', '-v', 'error', '-i', 'pipe:0', '-vf', `${crop},${scale}`, '-frames:v', '1', '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '2', 'pipe:1'], buf);
        }),
      );
      return parts.map((p, k) => ({ mediaType: 'image/jpeg', data: p.toString('base64'), caption: plan.length > 1 ? `Part ${k + 1} of ${plan.length} (${k === 0 ? 'top' : 'bottom'}):` : 'The ad image:' }));
    } catch (e) {
      if (buf.length > MAX_RAW) throw new IntegracaoError('PROVIDER_ERROR', `text check: could not shrink the image (${(e as Error).message})`);
    }
  }
  if (buf.length > MAX_RAW) throw new IntegracaoError('PROVIDER_ERROR', `text check: image too large (${buf.length} bytes) and no ffmpeg`);
  const png = buf[0] === 0x89;
  return [{ mediaType: png ? 'image/png' : 'image/jpeg', data: buf.toString('base64'), caption: 'The ad image:' }];
}

/** Haiku 4.5 recusa `effort`; os modelos novos aceitam (low basta pra transcrever). */
export function textCheckEffort(model: string): 'low' | null {
  return /haiku-4-5/.test(model) ? null : 'low';
}
