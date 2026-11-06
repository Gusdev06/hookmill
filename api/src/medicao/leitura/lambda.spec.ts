// leitura-lambda-v1 §6: adaptador lambda da leitura com o invocador e o storage falsos (sem AWS, sem ffmpeg).
import { MediaInvalidError, type MediaAnalysisService } from '../contrato';
import type { EventoLeitura, RespostaLeitura, StorageDaLeitura } from './contrato';
import { ErroInvocacao, LeituraLambda, type InvocadorLambda } from './lambda';
import { LeituraLocal } from './local';
import { criarLeitura, leituraConfig } from './index';

const PROBE = { durationSec: 12, width: 720, height: 1280, fps: 30, hasAudio: true, videoCodec: 'h264' };
const tempos = { totalMs: 10, downloadMs: 1, etapaMs: 8, uploadMs: 1, fria: false, cacheVideo: true };

class StorageFalso implements StorageDaLeitura {
  n = 0;
  baixados: string[] = [];
  async downloadTo(f: { storageKey: string }) { this.baixados.push(f.storageKey); }
  async signedUrl(f: { storageKey: string }) { return `https://storage.test/${f.storageKey}?sig=1`; }
  newKey(ws: string, kind: string) { return `ws/${ws}/${kind.toLowerCase()}/k${this.n++}.bin`; }
  async presignPut(key: string, o: { contentType: string }) { return `https://storage.test/${key}?put=1&ct=${o.contentType}`; }
}

class InvocadorFalso implements InvocadorLambda {
  eventos: EventoLeitura[] = [];
  constructor(private readonly resp: (e: EventoLeitura) => RespostaLeitura | Promise<RespostaLeitura>) {}
  async invocar(e: EventoLeitura) { this.eventos.push(e); return this.resp(e); }
}

/** Mídia falsa: só o que o `ler` local usa (fallback). */
function mediaFalsa(): MediaAnalysisService & { chamadas: string[] } {
  const chamadas: string[] = [];
  return {
    chamadas,
    validateFull: async () => { chamadas.push('validateFull'); },
    probe: async () => { chamadas.push('probe'); return PROBE; },
    extractAudio: async () => { chamadas.push('extractAudio'); return { durationSec: 12 }; },
  } as unknown as MediaAnalysisService & { chamadas: string[] };
}

const abertura = { workspaceId: 'ws1', video: { storageKey: 'ws/ws1/champion_video/v.mp4' }, audio: null, dir: '/tmp/nao-usado' };
const log = { warn: jest.fn(), log: jest.fn() };

function montar(resp: (e: EventoLeitura) => RespostaLeitura | Promise<RespostaLeitura>, fallback = true) {
  const storage = new StorageFalso();
  const media = mediaFalsa();
  const inv = new InvocadorFalso(resp);
  const leitura = new LeituraLambda(inv, storage, new LeituraLocal(storage, { media, ffmpeg: 'ffmpeg' }), { fallback, urlTtlSec: 3600 }, log);
  return { storage, media, inv, sess: leitura.abrir(abertura) };
}

const okLer = (e: EventoLeitura): RespostaLeitura => ({
  ok: true, op: 'ler', tempos, avisos: [],
  resultado: { probe: PROBE, audio: e.op === 'ler' && e.audioPut ? { durationSec: 11.9, sizeBytes: 1234 } : null },
});

