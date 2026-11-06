// Editor universal v1 (F-U1): caixas da moldura mexidas/escondidas pelo doc (`MolduraProps.edicao`, montado pelo
// resolverPropsMoldura). Cada template embrulha o elemento de cada slot numa <Camada id="box:card">. Sem edição pra aquela
// camada, a <Camada> devolve os filhos como vieram (nenhum nó a mais no DOM): render de hoje, pixel a pixel.
import React, { createContext, useContext, useMemo } from 'react';
import type { FrameLayout, MolduraProps, Rect } from '../lib/molduras';
import { caixasDaMoldura } from '../lib/editor/moldura';

type CamadaEdicao = NonNullable<MolduraProps['edicao']>['camadas'][number];
const Ctx = createContext<Map<string, CamadaEdicao> | null>(null);

export const EdicaoMoldura: React.FC<{ edicao: MolduraProps['edicao']; children: React.ReactNode }> = ({ edicao, children }) => {
  const m = useMemo(() => (edicao?.camadas.length ? new Map(edicao.camadas.map((c) => [c.id, c])) : null), [edicao]);
  return m ? <Ctx.Provider value={m}>{children}</Ctx.Provider> : <>{children}</>;
};

/**
 * Leva o conteúdo da caixa `de` pra caixa `para` (translação + escala por igual, a partir do canto de cima à esquerda) ou
 * esconde. `fluxo`: o elemento está no fluxo de um flex (story); o embrulho fica no lugar dele e a origem é o próprio canto.
 */
export const Camada: React.FC<{ id: string; fluxo?: boolean; children: React.ReactNode }> = ({ id, fluxo, children }) => {
  const c = useContext(Ctx)?.get(id);
  if (!c) return <>{children}</>;
  if (!c.visible) return null;
  if (!c.para) return <>{children}</>;
  const s = c.para.w / c.de.w;
  const transform = `translate(${c.para.x - c.de.x}px, ${c.para.y - c.de.y}px) scale(${s})`;
  if (fluxo) return <div data-layer={id} style={{ transform, transformOrigin: '0 0' }}>{children}</div>;
  return <div data-layer={id} style={{ position: 'absolute', inset: 0, transform, transformOrigin: `${c.de.x}px ${c.de.y}px` }}>{children}</div>;
};

/** Marcas `data-layer` (sem pixel nenhum) na geometria final de cada camada: o web acha a camada pelo DOM do Player. */
export const MarcasDeCamada: React.FC<{ p: MolduraProps; L: FrameLayout }> = ({ p, L }) => {
  const caixas = useMemo(() => {
    const m = caixasDaMoldura(p, L);
    for (const c of p.edicao?.camadas ?? []) { if (!c.visible) m.delete(c.id); else if (c.para) m.set(c.id, c.para); }
    m.set('video', L.videoBox);
    if (L.secondBox) m.set('video:2', L.secondBox);
    return [...m];
  }, [p, L]);
  return (
    <>
      {caixas.map(([id, r]: [string, Rect]) => (
        <div key={id} data-layer={id} style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, pointerEvents: 'none' }} />
      ))}
    </>
  );
};
