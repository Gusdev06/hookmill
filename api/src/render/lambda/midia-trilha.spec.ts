// Moldura com trilha de b-roll (25/10): a checagem de mídia do submit valida CADA clipe da trilha.
import { problemasDeMidia } from './midia';

describe('checagem de mídia: trilha de b-roll da moldura', () => {
  const agoraMs = Date.UTC(2026, 9, 25, 12, 0, 0);
  const assinada = (k: string, exp = 21600) => `https://x.storage.supabase.co/storage/v1/s3/hookmill-dev/${k}?X-Amz-Date=20261025T120000Z&X-Amz-Expires=${exp}&X-Amz-Signature=abc`;
  const props = (clips: string[]) => ({
    video: { source: { videoUrl: assinada('c.mp4') } },
    second: { kind: 'broll_track', clips: clips.map((fileUrl, i) => ({ fromSec: i * 2, toSec: i * 2 + 2, fileUrl, srcStartSec: 0, srcEndSec: 2, provenance: { sourceUrl: 'https://www.pexels.com/video/1/' } })) },
  });
  it('todos os clipes assinados e públicos: ok', () => {
    expect(problemasDeMidia(props([assinada('a.mp4'), assinada('b.mp4'), assinada('c2.mp4')]), { agoraMs, minTtlSec: 3600 })).toEqual([]);
  });
  it('um clipe local, um vencendo e um em localhost: cada um aparece com o caminho do clipe', () => {
    const r = problemasDeMidia(props([assinada('a.mp4'), 'fixtures/x.mp4', assinada('b.mp4', 60), 'http://127.0.0.1:9000/c.mp4']), { agoraMs, minTtlSec: 3600 });
    expect(r.map((x) => x.caminho)).toEqual(['second.clips[1].fileUrl', 'second.clips[2].fileUrl', 'second.clips[3].fileUrl']);
  });
});
