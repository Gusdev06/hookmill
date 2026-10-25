#!/usr/bin/env node
// Roteiro de revisão visual do estático montado (estatico-montado-e-molduras-v1 §A3.1, sondas S2/S3). Dono: maquina-qa.
// Monta, pra cada imagem, a folha de conferência: (A) automático, a partir do spec que gerou a imagem (fonte de cada bloco,
// número/afirmação sem dado, o que entra no aspecto); (B) a lista do que o QA confere LENDO o PNG. Não chama nada pago.
//
// Uso (de testes/):
//   node ferramentas/roteiro-estatico.mjs <pasta-da-sonda>
//       a pasta tem, por imagem, <nome>.png + <nome>.json = { aspect, spec: StaticImageSpecV2, brief: {campos do Brain},
//       transcript?: string, textCheck?: StaticTextCheck, prompt?: string } (pedido à maquina-ia: a sonda S2/S3 grava isso)
//   node ferramentas/roteiro-estatico.mjs --batch <variationBatchId>
//       lê do banco de TESTE (E2E_DATABASE_URL, trava *_test) os STATIC do lote: spec do render, Brain, fala, textCheck
// Saída: markdown no stdout (cole na revisão ou redirecione pra test-results/).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { FONTE_ACEITA, blocosEsperados, contrasteBranco, familiasEm, hsl, inventado, textosDoCopy } from '../harness/estatico-molduras.ts';

const args = process.argv.slice(2);
const pngSize = (file) => {
  const b = readFileSync(file);
  return b.slice(1, 4).toString() === 'PNG' ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null;
};
const ASPECTO = { VERTICAL_9_16: '9:16', PORTRAIT_4_5: '4:5', SQUARE_1_1: '1:1' };
const ROTULO = { brandLine: 'linha da marca', tagline: 'tagline (canto sup. dir.)', 'headline.lead': 'headline', 'headline.highlight': 'headline (destaque)', subheadline: 'subheadline', handwritten: 'faixa manuscrita', 'cta.main': 'CTA', 'cta.sub': 'CTA (2ª linha)', closing: 'fechamento manuscrito', screenTitle: 'título da tela' };
const fonteDe = (copy, visual, key) => {
  if (key === 'brandLine') return copy.brandLineSource;
  if (key.startsWith('headline')) return copy.headlineSource;
  if (key === 'subheadline') return copy.subheadlineSource;
  if (key === 'cta.sub') return copy.cta?.subSource;
  if (key === 'screenTitle') return visual?.product?.screenTitleSource;
  const m = key.match(/^(benefits|trust)\.(\d+)/);
  if (m) return copy[m[1]]?.[Number(m[2])]?.source;
  return key === 'tagline' || key === 'handwritten' || key === 'closing' || key === 'cta.main' ? '(sem campo de fonte: generic permitido)' : null;
};
const regraDe = (key) => FONTE_ACEITA[key.startsWith('headline') ? 'headline' : key === 'cta.main' ? 'ctaMain' : key === 'cta.sub' ? 'ctaSub' : key.replace(/\.\d+.*$/, '')];
const entraNoAspecto = (key, aspect, copy) => {
  const q = blocosEsperados(aspect, copy);
  if (key.startsWith('headline') || key.startsWith('cta') || key === 'brandLine') return true;
  if (key.startsWith('benefits')) { const i = Number(key.split('.')[1]); return q.includes('benefits') && i < (aspect === '9:16' ? 5 : 3) && !(aspect === '1:1' && key.endsWith('.line')); }
  if (key.startsWith('trust')) return q.includes('trust');
  if (key === 'screenTitle') return true;
  return q.includes(key);
};

