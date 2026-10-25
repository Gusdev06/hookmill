// Entrada "pura" do @maquina/video (sem React): o que a API importa.
// A composição em si mora em src/index.ts (registerRoot) e vai pro bundle.
import { FPS } from './formatos';
import { criativoSchema, type CriativoProps } from './schema';

export * from './formatos';
export * from './schema';
export * from './templates';
export * from './tempo';
export * from './legenda';
export * from './remix';
export * from './editor';
export * from './autoEdit';
export * from './cores';
export * from './molduras';

/** id da composição registrada no bundle (selectComposition / renderMedia / Lambda). */
export const COMPOSITION_ID = 'Criativo';

/** Forma do RenderInput do contrato (§2.2), sem importar da api. */
export type RenderInputLike = Omit<CriativoProps, 'templateId'> & { templateId: string; renderId?: string; fps?: number };

/** Converte o RenderInput do contrato nas props da composição, validando (templateId desconhecido = erro). */
export const propsDeRenderInput = (input: RenderInputLike): CriativoProps => {
  if (input.fps !== undefined && input.fps !== FPS) throw new Error(`fps ${input.fps} não suportado (só ${FPS})`);
  const { renderId: _r, fps: _f, kind: _k, ...resto } = input as RenderInputLike & { kind?: string };
  return criativoSchema.parse(resto);
};
