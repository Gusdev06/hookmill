// meta-v1.md §3.4/§8: com META_MODE=off TODA rota da Meta (/meta/* e /creatives/:id/meta/*) responde
// 503 META_NOT_CONFIGURED { reason: 'off' }. O web detecta "off" pelo 503 do GET /meta/connection (use-meta.ts isMetaOff)
// e esconde as superfícies da Meta. Roda depois do AuthGuard global (anônimo continua 401).
import { CanActivate, Injectable } from '@nestjs/common';
import { AppException } from '../common/errors/app-exception';
import { AppConfig } from '../config/app-config';

@Injectable()
export class MetaModeGuard implements CanActivate {
  constructor(private readonly config: AppConfig) {}

  canActivate(): boolean {
    if (this.config.metaMode === 'off') throw new AppException('META_NOT_CONFIGURED', { reason: 'off' });
    return true;
  }
}
