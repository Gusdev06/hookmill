// §13.13: estilo do elenco e gênero travado repassados ao planVariations.
import type { BatchSettings, TeardownSections } from '@maquina/contratos';
import type { TeardownSnapshot } from './plano';
import { castingPlanOf } from './variacoes.service';

const settings = (voiceSource: BatchSettings['voiceSource']) => ({ voiceSource } as BatchSettings);
const snap = (gender: 'male' | 'female' | null, voice = ''): TeardownSnapshot => ({
  sections: { audio: { status: 'ok', naReason: null, data: { voice, music: '', sfx: '' } } } as unknown as TeardownSections,
  words: [], durationSec: 8, width: 720, height: 1280,
  editMap: gender === null ? null : ({ profile: { gender } } as TeardownSnapshot['editMap']),
});

describe('castingPlanOf (§13.13)', () => {
  it('SWAP_AVATAR com voz original: gênero do perfil do original', () => {
    expect(castingPlanOf('DIVERSE', settings('CHAMPION_AUDIO'), snap('female'), ['SWAP_AVATAR'])).toEqual({ castingStyle: 'DIVERSE', castingGender: 'female' });
    expect(castingPlanOf('MATCH_ORIGINAL', settings('CHAMPION_AUDIO'), snap('male'), ['SWAP_AVATAR', 'NEW_HOOKS'])).toEqual({ castingStyle: 'MATCH_ORIGINAL', castingGender: 'male' });
  });
  it('sem perfil: cai na voz descrita no teardown; ambígua = null', () => {
    expect(castingPlanOf('DIVERSE', settings('CHAMPION_AUDIO'), snap(null, 'Male, US accent, energetic'), ['SWAP_AVATAR']).castingGender).toBe('male');
    expect(castingPlanOf('DIVERSE', settings('CHAMPION_AUDIO'), snap(null, 'Human, fast'), ['SWAP_AVATAR']).castingGender).toBeNull();
  });
  it('voz do catálogo ou sem SWAP_AVATAR: gênero livre', () => {
    expect(castingPlanOf('DIVERSE', settings('CATALOG'), snap('female'), ['SWAP_AVATAR']).castingGender).toBeNull();
    expect(castingPlanOf('DIVERSE', settings('CHAMPION_AUDIO'), snap('female'), ['NEW_HOOKS']).castingGender).toBeNull();
  });
});
