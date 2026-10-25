// Composição do protótipo: recebe { template, textos, midias, marca } e desenha a moldura escolhida. Só 9:16.
import React from 'react';
import { AbsoluteFill, type CalculateMetadataFunction } from 'remotion';
import { useFontesMolduras } from './base';
import { Caixinha, Cinema, LeiaALegenda, Live, Meme, Noticia, OfertaDireta, PovDepoimento, Ranking, Story, Tweet } from './formatos/um-video';
import { Choquei, Fofoca1, Fofoca2, Meet, MeetDialogo, TelaDividida, TelaDividida2 } from './formatos/duas-fontes';
import type { MolduraProps } from './tipos';

export const PROTOTIPO_FPS = 30;

export const calcularMoldura: CalculateMetadataFunction<MolduraProps> = async ({ props }) => ({
  durationInFrames: Math.round(props.duracaoSec * PROTOTIPO_FPS), fps: PROTOTIPO_FPS, width: 1080, height: 1920,
});

const Conteudo: React.FC<{ p: MolduraProps }> = ({ p }) => {
  switch (p.template) {
    case 'question_box': return <Caixinha {...p} />;
    case 'gossip_page': return <Choquei {...p} />;
    case 'meme': return <Meme {...p} />;
    case 'cinema': return <Cinema {...p} />;
    case 'news': return <Noticia {...p} />;
    case 'split_stack': return <TelaDividida {...p} />;
    case 'split_torn': return <TelaDividida2 {...p} />;
    case 'call': return <Meet {...p} />;
    case 'call_dialog': return <MeetDialogo {...p} />;
    case 'ranking': return <Ranking {...p} />;
    case 'post_card': return <Tweet {...p} />;
    case 'direct_offer': return <OfertaDireta {...p} />;
    case 'story': return <Story {...p} />;
    case 'read_caption': return <LeiaALegenda {...p} />;
    case 'pov_testimonial': return <PovDepoimento {...p} />;
    case 'live': return <Live {...p} />;
    case 'gossip_white': return <Fofoca1 {...p} />;
    case 'gossip_pink': return <Fofoca2 {...p} />;
  }
};

export const MolduraPrototipo: React.FC<MolduraProps> = (p) => {
  const pronto = useFontesMolduras();
  return <AbsoluteFill style={{ backgroundColor: '#000' }}>{pronto ? <Conteudo p={p} /> : null}</AbsoluteFill>;
};
