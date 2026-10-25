// META_MODE (meta-v1.md §8/§11): mock (padrão) | live | off. Fábrica usada pelo integracoes.module.
import type { MetaMode, MetaService, MetaWinnerRule } from '../contrato';
import { DEFAULT_GRAPH_VERSION } from './cliente';
import { LiveMetaService } from './live.service';
import { FakeMetaService } from './mock.service';
import { offMetaService } from './off.service';
import { ruleFromEnv } from './vencedor';

export function metaMode(v: string | undefined): MetaMode {
  const m = (v ?? '').trim().toLowerCase();
  return m === 'live' || m === 'off' ? m : 'mock';
}

export const META_LIVE_ENVS = ['META_APP_ID', 'META_APP_SECRET', 'META_CONFIG_ID', 'META_TOKEN_KEY'] as const;

export interface MetaEnv {
  META_MODE?: string; META_APP_ID?: string; META_APP_SECRET?: string; META_CONFIG_ID?: string; META_TOKEN_KEY?: string; META_GRAPH_VERSION?: string;
  PUBLIC_API_URL?: string; JWT_ACCESS_SECRET?: string;
}

export function buildMetaService(env: MetaEnv & NodeJS.ProcessEnv, opts: { publicApiUrl: string; rule?: MetaWinnerRule; stepMs?: number } ): MetaService {
  const mode = metaMode(env.META_MODE);
  const rule = opts.rule ?? ruleFromEnv(env);
  const graphVersion = (env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION).trim();
  const jwtSecret = env.JWT_ACCESS_SECRET || '';
  if (mode === 'off') return offMetaService('off', [], graphVersion);
  if (mode === 'mock') return new FakeMetaService({ publicApiUrl: opts.publicApiUrl, jwtSecret: jwtSecret || 'mock-secret', rule, stepMs: opts.stepMs });
  const missing = META_LIVE_ENVS.filter((k) => !(env[k] ?? '').trim());
  if (!jwtSecret) missing.push('JWT_ACCESS_SECRET' as never);
  if (missing.length) return offMetaService('not_configured', missing, graphVersion);
  return new LiveMetaService({
    appId: env.META_APP_ID!.trim(), appSecret: env.META_APP_SECRET!.trim(), configId: env.META_CONFIG_ID!.trim(),
    redirectUri: `${opts.publicApiUrl.replace(/\/$/, '')}/api/v1/meta/callback`,
    jwtSecret, graphVersion, rule,
  });
}
