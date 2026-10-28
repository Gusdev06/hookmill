// Roteiros dos templates grátis pro campeão Amnayalife (zh-TW), no formato que o planAutoBatch devolve (iterate-v2 F1.2).
// Conteúdo = o protótipo aprovado de 28/10 (video/src/prototipos/formatos/roteiros.ts), escrito à mão a partir da
// transcrição e do Brain (nenhuma chamada paga). Serve de fixture da prova real local (templates-campeao-real.ts) e do QA:
// passa pela MESMA validação do plano (nada inventado) antes do build. Os beats vêm em segundos do campeão; o script converte
// pra índice de palavra (wordAt), como o parse do planAutoBatch faz.
import type { AutoChatDmDraft, AutoPersonMotionDraft, PersonBeatContent, TemplateText } from '../../integracoes/contrato';

const fala = (text: string, a: number, b: number): TemplateText => ({ text, source: 'transcript', srcSpan: { startSec: a, endSec: b } });

export const CHAT_AMNAYALIFE: AutoChatDmDraft = {
  type: 'CHAT_DM',
  hook: { text: '「我不方便」你還在說 I\'m not convenient？', source: 'transcript', srcSpan: { startSec: 0, endSec: 2.5 }, highlight: '「我不方便」' },
  chrome: { typing: '正在輸入…', inputPlaceholder: '傳送訊息…', profileStatus: '線上英文老師' },
  messages: [
    { from: 'prospect', kind: 'question', text: fala('老師，我回外國主管：「Sorry, I\'m not convenient this Friday.」這樣講有問題嗎？', 2.11, 13.53), preserves: ['hook', 'pain'] },
    { from: 'brand', kind: 'answer', text: fala('有喔，主管看到會覺得有點奇怪。', 11, 23.3), preserves: ['pain'] },
    { from: 'brand', kind: 'answer', text: fala('convenient 是用來形容「事物或情況」，不是形容人。', 14, 23), preserves: ['proof', 'mechanism'] },
    { from: 'brand', kind: 'correction', text: fala('正確說法', 23.7, 24.72), wrong: [fala('I\'m not convenient', 1.12, 2.16)], right: [fala('It\'s not convenient for me', 25.16, 26.34), fala('I\'m a bit tied up right now', 26.54, 27.9)], preserves: ['proof'] },
    { from: 'prospect', kind: 'objection', text: fala('可是我文法沒錯啊…', 35.56, 38), preserves: ['objection'] },
    { from: 'brand', kind: 'answer', text: fala('文法沒錯，意思卻歪掉了。問題的根源：你的腦袋在做「逐字翻譯」。', 43.14, 53.96), preserves: ['mechanism'] },
    { from: 'prospect', kind: 'question', text: fala('那我是不是要背更多正確的句子？', 58.06, 61), preserves: ['objection'] },
    { from: 'brand', kind: 'answer', text: fala('我們教你英文背後的思考模式：文化語境跟語言邏輯。', 62.32, 66.22), preserves: ['mechanism'] },
    { from: 'brand', kind: 'offer', text: fala('免費公開課', 74.54, 75.2), right: [fala('台灣人最常見的英文盲點', 77.1, 78.5), fala('從根源解決', 78.78, 80.3)], preserves: ['offer', 'cta'] },
  ],
  close: { lines: [fala('下次寫 email', 81, 82.4), fala('不用再擔心冒出尷尬', 82.4, 84.5), fala('連結在下面・免費報名', 80.68, 82)] },
  cta: { button: { text: '免費報名體驗課 →', source: 'cta' }, note: { text: '無需信用卡 · 30 分鐘立即體驗', source: 'offerAndPrice' } },
  proof: [
    { value: 20000, decimals: 0, prefix: '', suffix: '+', label: '註冊會員/學員', source: 'proof' },
    { value: 4.9, decimals: 1, prefix: '', suffix: '', label: '平均評價', source: 'proof' },
    { value: 93, decimals: 0, prefix: '', suffix: '%', label: '高回訪與推薦率', source: 'proof' },
  ],
};

/** PERSON_MOTION com os 5 trechos do protótipo (rosto e voz do campeão). `atSec` → atWord no script. */
export const PERSON_AMNAYALIFE: Omit<AutoPersonMotionDraft, 'beats'> & { beats: ({ spanIndex: number; atSec: number } & PersonBeatContent)[] } = {
  type: 'PERSON_MOTION',
  spans: [
    { startSec: 0, endSec: 2.5, preserves: ['hook'] },
    { startSec: 22.9, endSec: 27.92, preserves: ['proof'] },
    { startSec: 45.18, endSec: 53.96, preserves: ['mechanism', 'pain'] },
    { startSec: 62.32, endSec: 66.22, preserves: ['mechanism'] },
    { startSec: 74.54, endSec: 82.06, preserves: ['offer', 'cta'] },
  ],
  beats: [
    { spanIndex: 0, atSec: 0, kind: 'kinetic', words: [fala('你跟外國同事說過…', 0, 0.96), fala('I\'m not convenient？', 1.12, 2.16)] },
    { spanIndex: 1, atSec: 22.96, kind: 'wrong_right', wrong: fala('I\'m not convenient', 1.12, 2.16), right: [fala('It\'s not convenient for me', 25.16, 26.34), fala('I\'m a bit tied up right now', 26.54, 27.9)] },
    { spanIndex: 2, atSec: 45.2, kind: 'badge', text: fala('逐字翻譯', 46.08, 46.9) },
    { spanIndex: 2, atSec: 46.94, kind: 'steps', steps: [fala('中文想法', 46.94, 47.5), fala('一個字一個字', 47.58, 48.5), fala('翻成英文', 48.62, 49.3), fala('再開口', 49.36, 49.9)] },
    { spanIndex: 2, atSec: 50.08, kind: 'kinetic', words: [fala('英文邏輯', 50.32, 50.62), fala('中文邏輯', 50.74, 51.08), fala('完全不一樣', 51.36, 52)] },
    { spanIndex: 2, atSec: 52.28, kind: 'badge', text: fala('意思歪掉', 52.86, 53.9) },
    { spanIndex: 3, atSec: 62.34, kind: 'icon_list', items: [{ icon: 'brain', text: fala('思考模式', 63.66, 64.3) }, { icon: 'globe', text: fala('文化語境', 64.5, 65.2) }, { icon: 'chat', text: fala('語言邏輯', 65.46, 66) }] },
    { spanIndex: 4, atSec: 74.56, kind: 'kinetic', words: [fala('免費公開課', 74.56, 75.4)] },
    { spanIndex: 4, atSec: 76.28, kind: 'icon_list', items: [{ icon: 'check', text: fala('台灣人最常見的英文盲點', 77.1, 78.5) }, { icon: 'check', text: fala('從根源解決', 79.14, 80.3) }] },
    { spanIndex: 4, atSec: 80.68, kind: 'cta', button: { text: '免費報名體驗課 →', source: 'cta' }, note: null },
  ],
  endCard: {
    proof: [
      { value: 20000, decimals: 0, prefix: '', suffix: '+', label: '註冊會員/學員', source: 'proof' },
      { value: 4.9, decimals: 1, prefix: '', suffix: '', label: '平均評價', source: 'proof' },
      { value: 93, decimals: 0, prefix: '', suffix: '%', label: '高回訪與推薦率', source: 'proof' },
    ],
    cta: { button: { text: '免費報名體驗課 →', source: 'cta' }, note: { text: '無需信用卡 · 30 分鐘立即體驗', source: 'offerAndPrice' } },
  },
};
