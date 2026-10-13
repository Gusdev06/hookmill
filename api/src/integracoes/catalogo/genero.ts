// Gênero de quem aparece, lido da descrição do rosto (texto livre em en / pt / es).
// Regra do contrato (api.md §9): só afirma quando é INEQUÍVOCO. Palavras dos dois gêneros, ou de nenhum,
// devolvem null e a estimativa não avisa nada (nunca bloqueia).
// Lição da operação: avatar mulher com voz de homem = US$ 4,66 jogados fora (lote Emilly, 10/09).

export type Gender = 'female' | 'male';

const FEMALE = [
  // en
  'woman', 'women', 'girl', 'girls', 'female', 'lady', 'ladies', 'she', 'her', 'hers', 'mother', 'mom', 'wife', 'grandmother', 'businesswoman',
  // pt
  'mulher', 'mulheres', 'moça', 'moca', 'menina', 'garota', 'senhora', 'ela', 'feminina', 'feminino', 'mãe', 'mae', 'esposa', 'avó',
  // es
  'mujer', 'mujeres', 'chica', 'señora', 'senora', 'muchacha', 'femenina', 'femenino', 'madre', 'abuela',
];
const MALE = [
  // en
  'man', 'men', 'guy', 'guys', 'boy', 'boys', 'male', 'gentleman', 'he', 'him', 'his', 'father', 'dad', 'husband', 'grandfather', 'businessman', 'beard', 'bearded',
  // pt
  'homem', 'homens', 'rapaz', 'menino', 'garoto', 'senhor', 'ele', 'masculino', 'pai', 'marido', 'avô', 'barba', 'barbudo',
  // es
  'hombre', 'hombres', 'chico', 'señor', 'senor', 'muchacho', 'masculina', 'padre', 'abuelo',
];

function wordsOf(text: string): Set<string> {
  // \p{L}: letras com acento contam como letra (ex.: "mãe", "señora")
  return new Set(text.toLowerCase().match(/\p{L}+/gu) ?? []);
}

/** 'female' | 'male' quando só um dos gêneros aparece; null se nenhum ou os dois. */
export function genderOf(description: string | null | undefined): Gender | null {
  if (!description?.trim()) return null;
  const w = wordsOf(description);
  const f = FEMALE.some((x) => w.has(x));
  const m = MALE.some((x) => w.has(x));
  if (f === m) return null;
  return f ? 'female' : 'male';
}
