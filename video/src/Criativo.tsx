import React, { useEffect, useState } from 'react';
import { AbsoluteFill, continueRender, delayRender, Sequence, useVideoConfig } from 'remotion';
import { Cenas } from './componentes/Cenas';
import { Cta } from './componentes/Cta';
import { EndCard } from './componentes/EndCard';
import { Gancho } from './componentes/Gancho';
import { Legenda } from './componentes/Legenda';
import { ESTILOS, ZONAS } from './estilos';
import { carregarFonteCatalogo, carregarFontes, carregarFontesCJK } from './fontes';
import { temCJK } from './lib/molduras';
import { framesCta, framesDasCenas, framesEndCard, framesGancho, layoutPadrao, linhaDoTempo, templatePorId, type CriativoProps, type FontId, type LayerTransform } from './lib';

void carregarFontes();

/** Fontes do catálogo pedidas pelo estilo das camadas (editor): segura o frame até carregarem (render e Player). */
const FontesDasCamadas: React.FC<{ ids: FontId[] }> = ({ ids }) => {
  const chave = [...new Set(ids)].sort().join(',');
  const [handle] = useState(() => delayRender(`fontes do editor ${chave}`));
  useEffect(() => {
    Promise.all(chave.split(',').map((id) => carregarFonteCatalogo(id as FontId)))
      .catch((e) => console.error(e))
      .finally(() => continueRender(handle));
  }, [chave, handle]);
  return null;
};

/** Texto CJK (legenda, gancho, CTA): registra a Noto do idioma e baixa os pedaços antes do 1º frame (headline-e-legenda-v1 §2.2). */
const FontesCJK: React.FC<{ language: string; texto: string }> = ({ language, texto }) => {
  const [handle] = useState(() => delayRender('fontes CJK'));
  useEffect(() => {
    carregarFontes().then(() => carregarFontesCJK(language, texto)).catch((e) => console.error(e)).finally(() => continueRender(handle));
  }, [handle, language, texto]);
  return null;
};

/** Composição única da Máquina: o template é escolhido por props (a mesma vai pro Lambda no futuro e pro Player do editor).
 *  `props.layers` (editor) vem resolvido pelo aplicarDoc/resolverProps; camada ausente = posição e tempo de hoje. */
export const Criativo: React.FC<CriativoProps> = (props) => {
  const { fps } = useVideoConfig();
  const estilo = ESTILOS[props.templateId];
  const totalCenas = framesDasCenas(props.scenes, fps);
  const fimEnd = framesEndCard(props.endCard, fps);
  const L = props.layers ?? {};
  const padrao = layoutPadrao(props.templateId, props.format, props, totalCenas / fps);

  const textoGancho = templatePorId(props.templateId)?.supportsHeadline && props.headline?.trim() ? props.headline.trim() : null;
  const gancho = textoGancho && L.hook?.text !== undefined ? L.hook.text.trim() || null : textoGancho;
  const fG = Math.min(framesGancho(fps), totalCenas);
  const hook = { from: L.hook?.fromFrame ?? 0, dur: L.hook?.durationInFrames ?? fG, visivel: L.hook?.visible ?? true, t: L.hook?.transform ?? padrao.hook.transform };

  const textoCta = L.cta?.text !== undefined ? L.cta.text.trim() : props.ctaText.trim();
  const fCta = Math.min(framesCta(fps), totalCenas);
  const cta = { from: L.cta?.fromFrame ?? totalCenas - fCta, dur: L.cta?.durationInFrames ?? fCta, visivel: L.cta?.visible ?? true, t: L.cta?.transform ?? padrao.cta.transform };

  const linha = linhaDoTempo(props.scenes, fps);
  const ultima = linha[linha.length - 1];
  const textoCJK = props.scenes.map((c) => c.words.map((w) => w.word).join('')).join('') + (props.headline ?? '') + props.ctaText;
  const fontesDoEditor = [L.hook?.style?.fontId, L.caption?.style?.fontId, L.cta?.style?.fontId].filter((f): f is FontId => !!f);

  // Legenda sem transform no doc: posição pela zona; a "top" desce pro meio enquanto o gancho ocupa o topo.
  const tLegenda = L.caption?.transform ?? null;
  const ganchoNoFrame = (frame: number) => gancho !== null && hook.visivel && frame >= hook.from && frame < hook.from + hook.dur;
  const transformLegenda = (frame: number): LayerTransform =>
    tLegenda ?? { ...padrao.caption.transform, y: ZONAS[props.format][ganchoNoFrame(frame) && props.captionPosition === 'top' ? 'middle' : props.captionPosition] };
  const janela = L.caption ? (L.caption.visible ? { de: L.caption.fromFrame, ate: L.caption.fromFrame + L.caption.durationInFrames } : { de: 0, ate: 0 }) : undefined;

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {fontesDoEditor.length ? <FontesDasCamadas ids={fontesDoEditor} /> : null}
      {temCJK(textoCJK) ? <FontesCJK language={props.language} texto={textoCJK} /> : null}
      <Cenas scenes={props.scenes} estilo={estilo} />
      <Sequence name="Legenda" durationInFrames={totalCenas}>
        <Legenda
          scenes={props.scenes}
          captionStyle={props.captionStyle}
          format={props.format}
          estilo={estilo}
          transformNoFrame={transformLegenda}
          ateSec={totalCenas / fps}
          janela={janela}
          estiloCamada={L.caption?.style}
          language={props.language}
        />
      </Sequence>
      {gancho && hook.visivel ? (
        <Sequence name="Gancho" from={hook.from} durationInFrames={hook.dur}>
          <Gancho texto={gancho} format={props.format} estilo={estilo} transform={hook.t} estiloCamada={L.hook?.style} />
        </Sequence>
      ) : null}
      {textoCta && cta.visivel ? (
        <Sequence name="CTA" from={cta.from} durationInFrames={cta.dur}>
          <Cta texto={textoCta} format={props.format} estilo={estilo} transform={cta.t} estiloCamada={L.cta?.style} />
        </Sequence>
      ) : null}
      {fimEnd > 0 ? (
        <Sequence name="End card" from={totalCenas} durationInFrames={fimEnd}>
          <EndCard
            texto={(L.cta?.text !== undefined ? L.cta.text.trim() : props.ctaText.trim()) || ' '}
            format={props.format}
            estilo={estilo}
            ultimoClipe={ultima.clipUrl}
            ultimoFrame={Math.max(0, ultima.durationInFrames - 1)}
            trimBefore={Math.round((props.scenes[ultima.index].clipStartSec ?? 0) * fps)}
          />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};
