// Etapa 2: nos 3 vídeos do S2, com o estilo da GRADE (mesma entrada do aprovado, para a comparação de pixel ser limpa): TELEA r5/r3/ROI, placa E2, W1. ROI na E2 só no 05.
import path from 'node:path';
import { invocar, urlGet, urlPut, baixar, RAIZ } from './s1.mjs';
const VS = { '02': true, '05': false, '13': false }; const so = process.argv.slice(2);
for (const v of ['13', '02', '05']) {
  if (so.length && !so.includes(v)) continue; const caixa = VS[v];
  const b = { 'video.mp4': await urlGet(`in/v${v}.mp4`), 'd.npz': await urlGet(`out/d${v}${caixa ? '' : 'nc'}.npz`), 'estilo.json': await urlGet(`in/grade${v}.json`) };
  await invocar(`telea ${v}`, { op: 'bench_telea', caixa, get: b, put: {} }, { max_s: 200 });
  await invocar(`placa E2 ${v}`, { op: 'placa', caixa, get: b, put: { placa: await urlPut(`out/placa${v}.mp4`), m: await urlPut(`out/m${v}.npz`) } }, { max_s: 300 });
  await invocar(`W1 ${v}`, { op: 'escrever', v, caixa, get: { ...b, 'placa.mp4': await urlGet(`out/placa${v}.mp4`), 'm.npz': await urlGet(`out/m${v}.npz`), 'w.json': await urlGet(`in/w${v}.json`) }, put: { inteiro: await urlPut(`out/inteiro${v}.mp4`) } }, { max_s: 120 });
  await baixar(`out/placa${v}.mp4`, path.join(RAIZ, `saida/placa-${v}-E2.mp4`)); await baixar(`out/inteiro${v}.mp4`, path.join(RAIZ, `saida/${v}-E2-W1-tr-inteiro.mp4`));
  if (v === '05') { await invocar(`placa E2 ROI ${v}`, { op: 'placa', roi: true, caixa, get: b, put: { placa: await urlPut(`out/placa${v}-roi.mp4`) } }, { max_s: 300 }); await baixar(`out/placa${v}-roi.mp4`, path.join(RAIZ, `saida/placa-${v}-E2-roi.mp4`)); }
}
