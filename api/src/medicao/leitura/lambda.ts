// Adaptador lambda da leitura (ANALYZE_IMPL=lambda, leitura-lambda-v1 §3-4). A API orquestra; cada etapa de mídia vira
// 1 invocação síncrona da função `hookmill-leitura` (handler.ts, o mesmo código das etapas). Vídeo entra por GET
// pré-assinado; áudio, frames-chave e recortes voltam ao storage por PUT pré-assinado. Falha de infraestrutura
// (throttling, timeout, erro da função, rede) = fallback local na mesma sessão. Vídeo inválido não tem fallback.
import type { EditLayer } from '@maquina/contratos';
import { MediaInvalidError } from '../contrato';
import type { Probe, RefinarEntrada } from './etapas';
import { MAX_KEYFRAMES, MAX_TEXT_CROPS } from './etapas';
import type {
  Artefato, EventoLeitura, LeituraAbertura, LeituraMidia, LeituraSessao, LerResultado, MedirPedido, MedirResultado, PutRemoto,
  RespostaLeitura, StorageDaLeitura, VideoRemoto,
} from './contrato';
import { LEITURA_EVENTO_VERSAO } from './contrato';
import { LeituraLocal, type SessaoLocal } from './local';

/** Fronteira com a AWS (trocada por falso no Jest). Devolve o JSON da função ou lança ErroInvocacao. */
export interface InvocadorLambda {
  invocar(evento: EventoLeitura): Promise<RespostaLeitura>;
}

/** Falha de infraestrutura (não do vídeo): vai pro fallback local. */
export class ErroInvocacao extends Error {
  constructor(readonly tipo: 'throttle' | 'timeout' | 'function_error' | 'rede' | 'resposta', message: string) {
    super(message);
    this.name = 'ErroInvocacao';
  }
}

export interface LeituraLambdaConfig {
  /** on = falha de infraestrutura cai pro local (padrão); off = a análise falha (teste da Lambda isolada). */
  fallback: boolean;
  /** Validade dos PUT/GET pré-assinados mandados à função. */
  urlTtlSec: number;
}

export class LeituraLambda implements LeituraMidia {
  readonly impl = 'lambda' as const;
  constructor(
    private readonly invocador: InvocadorLambda,
    private readonly storage: StorageDaLeitura,
    private readonly local: LeituraLocal,
    private readonly cfg: LeituraLambdaConfig,
    private readonly log: { warn(m: string): void; log?(m: string): void } = console,
  ) {}
  abrir(a: LeituraAbertura): LeituraSessao {
    return new SessaoLambda(this.invocador, this.storage, this.local.abrir(a), this.cfg, this.log, a);
  }
}

class SessaoLambda implements LeituraSessao {
  ultimaImpl: 'local' | 'lambda' | null = null;
  private probe: Probe | null = null;
  /** Depois da 1ª falha de infraestrutura, o resto da análise fica no local (não paga 2 timeouts). */
  private degradada = false;
  private videoP: Promise<VideoRemoto> | null = null;

  constructor(
    private readonly inv: InvocadorLambda,
    private readonly storage: StorageDaLeitura,
    private readonly local: SessaoLocal,
    private readonly cfg: LeituraLambdaConfig,
    private readonly log: { warn(m: string): void; log?(m: string): void },
    private readonly a: LeituraAbertura,
  ) {}

  private video(): Promise<VideoRemoto> {
    this.videoP ??= this.storage.signedUrl(this.a.video).then((url) => ({ url, cacheKey: this.a.video.storageKey }));
    return this.videoP;
  }

  private async put(kind: 'CHAMPION_AUDIO' | 'CHAMPION_FRAME', mimeType: string): Promise<PutRemoto & { key: string }> {
    const key = this.storage.newKey(this.a.workspaceId, kind, mimeType);
    return { key, contentType: mimeType, url: await this.storage.presignPut(key, { contentType: mimeType, expiresInSec: this.cfg.urlTtlSec }) };
  }

  /** Invoca; MediaInvalidError passa direto; o resto vira fallback (ou lança, com fallback off). */
  private async tentar<T>(op: string, remoto: () => Promise<T>, local: () => Promise<T>): Promise<T> {
    if (!this.degradada) {
      try {
        const r = await remoto();
        this.ultimaImpl = 'lambda';
        return r;
      } catch (e) {
        if (e instanceof MediaInvalidError) throw e;
        if (!this.cfg.fallback) throw e;
        this.degradada = true;
        this.log.warn(`leitura lambda (${op}) falhou, segue no local: ${(e as Error).message}`);
      }
    }
    const r = await local();
    this.ultimaImpl = 'local';
    return r;
  }

