// kit-marca-v1 (docs/contratos/kit-marca-v1.md, 31/10): kit da marca do cliente (workspace).
// Rotas: GET /brand-kit (todos os papéis), POST /brand-kit/assets, PATCH/DELETE /brand-kit/assets/:id (CLIENT = 403).
import type { FileRef } from './index';

export type BrandAssetKind = 'LOGO' | 'FILE' | 'DEMO_VIDEO';
/** purpose do POST /uploads de cada kind (o upload é o mesmo fluxo da feature 2). */
export const BRAND_UPLOAD_PURPOSE = { LOGO: 'BRAND_LOGO', FILE: 'BRAND_FILE', DEMO_VIDEO: 'BRAND_VIDEO' } as const;
export type BrandUploadPurpose = (typeof BRAND_UPLOAD_PURPOSE)[BrandAssetKind];

export interface BrandAsset {
  id: string;
  kind: BrandAssetKind;
  /** ≤ 80; null = sem rótulo */
  label: string | null;
  file: FileRef;
  /** null = vale pra marca toda */
  offerId: string | null;
  /** só LOGO: até 5 cores dominantes #RRGGBB (vazio = não deu pra medir) */
  colors: string[];
  createdAt: string;
}

/** GET /brand-kit */
export interface BrandKit {
  logo: BrandAsset | null;
  files: BrandAsset[];
  demoVideos: BrandAsset[];
}

/** POST /brand-kit/assets. LOGO troca o logo anterior (1 por cliente). */
export interface CreateBrandAssetBody { kind: BrandAssetKind; uploadId: string; label?: string | null; offerId?: string | null }
/** PATCH /brand-kit/assets/:id (kind e arquivo não mudam: pra trocar, suba outro) */
export interface UpdateBrandAssetBody { label?: string | null; offerId?: string | null }