function folha({ nome, png, aspect, spec, brief, transcript, textCheck }) {
  const ctx = { brain: brief ?? {}, fala: transcript ?? '' };
  const c = spec.copy, v = spec.visual;
  const out = [];
  const tam = png && existsSync(png) ? pngSize(png) : null;
  out.push(`## ${nome} · ${aspect}${tam ? ` · ${tam.w}×${tam.h} px` : ''}`);
  out.push(`Imagem: \`${png ?? '(sem PNG)'}\` · marca: **${spec.brandName}** · idioma da tela: ${spec.screenLanguage} · referência de tela: ${spec.screenRefUrl ? 'sim' : 'não'}`);
  if (spec.palette) {
    const hb = hsl(spec.palette.background), ha = hsl(spec.palette.accent);
    out.push(`Paleta: fundo ${spec.palette.background} (L ${(hb.l * 100).toFixed(0)} %, contraste do branco ${contrasteBranco(spec.palette.background).toFixed(1)}:1) · acento ${spec.palette.accent} (matiz ${ha.h.toFixed(0)}° vs fundo ${hb.h.toFixed(0)}°)`);
  }
  out.push('', '### A. Automático (do spec que gerou a imagem)', '| bloco | texto exato | fonte declarada | dado no Brain? | entra neste aspecto? | oráculo QA |', '|---|---|---|---|---|---|');
  for (const t of textosDoCopy(c, v)) {
    const src = fonteDe(c, v, t.key);
    const regra = regraDe(t.key);
    const temDado = !src || src.startsWith('(') ? '—' : src === 'generic' ? (regra?.generic ? 'generic ok' : '**generic proibido**') : src === 'transcript' ? (ctx.fala ? 'sim (fala)' : '**fala vazia**') : ctx.brain[src] ? 'sim' : '**campo vazio**';
    const fonteOk = !src || src.startsWith('(') || src === 'generic' || !regra || regra.fontes.includes(src) ? '' : ' **(fonte não aceita)**';
    const inv = inventado(t.text, ctx);
    out.push(`| ${ROTULO[t.key] ?? t.key} | ${t.text.replace(/\|/g, '\\|')} | ${src ?? '—'}${fonteOk} | ${temDado} | ${entraNoAspecto(t.key, aspect, c) ? 'sim' : 'não (não pode aparecer)'} | ${inv.length ? `**${inv.join('; ')}**` : 'ok'} |`);
  }
  const nulos = [['brandLine', c.brandLine], ['tagline', c.tagline], ['subheadline', c.subheadline], ['handwritten', c.handwritten], ['cta.sub', c.cta?.sub], ['closing', c.closing]]
    .filter(([, x]) => !x).map(([k]) => ROTULO[k] ?? k);
  if (!c.benefits?.length) nulos.push('cards de benefício');
  if (!c.trust?.length) nulos.push('faixa de confiança');
  out.push('', `Blocos **ausentes** no spec (não podem aparecer na imagem, e o layout não pode ter buraco no lugar): ${nulos.join(', ') || 'nenhum'}`);
  out.push(`Pessoa: ${v?.hero ? `${v.hero.emotion} · ${v.hero.person}` : 'sem pessoa (safe ou hero null)'} · tela/produto: ${v?.product?.kind}${v?.product?.look ? ` · ${v.product.look}` : ''}`);
  if (textCheck) out.push(`textCheck da API: **${textCheck.status}** ${(textCheck.items ?? []).filter((i) => i.seen !== i.expected).map((i) => `"${i.expected}" → "${i.seen}"${i.critical ? ' (crítico)' : ''}`).join(' · ')}`);
  const afirmacoesFonte = familiasEm(Object.values(ctx.brain).filter(Boolean).join(' ') + ' ' + ctx.fala);
  out.push('', '### B. Lendo o PNG (marcar cada um; screenshot/zoom anexado na revisão)',
    '- [ ] Cada texto da tabela A com "entra = sim" aparece **escrito exatamente** como no spec (acento, cedilha, maiúscula do destaque); copiar aqui qualquer diferença: esperado → visto',
    '- [ ] Nenhum texto da tabela A com "entra = não" aparece',
    '- [ ] **Nenhum texto que não está no spec** (regra "Nothing else written anywhere"): procurar em especial dentro da tela do celular/laptop, em botões, selos e rodapé',
    `- [ ] Nenhum número, preço, prazo, "grátis/free/trial", garantia, desconto/%, iOS/Android/App Store, "especialista/médico/estudo", "nº 1/melhor", "sem risco" fora do spec. Famílias que o Brain/fala sustentam: ${afirmacoesFonte.join(', ') || 'nenhuma'}`,
    `- [ ] Conteúdo da tela: ${spec.screenRefUrl ? 'igual à referência (captura/foto), sem lista inventada' : 'abstrato (formas, anéis, ícones) **sem palavra legível**'}${v?.product?.screenTitle ? `; único texto permitido: "${v.product.screenTitle}"` : ''}`,
    '- [ ] Marca só como wordmark (nome em tipografia), sem logo/ícone inventado, sem marca d\'água, sem logo de terceiro',
    '- [ ] Pessoa genérica (sem celebridade, uniforme com nome, logo na roupa); expressão bate com a emoção',
    '- [ ] Fundo escuro no matiz do acento; destaque da headline e CTA na cor de acento',
    aspect === '9:16' ? '- [ ] Margens D6: ~5 % do topo e ~10 % da base livres (o CTA não fica na faixa do Stories)' : '- [ ] Nada cortado na borda, exceto a pessoa',
    '- [ ] Legibilidade no celular: abrir a imagem a 390 px de largura (o Meta mostra ~1080 → 390); título e linha dos cards se leem',
    '- [ ] Veredito: aprovado / reprovado (bloco + motivo + dono: ia se veio do prompt/modelo, backend se a validação deixou passar)', '');
  return out.join('\n');
}

