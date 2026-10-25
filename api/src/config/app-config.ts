import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Leitura tipada do .env (lista em docs/contratos/estrutura.md §3). */
@Injectable()
export class AppConfig {
  constructor(private readonly env: ConfigService) {}

  private str(key: string, fallback?: string): string {
    const v = this.env.get<string>(key);
    if (v === undefined || v === '') {
      if (fallback !== undefined) return fallback;
      throw new Error(`Variável de ambiente ${key} não definida (veja api/.env.example)`);
    }
    return v;
  }
  private int(key: string, fallback: number): number {
    const v = Number(this.env.get<string>(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  }
  optional(key: string): string | null {
    const v = this.env.get<string>(key);
    return v ? v : null;
  }

  get isProduction() { return this.env.get('NODE_ENV') === 'production'; }
  get port() { return this.int('PORT', 3001); }
  get publicApiUrl() { return this.str('PUBLIC_API_URL', `http://localhost:${this.port}`); }
  get webOrigins(): string[] {
    return this.str('WEB_ORIGIN', 'http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean);
  }

  get jwtAccessSecret() { return this.str('JWT_ACCESS_SECRET'); }
  get jwtAccessTtl() { return this.str('JWT_ACCESS_TTL', '15m'); }
  /** Segundos do access token (o login devolve expiresIn). */
  get jwtAccessTtlSec(): number { return parseDurationSec(this.jwtAccessTtl); }
  get refreshTtlDays() { return this.int('REFRESH_TTL_DAYS', 30); }
  get inviteTtlDays() { return this.int('INVITE_TTL_DAYS', 7); }

  get storage() {
    return {
      endpoint: this.str('STORAGE_ENDPOINT'),
      region: this.str('STORAGE_REGION', 'us-east-1'),
      bucket: this.str('STORAGE_BUCKET'),
      accessKeyId: this.str('STORAGE_ACCESS_KEY_ID'),
      secretAccessKey: this.str('STORAGE_SECRET_ACCESS_KEY'),
      forcePathStyle: this.str('STORAGE_FORCE_PATH_STYLE', 'true') === 'true',
      signedUrlTtlSec: this.int('SIGNED_URL_TTL_SEC', 21600),
    };
  }

  // ───────── feature 2 ─────────
  /** proxy = PUT pela API (dev); direct = URL pré-assinada do storage (prod com CORS no bucket). */
  get uploadMode(): 'proxy' | 'direct' { return this.env.get<string>('UPLOAD_MODE') === 'direct' ? 'direct' : 'proxy'; }
  get uploadMaxBytes() { return this.int('UPLOAD_MAX_BYTES', 524_288_000); }
  get championMinSec() { return this.int('CHAMPION_MIN_SEC', 4); }
  get championMaxSec() { return this.int('CHAMPION_MAX_SEC', 180); }

  get defaultMonthlySpendCapUsd(): number | null {
    const v = Number(this.env.get<string>('DEFAULT_MONTHLY_SPEND_CAP_USD'));
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  // ───────── meta-v1 (meta-v1.md §11) ─────────
  /** mock (padrão) | live | off. off = toda rota /meta responde 503 META_NOT_CONFIGURED { reason: 'off' } e o passo 2 do onboarding sai. */
  get metaMode(): 'mock' | 'live' | 'off' {
    const m = (this.env.get<string>('META_MODE') ?? '').trim().toLowerCase();
    return m === 'live' || m === 'off' ? m : 'mock';
  }
  /** Onboarding-v2 §2: passo "meta" habilitado (META_MODE != off). */
  get metaEnabled(): boolean { return this.metaMode !== 'off'; }
  get metaAppId() { return this.optional('META_APP_ID'); }
  get metaAppSecret() { return this.optional('META_APP_SECRET'); }
  /** Facebook Login for Business → Configuration ID (contrato: META_LOGIN_CONFIG_ID; .env.example: META_CONFIG_ID). */
  get metaLoginConfigId() { return this.optional('META_LOGIN_CONFIG_ID') ?? this.optional('META_CONFIG_ID'); }
  get metaGraphVersion() { return this.str('META_GRAPH_VERSION', 'v25.0'); }
  /** Chave AES-256-GCM do token (base64, 32 bytes). */
  get metaTokenKey() { return this.optional('META_TOKEN_KEY'); }
  /** §5: regra de vencedor e tendência (limites por env). */
  get metaRule() {
    const f = (k: string, d: number) => {
      const v = Number(this.env.get<string>(k));
      return Number.isFinite(v) && v > 0 ? v : d;
    };
    return {
      minSpendUsd: f('META_WINNER_MIN_SPEND_USD', 50),
      minResults: Math.round(f('META_WINNER_MIN_RESULTS', 3)),
      trendBetter: f('META_TREND_BETTER', 0.85),
      trendWorse: f('META_TREND_WORSE', 1.25),
      trendFreq: f('META_TREND_FREQ', 3),
      usdRates: parseUsdRates(this.env.get<string>('META_USD_RATES')),
    };
  }
  get metaSyncEveryHours() { return this.int('META_SYNC_EVERY_HOURS', 6); }
  /**
   * Crons da Meta (sync a cada META_SYNC_EVERY_HOURS + health 1×/dia). Incidente 22/10: uma API mock no banco compartilhado
   * sincronizou a conexão REAL e a deixou TOKEN_INVALID. Regra: só rodam com META_MODE=live, e META_CRON=off desliga em
   * qualquer modo (2ª API no mesmo banco, QA, debug).
   */
  get metaCronEnabled(): boolean {
    return this.metaMode === 'live' && (this.env.get<string>('META_CRON') ?? '').trim().toLowerCase() !== 'off';
  }
  // campanhas-v1 §4.1/§6 (22/10): travas das escritas da Campaigns
  /** aumento máximo de orçamento diário numa ação (× atual; D7) */
  get metaBudgetMaxStep(): number { const v = Number(this.env.get<string>('META_BUDGET_MAX_STEP')); return Number.isFinite(v) && v > 1 ? v : 2; }
  /** escritas na Meta por workspace por minuto (D11) */
  get metaWritesPerMin() { return this.int('META_WRITES_PER_MIN', 20); }
  /** uso de cota da Meta (%) a partir do qual a escrita é recusada (D11; 90 pra sobrar pro sync) */
  get metaWriteUsageCeiling() { return this.int('META_WRITE_USAGE_CEILING', 90); }

  // ───────── cadastro (fase2-cadastro.md) ─────────
  /** false = POST /auth/signup responde 403. Padrão true. */
  get signupEnabled(): boolean { return this.env.get<string>('SIGNUP_ENABLED')?.trim().toLowerCase() !== 'false'; }
  /** Teto mensal do 1º cliente criado pelo cadastro. Sem a variável = 10; vazia (ou inválida/0) = sem teto. */
  get signupDefaultSpendCapUsd(): number | null {
    const raw = this.env.get<string>('SIGNUP_DEFAULT_SPEND_CAP_USD');
    if (raw === undefined) return 10;
    const v = Number(raw);
    return raw.trim() !== '' && Number.isFinite(v) && v > 0 ? v : null;
  }
}

export function parseDurationSec(v: string): number {
  const m = /^(\d+)\s*([smhd]?)$/.exec(v.trim());
  if (!m) throw new Error(`Duração inválida: ${v}`);
  const n = Number(m[1]);
  return n * ({ '': 1, s: 1, m: 60, h: 3600, d: 86400 } as Record<string, number>)[m[2]];
}

/** "BRL=5.5,EUR=0.92" → { BRL: 5.5, EUR: 0.92 } (unidades da moeda por 1 USD). Vazio/ inválido = {} (1:1). */
export function parseUsdRates(v: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of (v ?? '').split(',')) {
    const [k, n] = part.split('=').map((x) => x?.trim());
    const rate = Number(n);
    if (k && Number.isFinite(rate) && rate > 0) out[k.toUpperCase()] = rate;
  }
  return out;
}
