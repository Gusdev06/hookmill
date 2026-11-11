// 11/11: prova ao vivo do transporte Kie (1 texto + 1 imagem). Rodar: npx ts-node -T src/dev/kie-live.ts <img.jpg>
import { readFileSync } from 'node:fs';
import { buildLlmTransport } from '../integracoes/claude/transporte-kie';
import { costOf } from '../integracoes/claude/custo';
const env: Record<string, string> = {};
for (const l of readFileSync('.env', 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=([^#\n]*)/); if (m) env[m[1]] = m[2].trim(); }
const schema = { type: 'object', properties: { pessoas: { type: 'integer' }, descricao: { type: 'string' }, gancho: { type: 'string' } }, required: ['descricao'], additionalProperties: false };
(async () => {
  const t = buildLlmTransport((k) => env[k], { model: 'claude-opus-5-5', effort: 'medium', fallbacks: true, maxRetries: 1 })!;
  console.log('transporte:', t.constructor.name);
  let t0 = Date.now();
  const a = await t.run({ system: 'Você escreve ganchos de anúncio. Responda só o JSON.', user: 'Oferta: curso de renda extra com IA, R$ 97. Dê 1 gancho e descreva o público em 8 palavras.', schema, maxTokens: 2000 });
  console.log('TEXTO', Date.now() - t0, 'ms', JSON.parse(a.text), a.usage, costOf(a.usage).totalUsd);
  t0 = Date.now();
  const b = await t.run({ system: 'Você analisa quadros de anúncio. Responda só o JSON.', user: 'Quantas pessoas e o que acontece?', schema, maxTokens: 2000, images: [{ mediaType: 'image/jpeg', data: readFileSync(process.argv[2]).toString('base64'), caption: 'quadro 0s' }] });
  console.log('IMAGEM', Date.now() - t0, 'ms', JSON.parse(b.text), b.usage, costOf(b.usage).totalUsd);
})().catch((e) => { console.error('FALHOU', e.code, e.message, e.details); process.exit(1); });