describe('LeituraLambda', () => {
  beforeEach(() => jest.clearAllMocks());

  it('ler: manda o GET do vídeo e o PUT do áudio; devolve o áudio como artefato já no storage', async () => {
    const { inv, sess, storage } = montar(okLer);
    const r = await sess.ler(true);
    expect(r.probe).toEqual(PROBE);
    expect(r.audio).toEqual({ durationSec: 11.9, artefato: { tipo: 'storage', key: 'ws/ws1/champion_audio/k0.bin', sizeBytes: 1234, mimeType: 'audio/mp4' } });
    const e = inv.eventos[0] as Extract<EventoLeitura, { op: 'ler' }>;
    expect(e).toMatchObject({ v: 1, op: 'ler', video: { url: expect.stringContaining('champion_video/v.mp4'), cacheKey: abertura.video.storageKey } });
    expect(e.audioPut).toEqual({ url: expect.stringContaining('put=1&ct=audio/mp4'), contentType: 'audio/mp4' });
    expect(sess.ultimaImpl).toBe('lambda');
    expect(storage.baixados).toEqual([]); // a API não baixa o vídeo
  });

  it('medir: 16 PUTs de frame e 6 de recorte; slots viram as chaves certas; trilha passa como veio', async () => {
    const trilha = { ok: true as const, valor: { width: 720, height: 1280, fps: 30, frameCount: 360, cells: [], segments: [], stats: [], blockers: [], otherFaceCells: [], timeline: [] } };
    const { inv, sess } = montar((e) => e.op === 'ler' ? okLer(e) : {
      ok: true, op: 'medir', tempos, avisos: ['recorte de faixa 2 falhou: x'],
      resultado: {
        medidas: { ...PROBE, cuts: [], segments: [], palette: ['#000000'], silences: [], keyframes: [{ atSec: 0, reason: 't0', slot: 0, sizeBytes: 10 }, { atSec: 11.9, reason: 'end', slot: 1, sizeBytes: 11 }] },
        trilha, recortes: [{ atSec: 6, box: { x: 0, y: 0, w: 720, h: 100 }, slot: 0, sizeBytes: 12 }],
      },
    });
    await sess.ler(true);
    const r = await sess.medir({ medir: true, mapear: true });
    const e = inv.eventos[1] as Extract<EventoLeitura, { op: 'medir' }>;
    expect(e.framePuts).toHaveLength(16);
    expect(e.cropPuts).toHaveLength(6);
    expect(e.probe).toEqual(PROBE);
    expect(r.medidas!.keyframes.map((k) => (k.artefato as { key: string }).key)).toEqual(['ws/ws1/champion_frame/k1.bin', 'ws/ws1/champion_frame/k2.bin']);
    expect(r.recortes[0].artefato).toEqual({ tipo: 'storage', key: 'ws/ws1/champion_frame/k17.bin', sizeBytes: 12, mimeType: 'image/jpeg' });
    expect(r.trilha).toEqual(trilha);
    expect(log.warn).toHaveBeenCalledWith('leitura lambda: recorte de faixa 2 falhou: x');
  });

  it('medir sem medição nova e sem mapa: nenhum PUT', async () => {
    const { inv, sess } = montar((e) => e.op === 'ler' ? okLer(e) : { ok: true, op: 'medir', tempos, avisos: [], resultado: { medidas: null, trilha: null, recortes: [] } });
    await sess.ler(false);
    await sess.medir({ medir: false, mapear: false, segmentos: [] });
    const e = inv.eventos[1] as Extract<EventoLeitura, { op: 'medir' }>;
    expect(e.framePuts).toEqual([]);
    expect(e.cropPuts).toEqual([]);
    expect((inv.eventos[0] as Extract<EventoLeitura, { op: 'ler' }>).audioPut).toBeNull();
  });

  it('vídeo inválido na função = MediaInvalidError com o reason, sem fallback', async () => {
    const { sess, media } = montar(() => ({ ok: false, erro: { name: 'MediaInvalidError', message: 'não decodifica inteiro', reason: 'undecodable' } }));
    await expect(sess.ler(true)).rejects.toMatchObject({ name: 'MediaInvalidError', reason: 'undecodable' });
    await expect(sess.ler(true)).rejects.toBeInstanceOf(MediaInvalidError);
    expect(media.chamadas).toEqual([]);
  });

  it('throttling = fallback local; o resto da sessão fica no local sem invocar de novo', async () => {
    const { sess, inv, media, storage } = montar(() => { throw new ErroInvocacao('throttle', 'TooManyRequestsException: Rate exceeded'); });
    const r = await sess.ler(true);
    expect(r.probe).toEqual(PROBE);
    expect(r.audio?.artefato.tipo).toBe('local');
    expect(sess.ultimaImpl).toBe('local');
    expect(media.chamadas).toEqual(['validateFull', 'probe', 'extractAudio']);
    expect(storage.baixados).toEqual([abertura.video.storageKey]);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('segue no local'));
    await sess.refinar({ layers: [], fps: 30, frameCount: 360, words: [] });
    expect(inv.eventos).toHaveLength(1);
  });

  it('erro qualquer da função (ok:false) também cai no local', async () => {
    const { sess } = montar(() => ({ ok: false, erro: { name: 'Error', message: 'ENOSPC' } }));
    await expect(sess.ler(true)).resolves.toMatchObject({ probe: PROBE });
    expect(sess.ultimaImpl).toBe('local');
  });

  it('ANALYZE_LAMBDA_FALLBACK=off: a falha da infraestrutura sobe', async () => {
    const { sess, media } = montar(() => { throw new ErroInvocacao('timeout', 'TimeoutError'); }, false);
    await expect(sess.ler(true)).rejects.toBeInstanceOf(ErroInvocacao);
    expect(media.chamadas).toEqual([]);
  });

  it('resposta de outra op = erro de resposta (fallback)', async () => {
    const { sess } = montar(() => ({ ok: true, op: 'refinar', tempos, avisos: [], resultado: { layers: [] } }));
    await sess.ler(true);
    expect(sess.ultimaImpl).toBe('local');
  });
});

describe('leituraConfig / criarLeitura', () => {
  const env = (o: Record<string, string>) => (k: string) => o[k];
  it('padrão local; lambda com função, região e credenciais do render', () => {
    expect(leituraConfig(env({})).impl).toBe('lambda');
    expect(leituraConfig(env({})).fallback).toBe(false);
    expect(leituraConfig(env({ ANALYZE_IMPL: 'local' })).impl).toBe('local');
    const c = leituraConfig(env({ ANALYZE_IMPL: 'lambda', REMOTION_AWS_REGION: 'us-east-1', REMOTION_AWS_ACCESS_KEY_ID: 'a', REMOTION_AWS_SECRET_ACCESS_KEY: 'b' }));
    expect(c).toMatchObject({ impl: 'lambda', functionName: 'hookmill-leitura', region: 'us-east-1', fallback: false, timeoutMs: 620_000 });
    expect(() => leituraConfig(env({ ANALYZE_IMPL: 'nuvem' }))).toThrow(/inválido/);
  });
  it('lambda sem credencial falha no boot; local não precisa', () => {
    const deps = { storage: new StorageFalso(), media: mediaFalsa(), ffmpeg: 'ffmpeg', log };
    expect(() => criarLeitura(leituraConfig(env({ ANALYZE_IMPL: 'lambda' })), deps)).toThrow(/REMOTION_AWS_ACCESS_KEY_ID/);
    expect(criarLeitura(leituraConfig(env({ ANALYZE_IMPL: 'local' })), deps).impl).toBe('local');
  });
});
