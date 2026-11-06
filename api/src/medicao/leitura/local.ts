// Adaptador local da leitura (ANALYZE_IMPL=local, o padrão): as etapas rodam no processo da API, como antes de 31/10.
// Também é o fallback do adaptador lambda. Tudo preguiçoso: o vídeo só é baixado quando uma etapa precisa dele.
import { join } from 'node:path';
import type { EditLayer } from '@maquina/contratos';
import type { MediaAnalysisService } from '../contrato';
import { ler, medir, refinar, type Probe, type RefinarEntrada } from './etapas';
import type { LeituraAbertura, LeituraMidia, LeituraSessao, LerResultado, MedirPedido, MedirResultado, StorageDaLeitura } from './contrato';

export interface Ferramentas { media: MediaAnalysisService; ffmpeg: string; aviso?: (m: string) => void }

export class LeituraLocal implements LeituraMidia {
  readonly impl = 'local' as const;
  constructor(private readonly storage: StorageDaLeitura, private readonly f: Ferramentas) {}
  abrir(a: LeituraAbertura): SessaoLocal {
    return new SessaoLocal(this.storage, this.f, a);
  }
}

export class SessaoLocal implements LeituraSessao {
  readonly ultimaImpl = 'local' as const;
  private videoP: Promise<string> | null = null;
  private audioP: Promise<string | null> | null = null;
  private probe: Probe | null = null;

  constructor(private readonly storage: StorageDaLeitura, private readonly f: Ferramentas, private readonly a: LeituraAbertura) {}

  /** O ler da Lambda deu o probe; o fallback continua daqui sem decodificar de novo. */
  comProbe(p: Probe) { this.probe = p; }

  private video(): Promise<string> {
    if (!this.videoP) {
      const path = join(this.a.dir, `video${extDe(this.a.video.storageKey)}`);
      this.videoP = this.storage.downloadTo(this.a.video, path).then(() => path);
      this.videoP.catch(() => { this.videoP = null; });
    }
    return this.videoP;
  }

  /** Áudio pros silêncios: o já extraído nesta sessão, o gravado (nova tentativa) ou extrai agora. */
  private audio(): Promise<string | null> {
    if (!this.audioP) {
      this.audioP = (async () => {
        const p = this.probe ?? await this.f.media.probe(await this.video());
        if (!p.hasAudio) return null;
        const path = join(this.a.dir, 'audio.m4a');
        if (this.a.audio) await this.storage.downloadTo(this.a.audio, path);
        else await this.f.media.extractAudio(await this.video(), path);
        return path;
      })();
      this.audioP.catch(() => { this.audioP = null; });
    }
    return this.audioP;
  }

  async ler(extrairAudio: boolean): Promise<LerResultado> {
    const r = await ler(this.f.media, await this.video(), this.a.dir, extrairAudio && !this.a.audio);
    this.probe = r.probe;
    if (r.audio) this.audioP = Promise.resolve(r.audio.path);
    return { probe: r.probe, audio: r.audio ? { artefato: { tipo: 'local', path: r.audio.path }, durationSec: r.audio.durationSec } : null };
  }

  async medir(p: MedirPedido): Promise<MedirResultado> {
    if (!this.probe) throw new Error('leitura: medir antes de ler');
    const video = await this.video();
    const r = await medir(this.f.media, this.f.ffmpeg, video, this.a.dir, { ...p, probe: this.probe, audioPath: p.medir ? await this.audio() : null }, this.f.aviso);
    return {
      medidas: r.medidas ? { ...r.medidas, keyframes: r.medidas.keyframes.map(({ path, ...k }) => ({ ...k, artefato: { tipo: 'local', path } })) } : null,
      trilha: r.trilha,
      recortes: r.recortes.map(({ path, ...c }) => ({ ...c, artefato: { tipo: 'local', path } })),
    };
  }

  async refinar(p: RefinarEntrada): Promise<EditLayer[]> {
    return refinar(this.f.media, await this.video(), p, this.f.aviso);
  }
}

export function extDe(key: string): string {
  const m = key.match(/\.[a-z0-9]{2,4}$/i);
  return m ? m[0] : '.mp4';
}
