// Ponte entre a fila de render (backend) e a função pura do maquina-video que monta o FrameRenderInput das molduras
// (estatico-montado-e-molduras-v1 §B2: `buildFrameInput(spec, ctx, format)` em api/src/render/frame.ts, membro
// `kind 'frame'` do RenderInput). Token de DI pra o teste poder trocar o builder; o EdicaoModule injeta o do video.
import type { VideoFormat } from '@prisma/client';
import type { FrameSpec } from '../integracoes/contrato';
import type { FrameRenderInput } from '../render/contrato';
import type { AutoEditContext } from './auto-edit-input';
import { championContentOf, type ChampionContent } from './conteudo-campeao';
import type { OpcoesDeBuild } from '../render/frame';

export const FRAME_BUILDER = Symbol('FRAME_BUILDER');

/**
 * (spec da peça, contexto do campeão, formato) → input do render. Erro com `code: 'FRAME_TEXT_OVERFLOW'` = o texto não
 * coube no mínimo de 36 px (peça `failed`, Leave out); qualquer outro erro = RENDER_ERROR.
 */
export type FrameBuilder = (spec: FrameSpec, ctx: AutoEditContext, format: VideoFormat, opts?: OpcoesDeBuild) => FrameRenderInput;

/** FrameSpec a partir do `payload.params` (= FinalParams FRAME do regras.ts, sem `type`/`sources`). */
export function frameSpecOf(params: Record<string, unknown> | null | undefined): FrameSpec {
  const p = (params ?? {}) as Partial<FrameSpec>;
  if (!p.template || !p.texts || !p.brand) throw Object.assign(new Error('peça FRAME sem template/textos/marca'), { code: 'RENDER_ERROR' });
  return {
    template: p.template, texts: p.texts, screenLanguage: p.screenLanguage ?? 'en', brand: p.brand,
    faceAtSec: p.faceAtSec ?? null, second: p.second ?? null, suggestedPrimaryText: p.suggestedPrimaryText ?? null,
  };
}

/**
 * Feedback do Gusta 25/10: o input da moldura leva onde está o vídeo DE VERDADE no campeão (`contentBox`, sem as faixas
 * de headline/letterbox) e a legenda queimada dentro dele (`burnedTextBands`), calculados do editMap pelo backend.
 * TRANSIÇÃO: os dois campos ainda não estão no `MolduraProps`/`FrameRenderInput` do video (render/contrato.ts); vão
 * como extensão até o maquina-video tipar e usar (caixa do vídeo = recorte da contentBox; texto da moldura fora das faixas).
 */
export type FrameRenderInputComConteudo = FrameRenderInput & ChampionContent;

export function comConteudoDoCampeao(builder: FrameBuilder): FrameBuilder {
  return (spec, ctx, format, opts) => {
    const input = builder(spec, ctx, format, opts);
    const c = championContentOf(ctx.editMap ?? null, { width: ctx.source.width, height: ctx.source.height });
    // o que o buildFrameInput do video já calcula (contentBox/burnedTextBands dele) vence; o nosso só preenche o que falta
    return { ...c, ...input } as FrameRenderInputComConteudo;
  };
}
