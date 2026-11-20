// Casos dos stills da legenda móvel (20/11): moldura question_box com a NOSSA legenda (captionMode 'replace') + doc do editor.
// Mídia local de teste (video/public/fixtures), nada pago.
import { resolverPropsMoldura, type EditDocV3, type MolduraProps } from '../../src/lib';
import { demoProps } from '../../src/molduras/demo';

const PALAVRAS = 'Esse truque simples muda a sua rotina todos os dias sem esforço nenhum e você nem precisa de equipamento'.split(' ').map((word, i) => ({ word, startSec: i * 0.4, endSec: i * 0.4 + 0.35 }));
const vazio = (o: Partial<EditDocV3> = {}): EditDocV3 => ({ version: 3, clips: [], trim: null, layers: [], captionWords: [], ...o });
const tf = (y: number) => ({ x: 0.5, y, scale: 1, rotationDeg: 0, boxWidth: 1 });
const base = (fmt: 'VERTICAL_9_16' | 'PORTRAIT_4_5' = 'VERTICAL_9_16'): MolduraProps => ({
  ...demoProps('question_box', fmt, { durSec: 8 }), captionMode: 'replace',
  captions: { words: PALAVRAS, highlightColor: '#ffe14a', language: 'pt', style: { fontId: null, uppercase: false, color: '#ffffff', highlightColor: '#ffe14a', strokeColor: '#000000', strokeWidthRel: 0.09, sizeRel: 0.05, shadow: true, wordsPerPage: null } },
});
export const CASOS: { nome: string; fmt: '9x16' | '4x5'; base: MolduraProps; doc: EditDocV3 | null }[] = [
  { nome: '00-sem-edicao', fmt: '9x16', base: base(), doc: null },
  { nome: '01-posicao-alta', fmt: '9x16', base: base(), doc: vazio({ layers: [{ id: 'caption', transform: tf(0.22) }] }) },
  { nome: '02-posicao-baixa-borda', fmt: '9x16', base: base(), doc: vazio({ layers: [{ id: 'caption', transform: tf(0.93) }] }) },
  { nome: '03-tamanho-grande', fmt: '9x16', base: base(), doc: vazio({ layers: [{ id: 'caption', style: { size: 'lg' } }] }) },
  { nome: '04-tamanho-pequena', fmt: '9x16', base: base(), doc: vazio({ layers: [{ id: 'caption', style: { size: 'sm' } }] }) },
  { nome: '05-cores-amarelo-rosa', fmt: '9x16', base: base(), doc: vazio({ layers: [{ id: 'caption', style: { color: '#c8f03c', highlightColor: '#ff5fa2' } }] }) },
  { nome: '06-texto-preto-contorno-branco', fmt: '9x16', base: base(), doc: vazio({ layers: [{ id: 'caption', style: { color: '#111111', highlightColor: '#4aa8ff' } }] }) },
  { nome: '07-tudo-junto', fmt: '9x16', base: base(), doc: vazio({ layers: [{ id: 'caption', transform: tf(0.35), style: { size: 'lg', color: '#ffe14a', highlightColor: '#3ddc84' } }] }) },
  { nome: '08-4x5-posicao-propria', fmt: '4x5', base: base('PORTRAIT_4_5'), doc: vazio({ layers: [{ id: 'caption', transform: tf(0.3) }] }) },
];
export const propsDoCaso = (c: (typeof CASOS)[number]) => resolverPropsMoldura(c.base, c.doc, { format: c.fmt, principal: c.fmt }).props;
