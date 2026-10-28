// Legenda zh na escrita do idioma da oferta (F1, pedido 28/10): zh-TW/HK = tradicional; zh-CN = simplificado.
import { escritaAlvo, palavrasNaEscrita, paraEscritaDoIdioma } from './escrita-chinesa';

const w = (xs: string[]) => xs.map((word, i) => ({ word, startSec: i, endSec: i + 0.5 }));

describe('escrita chinesa da legenda', () => {
  it('alvo pelo idioma', () => {
    expect(escritaAlvo('zh-TW')).toBe('tw');
    expect(escritaAlvo('zh-Hant')).toBe('tw');
    expect(escritaAlvo('zh-HK')).toBe('hk');
    expect(escritaAlvo('zh-CN')).toBe('cn');
    expect(escritaAlvo('zh')).toBeNull();
    expect(escritaAlvo('en')).toBeNull();
  });
  it('zh-TW: as palavras do Whisper em simplificado saem em tradicional, com os mesmos tempos (o caso do Amnayalife)', () => {
    const out = palavrasNaEscrita(w(['直接', '翻译', '意思', '就很', '容易', '歪掉', '逻辑', '免费', '公开课', '报名', '释']), 'zh-TW');
    expect(out.map((x) => x.word)).toEqual(['直接', '翻譯', '意思', '就很', '容易', '歪掉', '邏輯', '免費', '公開課', '報名', '釋']);
    expect(out.map((x) => x.startSec)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
  it('frase partida em caracteres: converte no texto corrido (头/发 → 頭/髮), latino intacto', () => {
    expect(palavrasNaEscrita(w(['头', '发', 'I', "'m", 'not']), 'zh-TW').map((x) => x.word)).toEqual(['頭', '髮', 'I', "'m", 'not']);
  });
  it('zh-CN: tradicional vira simplificado; outro idioma não muda', () => {
    expect(paraEscritaDoIdioma('語言邏輯', 'zh-CN')).toBe('语言逻辑');
    const en = w(['hello', 'world']);
    expect(palavrasNaEscrita(en, 'en')).toBe(en);
  });
});
