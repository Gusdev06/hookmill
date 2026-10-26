// Composição `Moldura` (contrato estatico-montado-e-molduras-v1 §B2): o vídeo do campeão (com o áudio dele) dentro de
// uma das 18 molduras, em 9:16, 4:5 ou 1:1. Props = FrameRenderInput sem renderId/kind/templateId (molduraSchema).
// Mesma composição serve pro renderMedia local e pro Lambda (nada de disco: mídia por URL ou staticFile).
import React, { useMemo } from 'react';
import { AbsoluteFill, type CalculateMetadataFunction } from 'remotion';
import { FORMATOS, FPS } from '../lib/formatos';
import { corDaMarca, duracaoMoldura, frameUi, layoutDaPeca, type MolduraProps } from '../lib/molduras';
import { caixaLegendaMoldura } from '../lib/legendaAuto';
import { LegendaAuto } from '../componentes/LegendaAuto';
import { useFontesMolduras, type PropsTpl } from './base';
import { Caixinha, Cinema, LeiaALegenda, Live, Meme, Noticia, OfertaDireta, PovDepoimento, Ranking, Story, Tweet } from './um-video';
import { Choquei, Fofoca1, Fofoca2, Meet, MeetDialogo, TelaDividida, TelaDividida2 } from './duas-fontes';

export const calcularMoldura: CalculateMetadataFunction<MolduraProps> = async ({ props }) => ({
  durationInFrames: duracaoMoldura(props, FPS), fps: FPS, ...FORMATOS[props.format],
});

const TEMPLATES: { [K in MolduraProps['frame']['id']]: React.FC<PropsTpl<K>> } = {
  question_box: Caixinha, gossip_page: Choquei, meme: Meme, cinema: Cinema, news: Noticia, split_stack: TelaDividida, split_torn: TelaDividida2,
  call: Meet, call_dialog: MeetDialogo, ranking: Ranking, post_card: Tweet, direct_offer: OfertaDireta, story: Story, read_caption: LeiaALegenda,
  pov_testimonial: PovDepoimento, live: Live, gossip_white: Fofoca1, gossip_pink: Fofoca2,
};

const Conteudo: React.FC<{ p: MolduraProps }> = ({ p }) => {
  const L = useMemo(() => layoutDaPeca(p), [p]);
  const T = TEMPLATES[p.frame.id] as React.FC<PropsTpl<typeof p.frame.id>>;
  const caixaLegenda = useMemo(() => (p.captions?.words.length ? caixaLegendaMoldura(p, L) : null), [p, L]);
  return (
    <>
      <T p={p as PropsTpl<typeof p.frame.id>['p']} L={L} cor={corDaMarca(p.frame.brand.color)} ui={frameUi(p.language)} />
      {p.captions && caixaLegenda ? <LegendaAuto captions={p.captions} timeline={p.video.timeline} caixa={caixaLegenda} ateSec={duracaoMoldura(p) / 30} /> : null}
    </>
  );
};

export const Moldura: React.FC<MolduraProps> = (p) => {
  // todo texto que pode aparecer (textos da IA, marca, rótulos do idioma): os pedaços CJK que ele usa vêm antes do 1º frame
  const texto = useMemo(() => JSON.stringify(p.frame) + JSON.stringify(frameUi(p.language)) + (p.captions?.words.map((w) => w.word).join('') ?? ''), [p.frame, p.language, p.captions]);
  const pronto = useFontesMolduras(texto, p.language, p.captions?.style?.fontId);
  return <AbsoluteFill style={{ backgroundColor: '#000' }}>{pronto ? <Conteudo p={p} /> : null}</AbsoluteFill>;
};
