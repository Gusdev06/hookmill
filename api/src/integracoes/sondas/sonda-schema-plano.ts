// Sonda de COMPILAÇÃO dos esquemas do planAutoBatch (bug live 25/10: "The compiled grammar is too large"). Manda cada
// esquema real com um pedido mínimo e max_tokens 64: o 400 de gramática sai antes de gerar (custo 0); compilou = a
// resposta corta em max_tokens (~US$ 0,01 de entrada, o esquema conta como tokens). Uso (de api/):
//   npx ts-node --transpile-only src/integracoes/sondas/sonda-schema-plano.ts --yes [--schema=plan,static,frame]
// Medido 25/10: esquema único de 105 propriedades FALHA; 55 compila. Hoje plano 45, STATIC 38, FRAME 23 (os 3 compilam).
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { AUTO_PLAN_SCHEMA } from '../claude/auto-plano';
import { FRAMES_DETAIL_SCHEMA, FRAME_DETAIL_SCHEMA, STATIC_DETAIL_SCHEMA } from '../claude/auto-plano-detalhe';
import { schemaStats } from '../claude/schema-stats';

const SCHEMAS: Record<string, object> = { plan: AUTO_PLAN_SCHEMA, static: STATIC_DETAIL_SCHEMA, frame: FRAME_DETAIL_SCHEMA, frames: FRAMES_DETAIL_SCHEMA };

async function main() {
  const which = (process.argv.find((a) => a.startsWith('--schema='))?.slice(9) ?? 'plan,static,frames').split(',');
  for (const w of which) console.log(w, schemaStats(SCHEMAS[w]));
  if (!process.argv.includes('--yes')) return console.log('nada rodou (passe --yes)');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 0 });
  for (const w of which) {
    const t0 = Date.now();
    try {
      const m = await client.beta.messages.create({
        model: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'Return the smallest valid JSON for the schema. Be brief.' }],
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMAS[w] as Record<string, unknown> } },
      });
      console.log(`${w}: COMPILOU em ${((Date.now() - t0) / 1000).toFixed(1)}s stop=${m.stop_reason} in=${m.usage.input_tokens} out=${m.usage.output_tokens}`);
    } catch (e) {
      console.log(`${w}: FALHOU em ${((Date.now() - t0) / 1000).toFixed(1)}s: ${(e as Error).message.slice(0, 300)}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
