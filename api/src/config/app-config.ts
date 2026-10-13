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
