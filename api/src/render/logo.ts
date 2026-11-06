/**
 * kit-marca-v1 §5 (31/10): logo do kit da marca → `BrandLogo` do render (URL assinada + cores dominantes), resolvido NA HORA
 * de montar o input (a spec gravada no plano guarda só o `logoFileId`; a URL vence).
 *
 * - Peça com marca na spec (FRAME, CHAT_DM, PERSON_MOTION: `params.brand`): vale o `logoFileId` gravado. Ausente/null = sem
 *   logo, mesmo que o kit ganhe um depois (a peça sai como foi planejada).
 * - Peça sem marca na spec (auto-edit: STORY, ENDCARD…): o logo atual do kit do workspace.
 * - Arquivo de outro workspace, sumido do storage ou que não é imagem = sem logo (iniciais), nunca erro do render.
 * Cores: as do `brand_assets` do mesmo arquivo (o asset pode ter sido apagado; o File fica: aí `[]`, placa clara).
 */
import type { BrandLogo } from '@maquina/video';

type FileLinha = { id: string; workspaceId: string; storageKey: string; mimeType: string | null };
export interface LogoDeps {
  prisma: {
    file: { findUnique(a: { where: { id: string } }): Promise<FileLinha | null> };
    brandAsset: {
      findFirst(a: { where: Record<string, unknown>; orderBy?: Record<string, 'asc' | 'desc'>; select: { fileId: true; colors: true } }): Promise<{ fileId: string; colors: string[] } | null>;
    };
  };
  storage: { head(key: string): Promise<unknown | null>; signedUrl(f: { storageKey: string }): Promise<string> };
}

const IMAGEM = /^image\/(png|jpeg|webp|svg\+xml)$/;

/** `logoFileId` que a peça deve usar: o da spec quando a spec tem marca; senão, o logo atual do kit. */
export async function logoFileIdDaPeca(d: LogoDeps, workspaceId: string, params: unknown): Promise<string | null> {
  const brand = (params as { brand?: { logoFileId?: string | null } } | null)?.brand;
  if (brand && typeof brand === 'object') return brand.logoFileId ?? null;
  const kit = await d.prisma.brandAsset.findFirst({ where: { workspaceId, kind: 'LOGO' }, orderBy: { createdAt: 'desc' }, select: { fileId: true, colors: true } });
  return kit?.fileId ?? null;
}

export async function resolverLogoDaMarca(d: LogoDeps, workspaceId: string, params: unknown): Promise<BrandLogo | null> {
  try {
    return await resolver(d, workspaceId, params);
  } catch {
    return null; // logo é enfeite: falha ao resolver não derruba a peça (sai com as iniciais)
  }
}

async function resolver(d: LogoDeps, workspaceId: string, params: unknown): Promise<BrandLogo | null> {
  const fileId = await logoFileIdDaPeca(d, workspaceId, params);
  if (!fileId) return null;
  const f = await d.prisma.file.findUnique({ where: { id: fileId } });
  if (!f || f.workspaceId !== workspaceId || !IMAGEM.test(f.mimeType ?? '')) return null;
  if (!(await d.storage.head(f.storageKey))) return null;
  const asset = await d.prisma.brandAsset.findFirst({ where: { workspaceId, fileId }, select: { fileId: true, colors: true } });
  return { url: await d.storage.signedUrl(f), colors: (asset?.colors ?? []).slice(0, 5) };
}
