import { run, upload, download, ff, probe, log, OUT, join } from './lib.mjs';
const p = (f) => join(OUT, f);
const VOICE = 'woman in her early thirties, warm medium-low voice, calm confident pace, General American accent';
const prompt = (speech) => [
  'Locked-off static camera on a tripod: no zoom, no pan, no cut, the framing stays exactly as in the image.',
  'SOLO SHOT: the same woman from the image, the only person in the shot from the first frame to the last.',
  'She looks straight into the lens and talks in a podcast, lips moving in sync with every word, relaxed shoulders, both arms below the bottom edge of the frame.',
  `[Speaker, ${VOICE}]: "${speech}"`,
  'Only this one voice is heard, clear and close to the microphone, quiet room tone, no music.',
].join('\n');
const PLAN = {
  kling: { sec: 3, usdPerSec: 0.168, lines: ['You just need his number.', "Sixty seconds, it's all there.", 'Even the messages he deletes.'] },
  seedance: { sec: 4, usdPerSec: 0.12, lines: ['Did you know you can read every message he sends?', 'You just need his number, sixty seconds, that is it.', 'Even the messages he deletes are still right there.'] },
};
const only = process.argv[2] ? process.argv[2].split(',') : Object.keys(PLAN);
const est = only.reduce((a, k) => a + PLAN[k].sec * PLAN[k].usdPerSec * PLAN[k].lines.length, 0);
log(`=== S2 (B) plano ${only.join('+')}: ${only.map((k) => `${k} ${PLAN[k].lines.length}×${PLAN[k].sec}s×${PLAN[k].usdPerSec}`).join(' + ')} = ~US$ ${est.toFixed(3)} (Seedance pela página 0,12/s; sonda anterior cobrou 0,108)`);
const faceUrl = await upload(p('face.png'));
async function chain(engine) {
  const c = PLAN[engine];
  for (let k = 0; k < c.lines.length; k++) {
    // janela 1 parte do último frame da 0 (mesmo trecho); janela 2 = trecho novo, parte do rosto
    let image = faceUrl;
    if (k === 1) {
      ff('-sseof', '-0.1', '-i', p(`s2-${engine}-0.mp4`), '-update', '1', '-frames:v', '1', p(`s2-${engine}-0-last.png`));
      image = await upload(p(`s2-${engine}-0-last.png`));
    }
    const body = engine === 'kling'
      ? { image, prompt: prompt(c.lines[k]), negative_prompt: 'second person, extra people, music, subtitles, text, watermark, zoom, camera movement, cut', duration: c.sec, sound: true, cfg_scale: 0.5 }
      : { image, prompt: prompt(c.lines[k]), duration: c.sec, resolution: '480p', aspect_ratio: '4:3', generate_audio: true };
    const model = engine === 'kling' ? 'kwaivgi/kling-v3.0-pro/image-to-video' : 'bytedance/seedance-2.0/image-to-video';
    const r = await run(model, body, { label: `S2 ${engine} w${k}`, estUsd: c.sec * c.usdPerSec });
    await download(r.outputs[0], p(`s2-${engine}-${k}.mp4`));
    log(`S2 ${engine} w${k} probe ` + JSON.stringify(probe(p(`s2-${engine}-${k}.mp4`))));
  }
}
await Promise.all(only.map((e) => chain(e).catch((err) => log(`S2 ${e} FALHOU ${err.message}`))));
