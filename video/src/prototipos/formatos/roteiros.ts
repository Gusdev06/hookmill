// PROTÓTIPO 28/10 (fora do produto): roteiros dos 2 formatos programáticos a partir do campeão Amnayalife (zh-TW).
// Campeão cmvnlm4yb000j22emztm1hm5e / lote cmvnlm4yd000l22emdoob1j5a (banco dev, só leitura).
// Roteiro escrito à mão (sem API). Regra: preserva ângulo/dor, promessa, prova, oferta e CTA do campeão; nada inventado.
// Toda fala vem da transcrição/teardown do campeão ou do Brain da oferta (lido da landing). `fonte` diz de onde.

export type Preserva = 'hook' | 'dor' | 'prova' | 'mecanismo' | 'objecao' | 'oferta' | 'cta' | 'promessa';

// ───────────────────────── 1. Chat/DM ─────────────────────────
export type MsgChat = {
  de: 'eu' | 'marca';
  tipo?: 'texto' | 'correcao' | 'oferta';
  zh: string;
  pt: string;
  /** só no tipo correcao: linhas riscadas (errado) e certas */
  errado?: string[];
  certo?: string[];
  preserva: Preserva[];
  fonte: string;
};

export const CHAT_HOOK = {
  zh: ['「我不方便」你還在說', 'I\'m not convenient？'],
  pt: '"Eu não posso" — você ainda diz I\'m not convenient?',
  fonte: 'Manchete fixa do campeão (teardown.hook.onScreenText)',
};

export const CHAT: MsgChat[] = [
  {
    de: 'eu', zh: '老師，我回外國主管：「Sorry, I\'m not convenient this Friday.」這樣講有問題嗎？',
    pt: 'Professora, respondi ao meu chefe estrangeiro: "Sorry, I\'m not convenient this Friday." Tem algum problema falar assim?',
    preserva: ['hook', 'dor'], fonte: 'Hook + história do aluno (0–13 s do campeão); vira pergunta, não depoimento',
  },
  {
    de: 'marca', zh: '有喔😅 主管看到會覺得有點奇怪。', pt: 'Tem sim 😅 Pro chefe isso soa meio estranho.',
    preserva: ['dor'], fonte: '"但是他的美國主管看到以後… 有一點奇怪" (campeão 11–23 s)',
  },
  {
    de: 'marca', zh: 'convenient 是用來形容「事物或情況」，不是形容人。', pt: 'Convenient descreve coisas ou situações, não pessoas.',
    preserva: ['prova', 'mecanismo'], fonte: 'Explicação do erro (campeão 14–23 s)',
  },
  {
    de: 'marca', tipo: 'correcao', zh: '正確說法', pt: 'Jeito certo',
    errado: ['I\'m not convenient'], certo: ['It\'s not convenient for me', 'I\'m a bit tied up right now'],
    preserva: ['prova'], fonte: 'Correção ao vivo com frase nativa (campeão 23.7–27.9 s) — a "prova" do campeão',
  },
  {
    de: 'eu', zh: '可是我文法沒錯啊…英文學了十幾年😭', pt: 'Mas minha gramática está certa… estudo inglês há mais de dez anos 😭',
    preserva: ['objecao', 'dor'], fonte: 'Objeção "文法没有错" (campeão 37 s) + dor do Brain "學了十幾年…開口還是卡卡"',
  },
  {
    de: 'marca', zh: '文法沒錯，意思卻歪掉了。就像 I\'m very happy，外國人也會說：', pt: 'A gramática está certa, mas o sentido entorta. Tipo I\'m very happy — o nativo também diz:',
    preserva: ['prova'], fonte: 'Segundo exemplo (campeão 35.6–43.1 s)',
  },
  {
    de: 'marca', tipo: 'correcao', zh: '母語人士會說', pt: 'O nativo diz',
    certo: ['I\'m over the moon', 'I couldn\'t be happier'],
    preserva: ['prova'], fonte: 'Frases nativas ditas no campeão (39.4–41.5 s)',
  },
  {
    de: 'marca', zh: '問題的根源：你的腦袋在做「逐字翻譯」。', pt: 'A raiz do problema: sua cabeça está traduzindo palavra por palavra.',
    preserva: ['mecanismo'], fonte: 'Vilão único 逐字翻譯 (campeão 43–47 s)',
  },
  {
    de: 'eu', zh: '那我是不是要背更多正確的句子？', pt: 'Então eu preciso decorar mais frases certas?',
    preserva: ['objecao'], fonte: 'Objeção que o campeão derruba: "我們不教你背正確的句子" (59 s)',
  },
  {
    de: 'marca', zh: '句子是背不完的。我們教你英文背後的思考模式：文化語境跟語言邏輯。', pt: 'Frase não acaba nunca. A gente ensina o jeito de pensar por trás do inglês: contexto cultural e lógica da língua.',
    preserva: ['mecanismo'], fonte: 'Método da escola (campeão 61–66 s)',
  },
  {
    de: 'marca', zh: '免費公開課會帶你完整解釋台灣人最常見的英文盲點，以及怎麼從根源解決。', pt: 'A aula aberta gratuita explica os pontos cegos de inglês mais comuns dos taiwaneses e como resolver pela raiz.',
    preserva: ['oferta'], fonte: 'Oferta falada (campeão 74.6–80.5 s)',
  },
  {
    de: 'marca', tipo: 'oferta', zh: '免費公開課', pt: 'Aula aberta gratuita: ✓ pontos cegos mais comuns dos taiwaneses ✓ resolver pela raiz [免費報名體驗課 →] sem cartão · 30 min',
    certo: ['台灣人最常見的英文盲點', '從根源解決'],
    preserva: ['oferta', 'cta'], fonte: 'Card desenhado em código: oferta falada no campeão (74.6–80.5 s) + texto real do botão da oferta (Brain: "免費報名體驗課 →", "無需信用卡 · 30 分鐘立即體驗")',
  },
];

