// Etapa 1: sobe entradas, detectar (sem caixa e, nos vídeos de karaokê em caixa, com caixa) e ajustar novo.
import path from 'node:path';
import { invocar, subir, urlGet, urlPut, baixar, RAIZ } from './s1.mjs';
const S2 = path.resolve(RAIZ, '../limpar-legenda-teste-2026-11-05-s2/work');
const VS = { '02': { caixa: true }, '05': { caixa: false }, '13': { caixa: false }, '120': { caixa: true } };
const so = process.argv.slice(2);
for (const [v, c] of Object.entries(VS)) {
  if (so.length && !so.includes(v)) continue;
  const video = v === '120' ? path.join(RAIZ, 'entrada/v120.mp4') : path.join(S2, `v${v}.mp4`);
  const w = v === '120' ? path.join(RAIZ, 'medidas/w120.json') : path.join(S2, `w${v}.json`);
  await subir(video, `in/v${v}.mp4`); await subir(w, `in/w${v}.json`);
  if (v !== '120') await subir(path.join(S2, `estilo${v}.json`), `in/grade${v}.json`);
  const vurl = await urlGet(`in/v${v}.mp4`); const FX = process.env.FAIXA ? JSON.parse(process.env.FAIXA) : undefined; const sufixo = FX ? ' faixa-dica' : '';
  if (process.env.SO_AJUSTAR !== '1') await invocar(`detectar ${v} sem-caixa${sufixo}`, { op: 'detectar', caixa: false, faixa: FX, get: { 'video.mp4': vurl }, put: { d: await urlPut(`out/d${v}nc.npz`) } }, { max_s: 200 });
  if (c.caixa && process.env.SO_AJUSTAR !== '1') await invocar(`detectar ${v} caixa${sufixo}`, { op: 'detectar', caixa: true, faixa: FX, get: { 'video.mp4': vurl }, put: { d: await urlPut(`out/d${v}.npz`) } }, { max_s: 200 });
  const r = await invocar(`ajustar ${v}${sufixo}`, { op: 'ajustar', get: { 'video.mp4': vurl, 'd.npz': await urlGet(`out/d${v}nc.npz`), 'w.json': await urlGet(`in/w${v}.json`) }, put: { estilo: await urlPut(`out/rap${v}.json`) } }, { max_s: 60 });
  console.log(JSON.stringify(r.saida.T), JSON.stringify(r.saida.estilo));
  await baixar(`out/rap${v}.json`, path.join(RAIZ, `medidas/estilo-rapido-${v}.json`));
}
