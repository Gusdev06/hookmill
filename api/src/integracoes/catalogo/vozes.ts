// templates-ia-previas-v1 §4.2: a voz da prévia sai do GÊNERO DO ROSTO, nunca do texto livre.
// Lição da operação: avatar mulher com voz de homem = US$ 4,66 jogados fora (lote Emilly, 10/09).
// `voice_gender_mismatch` não pode ocorrer: voiceFor só devolve voz do gênero pedido (nunca 'neutral').
import { VOICES, type VoiceDef } from './precos';

export type VoiceGender = 'female' | 'male';

/** Ordem de preferência por gênero: vozes adultas e neutras de registro primeiro; as caricatas por último. */
const PREFERENCE: Record<VoiceGender, string[]> = {
  female: ['Calm_Woman', 'Wise_Woman', 'Lively_Girl', 'Inspirational_girl', 'Lovely_Girl', 'Exuberant_Girl', 'Sweet_Girl_2', 'Abbess'],
  male: ['Casual_Guy', 'Deep_Voice_Man', 'Patient_Man', 'Determined_Man', 'Elegant_Man', 'Decent_Boy', 'Young_Knight', 'Imposing_Manner'],
};

/** Vozes do gênero, na ordem de preferência (só ids que existem no catálogo VOICES). */
export function voicesOf(gender: VoiceGender): VoiceDef[] {
  return PREFERENCE[gender].map((id) => VOICES.find((v) => v.id === id)).filter((v): v is VoiceDef => !!v && v.gender === gender);
}

/**
 * Voz da prévia. `exclude` = voiceIds já usados no lote: a 1ª voz do gênero fora dele; se o catálogo do gênero
 * esgotar, recomeça pela que menos se repetiu (contando `exclude`), sem nunca trocar de gênero.
 * `language` fica na assinatura: as vozes MiniMax são multilíngues (o idioma vai em language_boost), então hoje
 * não filtra; quando houver voz por idioma, o filtro entra aqui sem mudar quem chama.
 */
export function voiceFor(gender: VoiceGender, language: string, exclude: readonly string[] = []): { voiceId: string; voiceName: string } {
  void language;
  const pool = voicesOf(gender);
  if (!pool.length) throw new Error(`voiceFor: no ${gender} voice in the catalog`);
  const free = pool.find((v) => !exclude.includes(v.id));
  const pick = free ?? pool.reduce((best, v) => (count(exclude, v.id) < count(exclude, best.id) ? v : best));
  return { voiceId: pick.id, voiceName: pick.name };
}

const count = (xs: readonly string[], id: string) => xs.filter((x) => x === id).length;