/** Prova numérica: SÓ os números reais da landing (lidos no Brain da oferta; conferidos na página em 28/10). */
export const PROVA = [
  { valor: 20000, casas: 0, prefixo: '', sufixo: '+', zh: '學員體驗', pt: 'alunos que experimentaram' },
  { valor: 4.9, casas: 1, prefixo: '★ ', sufixo: '', zh: '平均評價', pt: 'avaliação média' },
  { valor: 93, casas: 0, prefixo: '', sufixo: '%', zh: '高回訪與推薦率', pt: 'voltam e recomendam' },
];
export const PROVA_FONTE = 'Brain da oferta (proof), lido de home.amnayalife.com: "20,000+ 學員體驗", "★ 4.9 平均評價", "93% 高回訪與推薦率"';
export const CTA_BOTAO = '免費報名體驗課 →';
export const CTA_NOTA = '無需信用卡 · 30 分鐘立即體驗';

export const CHAT_FECHO = {
  zh: ['下次寫 email', '不用再擔心冒出尷尬', '連結在下面・免費報名'],
  pt: 'Na próxima vez que escrever um e-mail, sem medo de passar vergonha. Link abaixo, inscrição grátis.',
  preserva: ['promessa', 'cta'] as Preserva[],
  fonte: 'Promessa e CTA falados no fim do campeão (81–84.5 s)',
};

// ───────────────────────── 2. Green screen sobre o print da landing ─────────────────────────
// Fala = 5 recortes do áudio/rosto ORIGINAL do campeão (placeholder do avatar de IA que o produto geraria).
// Recortes [início, fim] no campeão, em segundos; public/prototipos/formatos/gs-fala.mp4 é a concatenação deles.
export const GS_RECORTES: [number, number][] = [[0, 2.5], [22.9, 27.92], [45.18, 53.96], [62.32, 66.22], [74.54, 82.06]];
/** Tempo no campeão -> tempo no vídeo novo (recorte i). */
export const gsTempo = (i: number, srcSec: number) => {
  let off = 0;
  for (let k = 0; k < i; k++) off += GS_RECORTES[k][1] - GS_RECORTES[k][0];
  return off + srcSec - GS_RECORTES[i][0];
};
export const GS_FALA_SEC = GS_RECORTES.reduce((s, [a, b]) => s + b - a, 0);
export const GS_FIM_SEC = 3.4; // depois da última palavra: prova (números reais) + CTA

