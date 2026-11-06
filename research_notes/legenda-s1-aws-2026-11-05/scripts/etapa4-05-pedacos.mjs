// Etapa 4: 05 e 02 (30 s) em 4 pedaços, para ver se o portão de 60 s fecha com paralelo. O contrato manda 1 invocação até 45 s: isto testa a alternativa.
import path from 'node:path'; import { readFileSync } from 'node:fs';
import { invocar, urlGet, urlPut, baixar, RAIZ } from './s1.mjs';
const log = readFileSync(path.join(RAIZ, 'medidas/invocacoes.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
for (const [v, caixa, rot, dk] of (process.argv[2] === '13' ? [['13', false, 'detectar 13 sem-caixa', 'd13nc']] : [['05', false, 'detectar 05 sem-caixa', 'd05nc'], ['02', true, 'detectar 02 caixa', 'd02']])) {
  const det = log.filter((r) => r.rotulo === rot).pop().saida; const N = det.quadros, tom = det.tomadas;
  const cortes = [0]; for (const k of [1, 2, 3]) { const a = Math.round(N * k / 4); const p = tom.reduce((x, y) => (Math.abs(y - a) < Math.abs(x - a) ? y : x)); cortes.push(Math.abs(p - a) < 0.2 * N / 4 ? p : a); } cortes.push(N);
  const b = { 'video.mp4': await urlGet(`in/v${v}.mp4`), 'd.npz': await urlGet(`out/${dk}.npz`), 'estilo.json': await urlGet(`in/grade${v}.json`) };
  console.log(v, 'cortes', cortes); const t0 = Date.now();
  await Promise.all(cortes.slice(0, -1).map(async (a, i) => invocar(`placa ${v} pedaco ${i + 1}/4`, { op: 'placa', caixa, ini: a, fim: cortes[i + 1], ctx: 60, get: b, put: { placa: await urlPut(`out/p${v}-${i}.mp4`) } }, { max_s: 150 })));
  const par = (Date.now() - t0) / 1000;
  const j = await invocar(`juntar ${v}`, { op: 'juntar', get: Object.fromEntries(await Promise.all(cortes.slice(0, -1).map(async (_, i) => [`p${i}.mp4`, await urlGet(`out/p${v}-${i}.mp4`)]))), put: { placa: await urlPut(`out/placa${v}-4p.mp4`) } }, { max_s: 30 });
  console.log(v, 'paralelo', par, 'juntar', j.relogio_s, 'quadros', j.saida.quadros); await baixar(`out/placa${v}-4p.mp4`, path.join(RAIZ, `saida/placa-${v}-E2-4pedacos.mp4`));
}
