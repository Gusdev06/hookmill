// YouTube / TikTok / Instagram pela CLI da skill get-brolls (`gb.py`), §B3.1 item 4. SÓ A INTERFACE, DESLIGADA (D15:
// redes sociais exigem aceite de termo por workspace e não têm permissão comercial; o Gusta ainda não decidiu).
// Quando ligar: Python 3.12 + venv da skill + yt-dlp na imagem da API (arquiteto), pasta de projeto temporária por lote no
// /data, e as chamadas abaixo por child_process. Nada é baixado daqui hoje.
//   search:  gb.py search --provider youtube --query "<entidade ação>" --limit N --project <dir>
//   resolve: gb.py resolve --url <url TikTok/YouTube> --project <dir>
//   preview: gb.py preview --candidate <ID> --start S --end E --project <dir>   → files.contact_sheet, preview.frame_times_s
//   fetch:   gb.py permit … && gb.py fetch --candidate <ID> --project <dir> && gb.py verify --project <dir>
import type { BrollProvider } from '../contrato';
import { IntegracaoError } from '../erros';

export type SocialProvider = Extract<BrollProvider, 'youtube' | 'tiktok' | 'instagram'>;

export interface SocialBrollSource {
  provider: SocialProvider;
  /** false até a D15 (aceite por workspace) e a imagem Docker com a skill */
  enabled: boolean;
  /** comando que seria rodado (documentação viva; o teste confere) */
  command(kind: 'search' | 'resolve' | 'preview' | 'fetch', args: Record<string, string>): string[];
  assertEnabled(): void;
}

export function socialSourceFor(provider: SocialProvider): SocialBrollSource {
  return {
    provider,
    enabled: false,
    command(kind, a) {
      const base = ['scripts/gb.py', kind];
      if (kind === 'search') return [...base, '--provider', provider, '--query', a.query ?? '', '--limit', a.limit ?? '5', '--project', a.project ?? ''];
      if (kind === 'resolve') return [...base, '--url', a.url ?? '', '--project', a.project ?? ''];
      if (kind === 'preview') return [...base, '--candidate', a.candidate ?? '', '--start', a.start ?? '0', '--end', a.end ?? '5', '--project', a.project ?? ''];
      return [...base, '--candidate', a.candidate ?? '', '--project', a.project ?? ''];
    },
    assertEnabled() {
      throw new IntegracaoError('BROLL_SOURCE_NOT_SUPPORTED', `b-roll from ${provider} is disabled (D15)`, { reason: 'disabled_d15', provider });
    },
  };
}