/** Legenda palavra a palavra: frases de [tempoNoCampeão, palavra] (zh-TW; a transcrição veio parte em simplificado). */
export type FraseGS = { recorte: number; palavras: [number, string][]; pt: string };
export const GS_FRASES: FraseGS[] = [
  { recorte: 0, pt: 'Você já disse pro colega estrangeiro', palavras: [[0, '你'], [0.18, '跟'], [0.3, '外國'], [0.5, '同事'], [0.76, '說過']] },
  { recorte: 0, pt: 'I\'m not convenient?', palavras: [[1.12, 'I\'m'], [1.46, 'not'], [1.58, 'convenient'], [2.16, '嗎？']] },
  { recorte: 1, pt: 'soa meio estranho', palavras: [[22.96, '有'], [23.08, '一點'], [23.3, '奇怪']] },
  { recorte: 1, pt: 'o jeito certo é', palavras: [[23.7, '正確'], [24.38, '的'], [24.48, '說法'], [24.72, '應該是']] },
  { recorte: 1, pt: 'It\'s not convenient for me', palavras: [[25.16, 'It\'s'], [25.48, 'not'], [25.64, 'convenient'], [26.02, 'for'], [26.34, 'me']] },
  { recorte: 1, pt: 'I\'m a bit tied up right now', palavras: [[26.54, 'I\'m'], [26.9, 'a'], [26.94, 'bit'], [27.1, 'tied'], [27.3, 'up'], [27.48, 'right'], [27.68, 'now']] },
  { recorte: 2, pt: 'sua cabeça está traduzindo palavra por palavra', palavras: [[45.2, '你的'], [45.44, '腦袋'], [45.76, '在做'], [46.08, '逐字'], [46.56, '翻譯']] },
  { recorte: 2, pt: 'a ideia em chinês, palavra a palavra, vira inglês', palavras: [[46.94, '中文'], [47.22, '想法'], [47.58, '一個'], [47.92, '一個字'], [48.5, '的'], [48.62, '翻成'], [49.0, '英文']] },
  { recorte: 2, pt: 'e só depois você fala', palavras: [[49.36, '然後'], [49.54, '再'], [49.68, '開口']] },
  { recorte: 2, pt: 'mas a lógica do inglês e do chinês é totalmente diferente', palavras: [[50.08, '但是'], [50.32, '英文'], [50.62, '跟'], [50.74, '中文的'], [51.08, '邏輯'], [51.36, '完全'], [51.68, '不一樣']] },
  { recorte: 2, pt: 'traduzindo direto, o sentido entorta fácil', palavras: [[52.28, '直接'], [52.5, '翻譯'], [52.86, '意思'], [53.08, '就很'], [53.42, '容易'], [53.64, '歪掉']] },
  { recorte: 3, pt: 'a gente ensina o jeito de pensar por trás do inglês', palavras: [[62.34, '我們'], [62.56, '教你'], [62.82, '英文'], [63.22, '背後的'], [63.66, '思考'], [64.1, '模式']] },
  { recorte: 3, pt: 'contexto cultural e lógica da língua', palavras: [[64.5, '文化'], [64.98, '語境'], [65.26, '跟'], [65.46, '語言'], [65.86, '邏輯']] },
  { recorte: 4, pt: 'esta aula aberta gratuita', palavras: [[74.56, '這堂'], [74.92, '免費'], [75.14, '公開課']] },
  { recorte: 4, pt: 'vai te explicar por completo', palavras: [[75.5, '就是'], [75.76, '會'], [75.92, '帶你'], [76.28, '完整'], [76.68, '解釋']] },
  { recorte: 4, pt: 'os pontos cegos mais comuns dos taiwaneses no inglês', palavras: [[77.1, '台灣人'], [77.48, '最常見的'], [78.12, '英文'], [78.4, '盲點']] },
  { recorte: 4, pt: 'e como resolver pela raiz', palavras: [[78.78, '以及'], [79.14, '怎麼'], [79.42, '從根源'], [80.24, '解決']] },
  { recorte: 4, pt: 'link abaixo, inscrição grátis', palavras: [[80.68, '連結'], [81.1, '在下面'], [81.5, '免費報名']] },
];

/** Blocos do roteiro do green screen pro index (zh + PT + o que preserva). */
export const GS_BLOCOS: { recorte: number | 'fim'; visual: string; preserva: Preserva[]; fonte: string }[] = [
  { recorte: 0, visual: '"I\'m not convenient" entra palavra por palavra; "？" rosa salta e um traço vermelho risca a frase.', preserva: ['hook'], fonte: 'Hook falado (0–2.5 s)' },
  { recorte: 1, visual: 'Errado → certo: card vermelho "✕ I\'m not convenient", selo "有點奇怪", seta desenhando, 2 cards verdes com as frases nativas.', preserva: ['prova'], fonte: 'Correção com frase nativa (22.9–27.9 s)' },
  { recorte: 2, visual: 'Selo "逐字翻譯 ✕"; esquema 中文想法 → 一個字一個字 → 英文 → 開口 desenhando junto da fala; 英文邏輯 ≠ 中文邏輯; "意思" entorta no "歪掉".', preserva: ['mecanismo', 'dor'], fonte: 'Causa-raiz (45.2–54 s)' },
  { recorte: 3, visual: '"我們教你 英文背後的思考模式" + 3 blocos com ícone: 思考模式, 文化語境, 語言邏輯, cada um no tempo da palavra.', preserva: ['mecanismo'], fonte: 'Método da escola (62.3–66.2 s)' },
  { recorte: 4, visual: 'Título "免費公開課" com selo FREE; checklist ✓ 台灣人最常見的英文盲點 ✓ 從根源解決; botão "免費報名體驗課 →" pulsando + seta "連結在下面".', preserva: ['oferta', 'cta'], fonte: 'Oferta + CTA (74.5–82 s) + texto real do botão' },
  { recorte: 'fim', visual: 'Prova com contadores (20,000+ 學員體驗 · ★ 4.9 平均評價 · 93% 高回訪與推薦率) + botão + "無需信用卡 · 30 分鐘立即體驗".', preserva: ['prova', 'cta'], fonte: 'Números reais do Brain/landing (não estavam no campeão; mostrados de propósito, 3,4 s)' },
];
