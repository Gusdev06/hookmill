// "Nada inventado" por afirmação (estatico-montado-e-molduras-v1 §A3.2 item 2). PURO, testado em afirmacoes.spec.ts.
// Léxico por idioma (pt, en, es) de termos que AFIRMAM algo que exige dado: grátis/teste, garantia/reembolso, desconto,
// plataforma, autoridade, superlativo, "sem risco". Texto com o termo e nenhuma fonte (Brain/transcrição) com um termo da
// MESMA família = violação `invented_claim`. Outro idioma = só a regra de número (`inventedNumbers`).
// Tabela, não regex solta: cada termo é uma frase literal, casada por palavra inteira depois da normalização abaixo.

export type ClaimFamily = 'free' | 'guarantee' | 'discount' | 'platform' | 'authority' | 'superlative' | 'risk_free';
export type ClaimLang = 'pt' | 'en' | 'es';

interface FamilyLexicon {
  /** termos que DISPARAM a regra no texto de tela, por idioma da tela */
  claims: Record<ClaimLang, string[]>;
  /** termos a mais que SUSTENTAM a família quando aparecem no Brain/na fala (além de todos os `claims` dos 3 idiomas) */
  support: string[];
}

/**
 * Notas de desenho:
 * - "melhor"/"mejor" sozinhos não disparam ("durma melhor" = comparativo, não afirmação): só o superlativo com artigo.
 * - "off" só em pt/es (anglicismo de desconto); em en "off" é palavra comum demais ("turn off") e o "%" já cobre "50% off".
 * - "teste" sozinho não dispara (em pt é "quiz"); dispara "teste grátis"/"período de teste" e o "grátis" já cobre o resto.
 */
export const CLAIM_LEXICON: Record<ClaimFamily, FamilyLexicon> = {
  free: {
    claims: {
      pt: ['grátis', 'gratis', 'gratuito', 'gratuita', 'de graça', 'teste grátis', 'período de teste', 'trial', 'free'],
      en: ['free', 'trial', 'for free', 'no cost'],
      es: ['gratis', 'gratuito', 'gratuita', 'prueba', 'prueba gratis', 'trial'],
    },
    support: ['teste', 'testar', 'avaliação', 'periodo de avaliacao', 'sem custo', 'free trial'],
  },
  guarantee: {
    claims: {
      pt: ['garantia', 'garantido', 'garantida', 'reembolso', 'devolução do dinheiro', 'dinheiro de volta', 'devolvemos'],
      en: ['guarantee', 'guaranteed', 'refund', 'refunded', 'money back', 'money-back'],
      es: ['garantía', 'garantizado', 'garantizada', 'reembolso', 'devolución', 'devolvemos tu dinero'],
    },
    support: ['reembolsa', 'reembolsamos', 'refunds', 'devolve', 'devolvo'],
  },
  discount: {
    claims: {
      pt: ['desconto', 'descontos', 'promoção', 'promocao', 'liquidação', 'off', '%'],
      en: ['discount', 'discounted', 'sale', 'on sale', 'deal', '%', 'percent off'],
      es: ['descuento', 'descuentos', 'promoción', 'rebaja', 'rebajas', 'off', '%'],
    },
    support: ['cupom', 'coupon', 'cupón', 'por cento', 'percent', 'por ciento'],
  },
  platform: {
    claims: {
      pt: ['ios', 'android', 'app store', 'google play', 'play store', 'iphone'],
      en: ['ios', 'android', 'app store', 'google play', 'play store', 'iphone'],
      es: ['ios', 'android', 'app store', 'google play', 'play store', 'iphone'],
    },
    support: ['apple', 'appstore', 'playstore'],
  },
  authority: {
    claims: {
      pt: [
        'especialista', 'especialistas', 'médico', 'médica', 'médicos', 'médicas', 'doutor', 'doutora', 'clinicamente', 'cientificamente',
        'comprovado', 'comprovada', 'aprovado', 'aprovada', 'certificado', 'certificada', 'estudo', 'estudos',
      ],
      en: ['expert', 'experts', 'specialist', 'specialists', 'doctor', 'doctors', 'clinically', 'scientifically', 'proven', 'approved', 'certified', 'study', 'studies'],
      es: [
        'especialista', 'especialistas', 'médico', 'médica', 'médicos', 'doctor', 'doctora', 'clínicamente', 'científicamente',
        'comprobado', 'comprobada', 'aprobado', 'aprobada', 'certificado', 'certificada', 'estudio', 'estudios',
      ],
    },
    support: ['dr', 'dra', 'fisioterapeuta', 'nutricionista', 'psicologo', 'psicologa', 'pesquisa', 'research', 'anvisa', 'fda', 'crm'],
  },
  superlative: {
    claims: {
      pt: ['nº 1', 'n° 1', 'número 1', 'numero 1', '#1', 'o melhor', 'a melhor', 'os melhores', 'as melhores', 'o mais vendido', 'líder'],
      en: ['#1', 'no 1', 'number one', 'number 1', 'best', 'best-selling', 'bestselling'],
      es: ['nº 1', 'n° 1', 'número 1', '#1', 'el mejor', 'la mejor', 'los mejores', 'las mejores', 'el más vendido', 'líder'],
    },
    support: ['mais vendido', 'best seller', 'bestseller', 'top 1', 'ranking'],
  },
  risk_free: {
    claims: {
      pt: ['sem risco', 'sem riscos', 'risco zero', 'zero risco'],
      en: ['risk-free', 'risk free', 'no risk', 'zero risk'],
      es: ['sin riesgo', 'sin riesgos', 'riesgo cero', 'cero riesgo'],
    },
    support: [],
  },
};

