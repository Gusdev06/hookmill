// PROTÓTIPO (25/10/2026, pedido do Gusta): as 18 molduras do pack DVN em 9:16, pra ver antes do produto.
// Não ligado em API, banco, fluxo AUTO nem contrato. Ids e nomes de campos seguem a proposta do contrato
// docs/contratos/estatico-montado-e-molduras-v1.md §B2/§B3, pra servir de base do B1. `story` não existe no contrato
// (o pack tem, a proposta ainda não): fica só aqui.
//
// Marcação de destaque nos textos: trecho entre *asteriscos* sai na cor/peso de destaque do template.

export const MOLDURA_IDS = [
  'question_box', 'gossip_page', 'meme', 'cinema', 'news', 'split_stack', 'split_torn', 'call', 'call_dialog',
  'ranking', 'post_card', 'direct_offer', 'story', 'read_caption', 'pov_testimonial', 'live', 'gossip_white', 'gossip_pink',
] as const;
export type MolduraId = (typeof MOLDURA_IDS)[number];

export type TextosMoldura = {
  question_box: { question: string };
  gossip_page: { headline: string; pageName: string };
  meme: { pov: string; cta: string };
  cinema: { question: string; subtitle: string };
  news: { topic: string; headline: { lead: string; highlight: string }; dek: string; cta: string };
  split_stack: { headline: string };
  split_torn: { headline: string };
  call: { title: string; slideTitle: string; slideSteps: string[] };
  call_dialog: { title: string; names: [string, string] };
  ranking: { title: string; items: string[] };
  post_card: { copy: string };
  direct_offer: { promise: string; price: { from: string | null; to: string }; cta: string };
  story: { question: string; headline: string; support: string; copy: string };
  read_caption: { headline: string; primaryText: string };
  pov_testimonial: { pov: string; cta: string };
  live: Record<string, never>;
  gossip_white: { headline: string };
  gossip_pink: { headline: string };
};

/** Mídia de entrada. principal = vídeo com o áudio (talking head); segunda = 2ª fonte (B2), sempre muda;
 *  rosto = foto redonda (frame do principal, `face_crop`). Caminho relativo = arquivo de public/. */
export type MidiasMoldura = {
  principal: { src: string; inicioSec?: number; foco?: { x: number; y: number } };
  segunda?: { src: string; inicioSec?: number; foco?: { x: number; y: number } };
  rosto?: string;
};

export type MarcaMoldura = { nome: string; handle: string; iniciais: string; cor: string };

export type MolduraProps = {
  [K in MolduraId]: { template: K; textos: TextosMoldura[K]; midias: MidiasMoldura; marca: MarcaMoldura; duracaoSec: number };
}[MolduraId];

/** Props de um formato específico (o componente de cada formato recebe as dele). */
export type PropsDe<K extends MolduraId> = Extract<MolduraProps, { template: K }>;