  private async invocar<O extends EventoLeitura['op']>(evento: EventoLeitura & { op: O }): Promise<Extract<RespostaLeitura, { ok: true; op: O }>> {
    const r = await this.inv.invocar(evento);
    if (!r || typeof r !== 'object') throw new ErroInvocacao('resposta', 'resposta vazia da função');
    if (r.ok === false) {
      if (r.erro.name === 'MediaInvalidError') {
        const reason = (['no_video', 'undecodable', 'too_small'] as const).find((x) => x === r.erro.reason) ?? 'undecodable';
        throw new MediaInvalidError(reason, r.erro.message);
      }
      throw new ErroInvocacao('function_error', `${r.erro.name}: ${r.erro.message}`);
    }
    if (r.op !== evento.op) throw new ErroInvocacao('resposta', `resposta de ${r.op} pra ${evento.op}`);
    for (const a of r.avisos ?? []) this.log.warn(`leitura lambda: ${a}`);
    this.log.log?.(`leitura lambda ${evento.op}: ${r.tempos.totalMs} ms (download ${r.tempos.downloadMs}, etapa ${r.tempos.etapaMs}, upload ${r.tempos.uploadMs}${r.tempos.fria ? ', fria' : ''})`);
    return r as Extract<RespostaLeitura, { ok: true; op: O }>;
  }

  async ler(extrairAudio: boolean): Promise<LerResultado> {
    const pedirAudio = extrairAudio && !this.a.audio;
    const r = await this.tentar('ler', async () => {
      const audioPut = pedirAudio ? await this.put('CHAMPION_AUDIO', 'audio/mp4') : null;
      const resp = await this.invocar({ v: LEITURA_EVENTO_VERSAO, op: 'ler', video: await this.video(), audioPut: audioPut ? { url: audioPut.url, contentType: audioPut.contentType } : null });
      const { probe, audio } = resp.resultado;
      return {
        probe,
        audio: audio && audioPut ? { artefato: { tipo: 'storage', key: audioPut.key, sizeBytes: audio.sizeBytes, mimeType: 'audio/mp4' } as Artefato, durationSec: audio.durationSec } : null,
      };
    }, () => this.local.ler(extrairAudio));
    this.probe = r.probe;
    this.local.comProbe(r.probe);
    return r;
  }

  async medir(p: MedirPedido): Promise<MedirResultado> {
    if (!this.probe) throw new Error('leitura: medir antes de ler');
    const probe = this.probe;
    return this.tentar('medir', async () => {
      const frames = p.medir ? await Promise.all(Array.from({ length: MAX_KEYFRAMES }, () => this.put('CHAMPION_FRAME', 'image/jpeg'))) : [];
      const crops = p.mapear ? await Promise.all(Array.from({ length: MAX_TEXT_CROPS }, () => this.put('CHAMPION_FRAME', 'image/jpeg'))) : [];
      const sem = ({ key: _k, ...x }: PutRemoto & { key: string }) => x;
      const resp = await this.invocar({
        v: LEITURA_EVENTO_VERSAO, op: 'medir', video: await this.video(), probe, medir: p.medir, segmentos: p.segmentos, mapear: p.mapear,
        framePuts: frames.map(sem), cropPuts: crops.map(sem),
      });
      const r = resp.resultado;
      const art = (lista: { key: string }[], slot: number, sizeBytes: number): Artefato => {
        if (!lista[slot]) throw new ErroInvocacao('resposta', `slot ${slot} fora da lista`);
        return { tipo: 'storage', key: lista[slot].key, sizeBytes, mimeType: 'image/jpeg' };
      };
      return {
        medidas: r.medidas ? { ...r.medidas, keyframes: r.medidas.keyframes.map(({ slot, sizeBytes, ...k }) => ({ ...k, artefato: art(frames, slot, sizeBytes) })) } : null,
        trilha: r.trilha,
        recortes: r.recortes.map(({ slot, sizeBytes, ...c }) => ({ ...c, artefato: art(crops, slot, sizeBytes) })),
      };
    }, () => this.local.medir(p));
  }

  async refinar(p: RefinarEntrada): Promise<EditLayer[]> {
    return this.tentar('refinar', async () => {
      const resp = await this.invocar({ v: LEITURA_EVENTO_VERSAO, op: 'refinar', video: await this.video(), entrada: p });
      return resp.resultado.layers;
    }, () => this.local.refinar(p));
  }
}
