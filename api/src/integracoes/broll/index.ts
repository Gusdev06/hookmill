// b-roll da 2ª fonte das molduras (§B3.1). O backend liga um `BrollSink` (StorageService.put + URL assinada) e escolhe
// live/mock com `createBrollService`. Pexels é o padrão (decisão 25/10); redes sociais desligadas (D15).
import Anthropic from '@anthropic-ai/sdk';
import type { CostStore } from '../portas';
import { SdkClaudeTransport } from '../claude/transporte';
import { WaveSpeedClient } from '../wavespeed/cliente';
import { PexelsBrollService, type BrollSink } from './broll.service';
import { FakeBrollService } from './fake-broll.service';
import { ffmpegOf } from './folha';
import { PexelsClient } from './pexels';

export * from './broll.service';
export { FakeBrollService } from './fake-broll.service';
export { PexelsClient } from './pexels';
export { socialSourceFor } from './social';

export type BrollService = PexelsBrollService | FakeBrollService;

/** live precisa de PEXELS_API_KEY + ANTHROPIC_API_KEY (WAVESPEED_API_KEY só pra imagem de reserva). Sem chave = null (o
 *  backend responde BROLL_SOURCE_NOT_SUPPORTED / cai pro champion_segment). */
export function createBrollService(i: {
  mode: 'mock' | 'live'; costs: CostStore; sink: BrollSink; publicApiUrl: string;
  env?: NodeJS.ProcessEnv;
}): BrollService | null {
  const env = i.env ?? process.env;
  if (i.mode === 'mock') return new FakeBrollService(i.costs, { publicApiUrl: i.publicApiUrl });
  if (!env.PEXELS_API_KEY || !env.ANTHROPIC_API_KEY) return null;
  const transport = new SdkClaudeTransport(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 }), { model: env.ANTHROPIC_MODEL || 'claude-opus-5-5', effort: 'medium', fallbacks: false });
  return new PexelsBrollService({
    pexels: new PexelsClient({ apiKey: env.PEXELS_API_KEY }),
    transport, costs: i.costs, ffmpeg: ffmpegOf(env.FFMPEG_PATH || 'ffmpeg'), sink: i.sink,
    wavespeed: env.WAVESPEED_API_KEY ? new WaveSpeedClient({ apiKey: env.WAVESPEED_API_KEY }) : null,
    model: env.BROLL_MODEL || undefined,
  });
}
