// Montagem do MetaHealth (meta-v1.md §3.1 POST /meta/health): 8 checks com níveis, igual nos dois modos.
// Quem lê a Meta (ou o mock) entrega os fatos; aqui só vira ok/warn/bad + frase.
import type { MetaHealth, MetaHealthCheck, MetaHealthLevel } from '@maquina/contratos';
import { accountUnpaid, accountUnusable } from './erros';
import { missingScopes } from './escopos';

export interface HealthFacts {
  token: { isValid: boolean; expiresAt: string | null; scopes: string[] };
  account: { selected: boolean; accountStatus: number | null; hasFunding: boolean | null; minimumDailyBudgetMinor: number | null; readFailed: boolean };
  page: { selected: boolean; reachable: boolean | null };
  pixel: { selected: boolean; lastFiredAt: string | null; readFailed: boolean };
  business: { present: boolean; verificationStatus: string | null };
  counts: { adsCount: number; activeCount: number };
  now: Date;
}

const DAY = 86_400_000;
const BLOCKING: MetaHealthCheck['key'][] = ['token', 'scopes', 'account', 'funding', 'page', 'budget'];

export function buildHealth(f: HealthFacts): MetaHealth {
  const checks: MetaHealthCheck[] = [];
  const add = (key: MetaHealthCheck['key'], level: MetaHealthLevel, detail: string | null = null) => checks.push({ key, level, detail });

  if (!f.token.isValid) add('token', 'bad', 'Your Meta login expired. Reconnect.');
  else if (f.token.expiresAt && Date.parse(f.token.expiresAt) - f.now.getTime() < 7 * DAY) add('token', 'warn', `Reconnect before ${f.token.expiresAt.slice(0, 10)}`);
  else add('token', 'ok');

  const missing = missingScopes(f.token.scopes);
  if (missing.length) add('scopes', 'bad', `Missing permissions: ${missing.join(', ')}`);
  else add('scopes', 'ok');

  if (!f.account.selected) add('account', 'bad', 'Choose an ad account');
  else if (f.account.readFailed || f.account.accountStatus == null) add('account', 'bad', 'Could not read this ad account. Choose another');
  else if (accountUnpaid(f.account.accountStatus)) add('account', 'bad', 'Unpaid balance');
  else if (accountUnusable(f.account.accountStatus)) add('account', 'bad', 'Account disabled, choose another');
  else if (f.account.accountStatus === 7) add('account', 'warn', 'Account pending risk review');
  else add('account', 'ok');

  if (!f.account.selected) add('funding', 'bad', 'Choose an ad account');
  else if (f.account.hasFunding === false) add('funding', 'bad', 'Add a payment method in Ads Manager');
  else if (f.account.hasFunding === null) add('funding', 'warn', 'Could not read the payment method');
  else add('funding', 'ok');

  if (!f.page.selected) add('page', 'bad', 'Choose a Page');
  else if (f.page.reachable === false) add('page', 'bad', 'You lost access to this Page');
  else if (f.page.reachable === null) add('page', 'warn', 'Could not check the Page');
  else add('page', 'ok');

  if (!f.pixel.selected) add('pixel', 'warn', 'No pixel: ads will optimize for clicks');
  else if (f.pixel.readFailed) add('pixel', 'warn', 'Could not read the pixel');
  else if (!f.pixel.lastFiredAt || f.now.getTime() - Date.parse(f.pixel.lastFiredAt) > 7 * DAY) add('pixel', 'warn', "Pixel hasn't fired in 7 days: results on Home may be empty");
  else add('pixel', 'ok');

  if (!f.account.selected) add('budget', 'warn', 'Choose an ad account');
  else if (f.account.minimumDailyBudgetMinor == null) add('budget', 'warn', 'Could not read the minimum budget');
  else add('budget', 'ok');

  if (!f.business.present) add('verified', 'warn', 'No business portfolio: Meta may limit spend');
  else if (f.business.verificationStatus !== 'verified') add('verified', 'warn', 'Business not verified: Meta may limit spend');
  else add('verified', 'ok');

  const rank: Record<MetaHealthLevel, number> = { ok: 0, warn: 1, bad: 2 };
  const worst = checks.reduce<MetaHealthLevel>((w, c) => (rank[c.level] > rank[w] ? c.level : w), 'ok');
  const canPublish = !checks.some((c) => c.level === 'bad' && BLOCKING.includes(c.key));
  return { level: worst, canPublish, checks, adsCount: f.counts.adsCount, activeCount: f.counts.activeCount, checkedAt: f.now.toISOString() };
}
