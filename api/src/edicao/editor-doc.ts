// Editor no vídeo v1 (docs/contratos/editor-v1.md): peças puras do backend em volta do EditDoc.
// A regra do doc (validar, normalizar, resolver) é do @maquina/video/lib; aqui só o que é do banco e do §3.2.
import type { EditDoc, EditSettings, FileRef, ScratchSource, TranscriptWord } from '@maquina/contratos';
import { Prisma, type File as FileRow, type Scene as SceneRow } from '@prisma/client';
import { num } from '../common/util/format';

/**
 * Só os campos presentes. DTO com `transform: true` vira instância de classe e, com target ES2022+, os campos opcionais
 * declarados existem como `undefined`: espalhar a instância por cima dos ajustes apagaria o resto (ctaText, headline…).
 */
export function definidos<T extends object>(o: T | null | undefined): Partial<T> {
  return Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Estados em que os ajustes de edição (PATCH /edit e PUT /editor) podem mudar: existem depois que as cenas ficaram prontas uma vez. */
export const EDITABLE = ['SCENES_GENERATING', 'SCENES_FAILED', 'EDIT_PENDING', 'RENDERING', 'RENDER_FAILED', 'RENDER_READY'] as const;

/** edit_doc / renders.doc (Json) → EditDoc, ou null. */
export function editDocOf(json: Prisma.JsonValue | null | undefined): EditDoc | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  return json as unknown as EditDoc;
}

/** Doc com alguma mudança (§3.4: doc nulo ou { clips: [], layers: [], captionWords: [] } = render de hoje). */
export function docTemConteudo(json: Prisma.JsonValue | EditDoc | null | undefined): boolean {
  const d = editDocOf(json as Prisma.JsonValue);
  if (!d) return false;
  return (d.clips?.length ?? 0) > 0 || (d.layers?.length ?? 0) > 0 || (d.captionWords?.length ?? 0) > 0 || !!d.trim;
}

/**
 * Json pro Prisma: doc nulo (ou vazio) vira NULL de SQL (`Prisma.DbNull`), não o valor JSON `null`. As leituras
 * (`editDocOf`/`docTemConteudo`) tratam os dois iguais: linha antiga com JSON null = sem ajuste.
 */
export function docJson(doc: EditDoc | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return docTemConteudo(doc) ? (doc as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
}

const vazioParaNull = (d: EditDoc): EditDoc | null => (docTemConteudo(d) ? d : null);

/**
 * §3.2, aplicado no PATCH /edit e no PUT /editor: trocar o template apaga todo `transform` (reposiciona; o web já
 * pediu confirmação); trocar `captionPosition` apaga o `transform` da legenda. O resto do doc fica.
 */
export function aplicarMudancaDeSettings(doc: EditDoc | null, antes: EditSettings, depois: EditSettings): EditDoc | null {
  if (!doc) return null;
  const trocouTemplate = antes.templateId !== depois.templateId;
  const trocouPosicao = antes.captionPosition !== depois.captionPosition;
  if (!trocouTemplate && !trocouPosicao) return doc;
  const layers = (doc.layers ?? [])
    .map((l) => {
      if (!(trocouTemplate || (trocouPosicao && l.id === 'caption')) || l.transform === undefined) return l;
      const { transform: _t, ...resto } = l;
      return resto;
    })
    .filter((l) => Object.keys(l).length > 1);
  return vazioParaNull({ ...doc, layers });
}

/** §3.2: Generate novo (generation + 1) zera cortes e correções; as camadas ficam. */
export function docDeGeracaoNova(json: Prisma.JsonValue | null | undefined): EditDoc | null {
  const d = editDocOf(json);
  if (!d) return null;
  return vazioParaNull({ ...d, clips: [], captionWords: [] });
}

/** Cena pronta pro editor: READY e com clipe. */
export const cenaPronta = (s: Pick<SceneRow, 'status' | 'clipFileId'>) => s.status === 'READY' && !!s.clipFileId;

type CenaDaFonte = Pick<SceneRow, 'id' | 'index' | 'label' | 'attempt' | 'pipeline' | 'takeId' | 'takeStartSec' | 'takeEndSec' | 'clipFileId' | 'thumbnailFileId' | 'words' | 'startSec' | 'endSec'>;

/**
 * Cenas vigentes → ScratchSource (editor-v1 §5.1). Mesmo tempo que o `renderPieces` de hoje, cena a cena:
 * - TAKE_SLICE: a fatia começa em `takeStartSec` no clipe do take; a ÚLTIMA fatia de cada take vai até o fim do arquivo
 *   (ajuste do arquiteto 09/10), pra o `resolverProps` emendar as fatias no clipe inteiro, como hoje.
 * - outras: o clipe inteiro (duração do arquivo; sem ela, endSec − startSec).
 * `fileRef` assina cada arquivo uma vez só (fatias do mesmo take precisam da MESMA URL pra emendar).
 */
export async function montarScratchSource(
  scenes: CenaDaFonte[],
  files: Map<string, FileRow>,
  fileRef: (f: FileRow) => Promise<FileRef>,
  c: { format: ScratchSource['format']; language: string },
): Promise<ScratchSource> {
  const cache = new Map<string, Promise<FileRef>>();
  const ref = (id: string | null): Promise<FileRef | null> => {
    const f = id ? files.get(id) : undefined;
    if (!f) return Promise.resolve(null);
    if (!cache.has(f.id)) cache.set(f.id, fileRef(f));
    return cache.get(f.id)!;
  };
  const out: ScratchSource['scenes'] = [];
  for (const [i, s] of scenes.entries()) {
    const file = s.clipFileId ? files.get(s.clipFileId) : undefined;
    const fileSec = num(file?.durationSec);
    const words = (Array.isArray(s.words) ? s.words : []) as unknown as TranscriptWord[];
    let clipStartSec = 0;
    let durationSec: number;
    if (s.pipeline === 'TAKE_SLICE' && s.takeId) {
      clipStartSec = num(s.takeStartSec) ?? 0;
      const ultimaDoTake = scenes[i + 1]?.takeId !== s.takeId || scenes[i + 1]?.pipeline !== 'TAKE_SLICE';
      const fim = ultimaDoTake && fileSec != null ? fileSec : num(s.takeEndSec) ?? fileSec ?? clipStartSec;
      durationSec = fim - clipStartSec;
    } else {
      durationSec = fileSec ?? (num(s.endSec) ?? 0) - (num(s.startSec) ?? 0);
    }
    const clip = (await ref(s.clipFileId)) ?? { id: '', url: '', mimeType: 'video/mp4' };
    out.push({
      sceneId: s.id, index: s.index, label: s.label, attempt: s.attempt,
      durationSec, clipStartSec, clip, thumbnail: await ref(s.thumbnailFileId),
      words: words.map((w) => ({ word: w.word, startSec: w.startSec, endSec: w.endSec })),
    });
  }
  return { format: c.format, fps: 30, language: c.language, scenes: out };
}