export const CLAIM_FAMILIES = Object.keys(CLAIM_LEXICON) as ClaimFamily[];

/**
 * Normalização do casamento: minúsculo, sem acento (a fonte pode vir sem acento), "º"/"°" → "o", "%" e "#" viram
 * palavra própria, o resto da pontuação vira espaço (o hífen de "risk-free" também), espaços colapsados, com borda.
 * Assim "nº 1" casa "No. 1", "50%" casa "%" e "#1" casa "# 1".
 */
export function claimNorm(s: string): string {
  const t = s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[º°]/g, 'o')
    .replace(/%/g, ' % ').replace(/#/g, ' # ')
    .replace(/[^\p{L}\p{N}%#]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return ` ${t} `;
}

const NORM_CLAIMS: Record<ClaimFamily, Record<ClaimLang, string[]>> = Object.fromEntries(
  CLAIM_FAMILIES.map((f) => [f, Object.fromEntries((['pt', 'en', 'es'] as ClaimLang[]).map((l) => [l, CLAIM_LEXICON[f].claims[l].map(claimNorm)]))]),
) as Record<ClaimFamily, Record<ClaimLang, string[]>>;
const NORM_SUPPORT: Record<ClaimFamily, string[]> = Object.fromEntries(
  CLAIM_FAMILIES.map((f) => [f, [...new Set([...(['pt', 'en', 'es'] as ClaimLang[]).flatMap((l) => NORM_CLAIMS[f][l]), ...CLAIM_LEXICON[f].support.map(claimNorm)])]]),
) as Record<ClaimFamily, string[]>;

/** pt-BR → pt, en-US → en, es-MX → es; outro idioma = null (só a regra de número). */
export function claimLangOf(lang: string | null | undefined): ClaimLang | null {
  const p = (lang ?? '').trim().toLowerCase().slice(0, 2);
  return p === 'pt' || p === 'en' || p === 'es' ? p : null;
}

const hasTerm = (hay: string, term: string) => hay.includes(term);

/** Primeiro termo de afirmação de cada família presente no texto (idioma da tela). */
export function claimsIn(text: string, lang: ClaimLang): { family: ClaimFamily; term: string }[] {
  const hay = claimNorm(text);
  const out: { family: ClaimFamily; term: string }[] = [];
  for (const f of CLAIM_FAMILIES) {
    const i = NORM_CLAIMS[f][lang].findIndex((t) => hasTerm(hay, t));
    if (i >= 0) out.push({ family: f, term: CLAIM_LEXICON[f].claims[lang][i] });
  }
  return out;
}

/** A família tem algum termo (de qualquer idioma) em alguma das fontes? */
export function familySupported(family: ClaimFamily, sources: (string | null | undefined)[]): boolean {
  const hay = claimNorm(sources.filter((s): s is string => !!s && !!s.trim()).join(' \n '));
  return NORM_SUPPORT[family].some((t) => hasTerm(hay, t));
}

/**
 * Afirmações do texto que nenhuma fonte sustenta. `sources` = valores do Brain + fala do campeão (+ CTA falado).
 * Idioma fora de pt/en/es = [] (só a regra de número vale).
 */
export function inventedClaimsIn(text: string, sources: (string | null | undefined)[], lang: string | null | undefined): { family: ClaimFamily; term: string }[] {
  const l = claimLangOf(lang);
  if (!l || !text?.trim()) return [];
  return claimsIn(text, l).filter((c) => !familySupported(c.family, sources));
}

/** Texto tem número ou termo de afirmação (critério de "crítico" da checagem de texto, §A6). */
export function hasClaimTerm(text: string, lang: string | null | undefined): boolean {
  const l = claimLangOf(lang) ?? 'en';
  return claimsIn(text, l).length > 0;
}
