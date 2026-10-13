import { run, upload, download, ff, probe, log, OUT, join } from './lib.mjs';
const p = (f) => join(OUT, f);
log('=== S1 (A) plano: Kling 5 s sem som US$ 0.560 + lipsync-2 4.1 s US$ 0.205 + infinitetalk v2v 480p 4.1 s ~US$ 0.123 + lipsync-1.9.0-beta 4.1 s US$ 0.103 = ~US$ 0.99');
const face = await upload(p('face.png'));
const prompt = [
  'Locked-off static camera on a tripod: no zoom, no pan, no cut, the framing stays exactly as in the image for the whole shot.',
  'SOLO SHOT: the same woman from the image, the only person in the shot from the first frame to the last.',
  'She talks naturally to the camera in a podcast, looking into the lens, lips moving with clear speech, small natural head motion, relaxed shoulders, both arms below the bottom edge of the frame.',
  'Soft window light from the left stays constant; the background stays still.',
].join(' ');
const k = await run('kwaivgi/kling-v3.0-pro/image-to-video', { image: face, prompt, negative_prompt: 'second person, extra people, hands near face, text, subtitles, watermark, zoom, camera movement, cut', duration: 5, sound: false, cfg_scale: 0.5 }, { label: 'S1 kling 5s mudo', estUsd: 0.56 });
await download(k.outputs[0], p('s1-kling.mp4'));
log('kling probe ' + JSON.stringify(probe(p('s1-kling.mp4'))));
// trecho = 4.1 s × 30 fps = 123 frames, sem som
ff('-i', p('s1-kling.mp4'), '-vf', 'fps=30', '-frames:v', '123', '-an', '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', p('s1-raw.mp4'));
log('raw probe ' + JSON.stringify(probe(p('s1-raw.mp4'))));
const [vid, aud] = await Promise.all([upload(p('s1-raw.mp4')), upload(p('s1-audio.wav'))]);
const jobs = [
  ['sync/lipsync-2', { video: vid, audio: aud, sync_mode: 'cut_off' }, 'S1 lipsync-2', 0.205, 's1-lipsync2.mp4'],
  ['wavespeed-ai/infinitetalk/video-to-video', { video: vid, audio: aud, resolution: '480p', seed: 7, prompt: 'The same woman keeps talking to the camera in a podcast, natural lip sync, same face, same framing, static camera.' }, 'S1 infinitetalk-v2v-480p', 0.123, 's1-infinitetalk.mp4'],
  ['sync/lipsync-1.9.0-beta', { video: vid, audio: aud, sync_mode: 'cut_off' }, 'S1 lipsync-1.9-beta', 0.103, 's1-lipsync19.mp4'],
];
await Promise.all(jobs.map(async ([m, body, label, est, file]) => {
  try {
    const r = await run(m, body, { label, estUsd: est });
    await download(r.outputs[0], p(file));
    log(`${label} probe ` + JSON.stringify(probe(p(file))));
  } catch (e) { log(`${label} FALHOU ${e.message}`); }
}));
