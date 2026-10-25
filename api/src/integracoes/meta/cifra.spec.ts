import { randomBytes } from 'node:crypto';
import { CifraError, chaveDe, cifrar, decifrar } from './cifra';

const KEY = randomBytes(32).toString('base64');

describe('cifra AES-256-GCM (meta-v1 §7)', () => {
  it('cifra e decifra; cada chamada tem iv novo (ciphertexts diferentes pro mesmo texto)', () => {
    const a = cifrar('EAAtoken123', KEY);
    const b = cifrar('EAAtoken123', KEY);
    expect(a).not.toBe(b);
    expect(decifrar(a, KEY)).toBe('EAAtoken123');
    expect(decifrar(b, KEY)).toBe('EAAtoken123');
    // base64(iv 12 ‖ tag 16 ‖ ct)
    expect(Buffer.from(a, 'base64').length).toBe(12 + 16 + 'EAAtoken123'.length);
  });
  it('aceita chave em hex (64 chars) e base64 (32 bytes); recusa chave curta/vazia', () => {
    const hex = randomBytes(32).toString('hex');
    expect(decifrar(cifrar('x', hex), hex)).toBe('x');
    expect(() => chaveDe('')).toThrow(CifraError);
    expect(() => chaveDe(Buffer.from('short').toString('base64'))).toThrow(expect.objectContaining({ reason: 'key_invalid' }));
  });
  it('chave errada ou ciphertext adulterado = CifraError ciphertext_invalid (nunca devolve lixo)', () => {
    const ct = cifrar('segredo', KEY);
    expect(() => decifrar(ct, randomBytes(32).toString('base64'))).toThrow(expect.objectContaining({ reason: 'ciphertext_invalid' }));
    const buf = Buffer.from(ct, 'base64');
    buf[buf.length - 1] ^= 0xff;
    expect(() => decifrar(buf.toString('base64'), KEY)).toThrow(CifraError);
    expect(() => decifrar('abc', KEY)).toThrow(expect.objectContaining({ reason: 'ciphertext_invalid' }));
  });
  it('texto vazio e unicode', () => {
    expect(decifrar(cifrar('', KEY), KEY)).toBe('');
    expect(decifrar(cifrar('tóken ✓ 🙂', KEY), KEY)).toBe('tóken ✓ 🙂');
  });
});