async function doBanco(batchId) {
  const { q, closeDb } = await import('../harness/db.ts');
  const { guardTestDb } = await import('../harness/env.ts');
  guardTestDb();
  const [ctx] = await q(`select o.what, o.audience, o.pains, o.promise, o.proof, o.offer_and_price, o.cta, o.notes, o.name, o.kind, t.transcript
                           from variation_batches b join offers o on o.id = b.offer_id left join teardowns t on t.champion_id = b.champion_id where b.id = $1`, [batchId]);
  if (!ctx) throw new Error(`lote ${batchId} não existe neste banco de teste`);
  const brief = { what: ctx.what, audience: ctx.audience, pains: ctx.pains, promise: ctx.promise, proof: ctx.proof, offerAndPrice: ctx.offer_and_price, cta: ctx.cta, notes: ctx.notes, name: ctx.name, kind: ctx.kind };
  const transcript = (ctx.transcript?.words ?? []).map((w) => w.word).join(' ');
  const rs = await q(`select vi.code, r.format, r.input from renders r join creatives c on c.id = r.creative_id join variation_items vi on vi.id = c.variation_item_id
                       where c.variation_batch_id = $1 and r.engine = 'IMAGE_GEN' and not r.stale and r.status = 'READY' order by vi.index, r.format`, [batchId]);
  const folhas = rs.map((r) => {
    const spec = r.input?.spec?.layout === 'assembled' ? r.input.spec : r.input?.specV2;
    return spec ? folha({ nome: r.code, png: null, aspect: ASPECTO[r.format], spec, brief, transcript, textCheck: r.input?.textCheck }) : `## ${r.code} · ${r.format}: render sem spec V2 (legado?)\n`;
  });
  await closeDb();
  return folhas;
}

const folhas = [];
if (args[0] === '--batch' && args[1]) folhas.push(...(await doBanco(args[1])));
else if (args[0] && existsSync(args[0])) {
  for (const f of readdirSync(args[0]).filter((x) => x.endsWith('.json')).sort()) {
    const j = JSON.parse(readFileSync(join(args[0], f), 'utf8'));
    if (!j.spec?.copy) { folhas.push(`## ${f}: sem spec.copy (formato esperado no cabeçalho deste script)\n`); continue; }
    const png = join(args[0], f.replace(/\.json$/, '.png'));
    folhas.push(folha({ nome: basename(f, '.json'), png, aspect: j.aspect ?? '9:16', spec: j.spec, brief: j.brief, transcript: j.transcript, textCheck: j.textCheck }));
  }
} else {
  console.error('uso: node ferramentas/roteiro-estatico.mjs <pasta-da-sonda> | --batch <variationBatchId>');
  process.exit(2);
}
console.log(`# Revisão visual do estático montado (§A3.1) · ${new Date().toISOString().slice(0, 10)}\n`);
console.log(folhas.join('\n'));
