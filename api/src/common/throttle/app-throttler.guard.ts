import { ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail, ThrottlerOptions, ThrottlerRequest } from '@nestjs/throttler';
import { AppException } from '../errors/app-exception';

// Throttlers globais (app.module), contrato api.md §1 (RATE_LIMITED):
//  - default:    600/min por workspace (logado) ou por IP (público). Cobre polling de 5 s com folga.
//  - expensive:  20/min por workspace, só nas rotas @ExpensiveAction() (ações caras: geração).
//  - loginIp:    20/min por IP, só nas rotas @LoginThrottle().
//  - loginEmail: 5/min por IP + e-mail, só nas rotas @LoginThrottle().
// default e expensive leem THROTTLE_DEFAULT_PER_MIN / THROTTLE_EXPENSIVE_PER_MIN; em NODE_ENV=test, sem a variável,
// sobem 100x (a suíte de contrato dispara dezenas de ações caras por minuto no mesmo workspace). Login não muda em teste.
const MINUTE = 60_000;

const EXPENSIVE_KEY = 'throttleExpensive';
const LOGIN_KEY = 'throttleLogin';
/** Ação cara (geração): conta também no limite de 20/min por workspace. */
export const ExpensiveAction = () => SetMetadata(EXPENSIVE_KEY, true);
/** Login e aceite de convite: 5/min por IP + e-mail e 20/min por IP. */
export const LoginThrottle = () => SetMetadata(LOGIN_KEY, true);

const OPT_IN: Record<string, string> = { expensive: EXPENSIVE_KEY, loginIp: LOGIN_KEY, loginEmail: LOGIN_KEY };

export function buildThrottlers(env: NodeJS.ProcessEnv = process.env): ThrottlerOptions[] {
  const isTest = env.NODE_ENV === 'test';
  const read = (key: string, fallback: number) => {
    const v = Number(env[key]);
    return Number.isFinite(v) && v > 0 ? v : isTest ? fallback * 100 : fallback;
  };
  return [
    { name: 'default', ttl: MINUTE, limit: read('THROTTLE_DEFAULT_PER_MIN', 600) },
    { name: 'expensive', ttl: MINUTE, limit: read('THROTTLE_EXPENSIVE_PER_MIN', 20) },
    { name: 'loginIp', ttl: MINUTE, limit: 20, getTracker: (req) => `ip:${req.ip}` },
    {
      name: 'loginEmail',
      ttl: MINUTE,
      limit: 5,
      getTracker: (req) => {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        return `ipmail:${req.ip}:${email}`;
      },
    },
  ];
}

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async handleRequest(p: ThrottlerRequest): Promise<boolean> {
    const key = OPT_IN[p.throttler.name ?? ''];
    if (key) {
      const on = this.reflector.getAllAndOverride<boolean>(key, [p.context.getHandler(), p.context.getClass()]);
      if (!on) return true;
    }
    return super.handleRequest(p);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.auth?.workspaceId ? `ws:${req.auth.workspaceId}` : `ip:${req.ip}`;
  }

  protected async throwThrottlingException(_ctx: ExecutionContext, d: ThrottlerLimitDetail): Promise<void> {
    const ms = d.timeToBlockExpire || d.timeToExpire || d.ttl;
    const sec = ms > 1000 ? Math.ceil(ms / 1000) : Math.max(1, Math.ceil(ms));
    throw new AppException('RATE_LIMITED', { retryAfterSec: sec });
  }
}
