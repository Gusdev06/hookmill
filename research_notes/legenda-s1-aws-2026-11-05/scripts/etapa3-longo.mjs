// Etapa 3: vídeo de 128 s, estilo achado pelo ajuste novo. 1 função × 4 pedaços. Trava de custo no s1.mjs.
import path from 'node:path'; import { readFileSync } from 'node:fs';
import { invocar, urlGet, urlPut, baixar, RAIZ, gasto } from './s1.mjs';
const v = '120', caixa = true; const CTX = 60;
const det = readFileSync(path.join(RAIZ, 'medidas/invocacoes.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).filter((r) => r.rotulo === 'detectar 120 caixa').pop().saida;
const N = det.quadros, tom = det.tomadas;
const cortes = [0]; for (const k of [1, 2, 3]) { const alvo = Math.round(N * k / 4); const prox = tom.reduce((a, b) => (Math.abs(b - alvo) < Math.abs(a - alvo) ? b : a)); cortes.push(Math.abs(prox - alvo) < 0.2 * N / 4 ? prox : alvo); } cortes.push(N);
const pedacos = cortes.slice(0, -1).map((a, i) => ({ ini: a, fim: cortes[i + 1] })); const naTomada = (x) => tom.includes(x);
console.log('N', N, 'cortes', cortes, 'em troca de tomada:', cortes.map(naTomada));
const b = { 'video.mp4': await urlGet(`in/v${v}.mp4`), 'd.npz': await urlGet(`out/d${v}.npz`), 'estilo.json': await urlGet(`out/rap${v}.json`) };
const modo = process.argv[2];
if (modo === 'pedacos' || !modo) {
  const t0 = Date.now();
  const rs = await Promise.all(pedacos.map(async (p, i) => invocar(`placa 120 pedaco ${i + 1}/4`, { op: 'placa', caixa, ini: p.ini, fim: p.fim, ctx: CTX, get: b, put: { placa: await urlPut(`out/p120-${i}.mp4`) } }, { max_s: 300 })));
  const paralelo = (Date.now() - t0) / 1000;
  const j = await invocar('juntar 120', { op: 'juntar', get: Object.fromEntries(await Promise.all(pedacos.map(async (_, i) => [`p${i}.mp4`, await urlGet(`out/p120-${i}.mp4`)]))), put: { placa: await urlPut('out/placa120-4p.mp4') } }, { max_s: 60 });
  console.log('paralelo relógio', paralelo, 's; maior pedaço', Math.max(...rs.map((r) => r.relogio_s)), 'juntar', j.relogio_s, 'quadros', j.saida.quadros);
  await baixar('out/placa120-4p.mp4', path.join(RAIZ, 'saida/placa-120-E2-4pedacos.mp4'));
}
if (modo === 'um') {
  const r = await invocar('placa 120 1 funcao', { op: 'placa', caixa, get: b, put: { placa: await urlPut('out/placa120-1.mp4'), m: await urlPut('out/m120.npz') } }, { max_s: 900 });
  if (r.saida.ok) await baixar('out/placa120-1.mp4', path.join(RAIZ, 'saida/placa-120-E2-1funcao.mp4'));
}
if (modo === 'w1') {
  const m = (await invocar('W1 120', { op: 'escrever', v, caixa, get: { ...b, 'placa.mp4': await urlGet('out/placa120-4p.mp4'), 'w.json': await urlGet(`in/w${v}.json`) }, put: { inteiro: await urlPut('out/inteiro120.mp4') } }, { max_s: 300 }));
  if (m.saida.ok) await baixar('out/inteiro120.mp4', path.join(RAIZ, 'saida/120-E2-W1-fala-inteiro.mp4'));
}
console.log('gasto Lambda', gasto().toFixed(4));
