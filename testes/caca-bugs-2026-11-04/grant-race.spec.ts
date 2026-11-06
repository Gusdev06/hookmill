import { test, expect } from '../harness/fixtures';
import { as, expectOk, expectErro } from '../harness/api';
import { PERSONAS, q } from '../harness/db';

test('manual credit: concurrent grant/debit retries return one entry and preserve the balance', async () => {
  const staff = as('donoA');
  const userId = PERSONAS.donoB.id;
  expectOk(await staff.get('/auth/me')); // Warm the harness token before concurrent calls.
  await q('update users set credit_balance = 0 where id = $1', [userId]);
  const grant = { userId, credits: 5, idempotencyKey: 'hunt-concurrent-grant', note: 'Hunt regression' };
  const credits = await Promise.all(Array.from({ length: 4 }, () => staff.post('/admin/credits/grant', grant)));
  const granted = credits.map(r => expectOk(r));
  expect(new Set(granted.map(r => r.entry.id)).size).toBe(1);
  expect(granted.map(r => r.balance)).toEqual([5, 5, 5, 5]);
  const debit = { userId, credits: -5, idempotencyKey: 'hunt-concurrent-debit' };
  const debits = await Promise.all(Array.from({ length: 4 }, () => staff.post('/admin/credits/grant', debit)));
  const debited = debits.map(r => expectOk(r));
  expect(new Set(debited.map(r => r.entry.id)).size).toBe(1);
  expect(debited.map(r => r.balance)).toEqual([0, 0, 0, 0]);
  expect((await q('select credit_balance from users where id = $1', [userId]))[0].credit_balance).toBe(0);
  expect((await q('select id from credit_entries where user_id = $1', [userId])).length).toBe(2);
  expectErro(await staff.post('/admin/credits/grant', { ...grant, userId: PERSONAS.adminA.id }), 400, 'VALIDATION_ERROR');
  expectErro(await staff.post('/admin/credits/grant', { ...debit, idempotencyKey: 'hunt-no-funds' }), 409, 'INVALID_STATE');
});
