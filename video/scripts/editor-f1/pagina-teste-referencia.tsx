// REFERÊNCIA pro maquina-frontend (aceite (b) do F1): página de teste do Player. Não é compilada aqui.
// No web: 'use client' + dynamic(() => import(...), { ssr: false }), rota sugerida /dev/editor-f1?doc=<nome>&base=basePreto.
// Contrato com o player-prints.mjs: a página expõe window.meta e window.irPara(frame) -> Promise<frame>,
// renderiza o <Player> em tamanho real (1080x1920 CSS px, sem controles), em página sem margem.
'use client';
import React, { useRef, useEffect } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { Criativo, aplicarDoc, carregarFontes, metadadosCriativo } from '@maquina/video/player';
import fx from '@maquina/video/scripts/editor-f1/player-fixtures.json'; // ou copie o JSON pro web

const q = new URLSearchParams(location.search);
const doc = (fx.docs as Record<string, unknown>)[q.get('doc') ?? 'doc-nulo'] as never;
const props = aplicarDoc((fx as any)[q.get('base') ?? 'base'], doc);
const meta = metadadosCriativo(props);

const App = () => {
  const ref = useRef<PlayerRef>(null);
  useEffect(() => {
    (window as any).meta = meta;
    (window as any).irPara = async (frame: number) => {
      await carregarFontes();
      await document.fonts.ready;
      ref.current!.seekTo(frame);
      const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
      await espera(200);
      for (let i = 0; i < 100; i++) {
        const vs = [...document.querySelectorAll('video')];
        if (vs.every((v) => !v.seeking && v.readyState >= 2)) break;
        await espera(100);
      }
      await espera(400);
      return ref.current!.getCurrentFrame();
    };
  }, []);
  return <Player ref={ref} component={Criativo as never} inputProps={props} {...meta} style={{ width: meta.compositionWidth, height: meta.compositionHeight }} acknowledgeRemotionLicense />;
};
export default App;
