// Contrato §1 + Mudanças 05/10 §5: login 5/min por IP + e-mail e 20/min por IP → 429 RATE_LIMITED com details.retryAfterSec.
// Roda por último (nome zz-) pra não gastar a cota de IP dos outros testes. Depende de: B1 (throttle).
import { test, expect } from '../../harness/fixtures.ts';
import { call, expectErro } from '../../harness/api.ts';

test('C-RATE-01 no máximo 5 tentativas por e-mail no minuto: a 6ª (ou antes, se a cota do IP acabou) → 429 RATE_LIMITED', async () => {
  const body = { email: `rate-${Date.now()}@teste.local`, password: 'errada-errada' };
  const st: number[] = [];
  let r;
  for (let i = 0; i < 6; i++) {
    r = await call('POST', '/auth/login', { body });
    st.push(r.status);
    if (r.status === 429) break;
  }
  const primeiro429 = st.indexOf(429);
  expect(primeiro429, `sequência: ${st.join(',')}`).toBeGreaterThanOrEqual(0);
  expect(primeiro429, `sequência: ${st.join(',')}`).toBeLessThanOrEqual(5); // nunca deixa passar a 6ª
  expect(st.slice(0, primeiro429).every((s) => s === 401), st.join(',')).toBe(true);
  const d = expectErro(r!, 429, 'RATE_LIMITED');
  expect(d.retryAfterSec).toBeGreaterThan(0);
});
