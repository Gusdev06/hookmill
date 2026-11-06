// kit-marca-v1 §5: o que a geração lê do kit. Sem dependência de módulo (as regras puras do iteracao importam daqui).
/** O que a geração lê do kit (porta pra frente: hoje só o logo entra no FrameBrand). */
export interface BrandLogoRef { fileId: string; colors: string[] }

/** Logo do kit a partir das linhas carregadas junto do workspace (`include: { brandAssets: BRAND_LOGO_INCLUDE }`). */
export const BRAND_LOGO_INCLUDE = { where: { kind: 'LOGO' as const }, orderBy: { createdAt: 'desc' as const }, take: 1, select: { fileId: true, colors: true } };
export function brandLogoOf(rows: { fileId: string; colors: string[] }[] | null | undefined): BrandLogoRef | null {
  const r = rows?.[0];
  return r ? { fileId: r.fileId, colors: r.colors ?? [] } : null;
}
