// Troca de texto queimado (troca-texto-queimado-v1 §15.8, §16.5). Dono: video. Escolha do adaptador por PLATE_IMPL:
// off (padrão; o backend não chama a porta e fica no estado do F1a) | local (Python + Chrome no processo, só dev) | lambda.
import { ExecutorLambda, InvocadorTrocaAws, type InvocadorTroca, type StorageDaTroca } from './executor-lambda';
import { ExecutorLocal, pastaPython, type StorageLocalDaTroca } from './executor-local';
import { TrocaTextoOrquestrada } from './orquestra';
import type { TrocaTextoPort } from './porta';
import { ProvaPuppeteer, pastaDeFontes, type ProvaChrome } from './prova';

export * from './porta';
export type { MedidaHeadline, ResultadoRegua, EventoTroca, RespostaTroca, ExecutorTroca } from './evento';
export { FakeTrocaTexto, lookFake, type FakeTrocaOpcoes } from './fake';
export { TrocaTextoOrquestrada, ErroTroca, FANTASMA_MAX } from './orquestra';
export { escolherAlvo, geometria, centroUnico, montarLook, planejarPedacos, parametrosDaPlaca, rostosMain, folgaLegenda } from './look';
export { ProvaPuppeteer, SUAVIZA_PX, type ProvaChrome, type PedidoProva } from './prova';
export { ExecutorLocal } from './executor-local';
export { ExecutorLambda, InvocadorTrocaAws, lerReport, type StorageDaTroca, type InvocadorTroca } from './executor-lambda';

export type PlateImpl = 'off' | 'local' | 'lambda';

export interface TrocaConfig {
  impl: PlateImpl;
  functionName: string;
  region: string;
  accessKeyId: string | null;
  secretAccessKey: string | null;
  timeoutMs: number;
  maxChunks: number;
  urlTtlSec: number;
  memMb: number;
  python: string;
  pyDir: string | null;
  fontesDir: string | null;
  browserExecutable: string | null;
  /** vazio = todos os workspaces, com PLATE_IMPL ligado (§16.5) */
  workspaceIds: string[];
}

export function trocaConfig(get: (k: string) => string | undefined): TrocaConfig {
  const s = (k: string) => (get(k) ?? '').trim();
  const n = (k: string, d: number) => { const v = Number(s(k)); return Number.isFinite(v) && v > 0 ? v : d; };
  const impl = (s('PLATE_IMPL') || 'off').toLowerCase();
  if (!['off', 'local', 'lambda'].includes(impl)) throw new Error(`PLATE_IMPL=${impl} inválido (off | local | lambda)`);
  return {
    impl: impl as PlateImpl,
    functionName: s('PLATE_LAMBDA_FUNCTION') || 'hookmill-legenda',
    region: s('PLATE_LAMBDA_REGION') || s('REMOTION_AWS_REGION') || 'us-east-1',
    accessKeyId: s('REMOTION_AWS_ACCESS_KEY_ID') || null,
    secretAccessKey: s('REMOTION_AWS_SECRET_ACCESS_KEY') || null,
    timeoutMs: n('PLATE_LAMBDA_TIMEOUT_SEC', 320) * 1000,
    maxChunks: n('PLATE_MAX_CHUNKS', 40),
    urlTtlSec: n('SIGNED_URL_TTL_SEC', 21600),
    memMb: n('PLATE_LAMBDA_MEM_MB', 3008),
    python: s('TROCA_PYTHON') || 'python3',
    pyDir: s('TROCA_PY_DIR') || null,
    fontesDir: s('TROCA_FONTES_DIR') || null,
    browserExecutable: s('REMOTION_BROWSER_EXECUTABLE') || null,
    workspaceIds: s('PLATE_WORKSPACE_IDS').split(',').map((x) => x.trim()).filter(Boolean),
  };
}

/** Workspace liberado para a troca (§16.5: PLATE_WORKSPACE_IDS vazio = todos). */
export const trocaLiberada = (cfg: TrocaConfig, workspaceId: string) => cfg.impl !== 'off' && (!cfg.workspaceIds.length || cfg.workspaceIds.includes(workspaceId));

/**
 * Porta pelo PLATE_IMPL. `off` devolve null: o backend não chama (headline_pending). `lambda` sem credencial falha no boot.
 * Pedaços por placa: até 4 (§15.6.4); PLATE_MAX_CHUNKS é o teto global da aplicação, aplicado por quem enfileira o job.
 */
export function criarTrocaTexto(cfg: TrocaConfig, deps: {
  storage: StorageDaTroca & StorageLocalDaTroca;
  log?: { warn(m: string): void; log?(m: string): void };
  invocador?: InvocadorTroca;
  prova?: ProvaChrome;
  ffmpeg?: string;
  ffprobe?: string;
}): TrocaTextoPort | null {
  if (cfg.impl === 'off') return null;
  const fontesDir = pastaDeFontes(cfg.fontesDir);
  const prova = deps.prova ?? new ProvaPuppeteer({ browserExecutable: cfg.browserExecutable, fontesDir });
  if (cfg.impl === 'local') {
    const ex = new ExecutorLocal({ python: cfg.python, pyDir: pastaPython(cfg.pyDir), fontesDir, ffmpeg: deps.ffmpeg, ffprobe: deps.ffprobe }, deps.storage);
    return new TrocaTextoOrquestrada(ex, prova, { log: deps.log, maxPedacos: 4 });
  }
  if (!deps.invocador && (!cfg.accessKeyId || !cfg.secretAccessKey)) throw new Error('PLATE_IMPL=lambda sem REMOTION_AWS_ACCESS_KEY_ID / REMOTION_AWS_SECRET_ACCESS_KEY');
  const inv = deps.invocador ?? new InvocadorTrocaAws({ region: cfg.region, functionName: cfg.functionName, accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, timeoutMs: cfg.timeoutMs });
  return new TrocaTextoOrquestrada(new ExecutorLambda(inv, deps.storage, { urlTtlSec: cfg.urlTtlSec, memMb: cfg.memMb }), prova, { log: deps.log, maxPedacos: 4 });
}
