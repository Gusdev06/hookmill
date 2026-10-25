// Sonda da Meta (meta-v1.md §11 último item). SÓ roda com ok do Gusta e com o §11 feito (app em dev, testers).
// Custo US$ 0 (leitura + publicação PAUSADA, apagada no fim), mas é chamada REAL à Graph: nunca em teste automatizado.
// Precisa de um user token já concedido pelo login (o fluxo do callback é do backend): passe META_PROBE_TOKEN no ambiente.
// Uso (de api/):
//   npx ts-node --transpile-only src/integracoes/sondas/sonda-meta.ts                     → só mostra o plano
//   META_PROBE_TOKEN=EAA… npx ts-node --transpile-only src/integracoes/sondas/sonda-meta.ts --yes --account=act_123 [--page=… --pixel=…]
//     → debug_token, options, readAdAccount, health, sync (1 conta) e imprime o que a Graph devolveu de fato
//   ... --publish --video-url=https://…/render.mp4 --thumb-url=https://…/thumb.jpg --link=https://… --budget=500 --country=US
//     → cria campanha+adset+creative+ad PAUSADOS e APAGA a campanha no fim (DELETE /{campaignId}); confirma subcódigos
// Registre o resultado (versão, campos de insights, escopos, subcódigos) em docs/integracoes.md.
import 'dotenv/config';
import { buildMetaService } from '../meta/modo';
import { LiveMetaService } from '../meta/live.service';
import { isMetaError } from '../meta/erros';
import type { MetaPublishInput } from '../contrato';

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const yes = process.argv.includes('--yes');
const publish = process.argv.includes('--publish');

async function main() {
  const plan = ['debug_token', 'options', 'readAdAccount', 'health', 'syncAds (1 conta, até 500 anúncios)'];
  if (publish) plan.push('publicação PAUSADA (6 etapas) + DELETE da campanha');
  console.log(`plano (custo US$ 0, chamadas reais à Graph):\n${plan.map((p) => `  - ${p}`).join('\n')}`);
  if (!yes) return console.log('nada rodou (passe --yes; --publish pra publicação pausada)');
  const token = process.env.META_PROBE_TOKEN;
  if (!token) throw new Error('META_PROBE_TOKEN vazio (user token do login do app)');
  const svc = buildMetaService({ ...process.env, META_MODE: 'live' }, { publicApiUrl: process.env.PUBLIC_API_URL || 'http://localhost:3001' });
  if (!(svc instanceof LiveMetaService)) throw new Error('live não configurado: META_APP_ID/META_APP_SECRET/META_CONFIG_ID/META_TOKEN_KEY');
  const auth = { accessToken: token };
  const out = (label: string, v: unknown) => console.log(`\n== ${label}\n${JSON.stringify(v, null, 1).slice(0, 2500)}`);
  try {
    out('status', svc.status());
    out('debug_token', await svc.inspectToken(auth));
    const account = arg('account');
    out('options', await svc.listOptions(auth, { adAccountId: account }));
    if (!account) return console.log('\npasse --account=act_… pra seguir');
    const acc = await svc.readAdAccount(auth, account);
    out('readAdAccount', acc);
    const page = arg('page') ?? null;
    const pixel = arg('pixel') ?? null;
    out('health', await svc.health(auth, { adAccountId: account, pageId: page, pixelId: pixel, businessId: acc.business?.id ?? null, tokenExpiresAt: null, scopes: [], counts: { adsCount: 0, activeCount: 0 } }));
    const t0 = Date.now();
    const sync = await svc.syncAds(auth, { adAccountId: account, currency: acc.currency, businessType: (arg('business') as 'ONLINE_STORE' | 'LOCAL_BUSINESS' | 'APP' | undefined) ?? 'ONLINE_STORE', hasPixel: !!pixel }, (p) => console.log(`  ${p.stage} ${p.done}/${p.total}`));
    out(`syncAds (${((Date.now() - t0) / 1000).toFixed(1)} s; listed ${sync.listed}; usage ${JSON.stringify(svc.graph.lastUsage)})`, { medianCpa: sync.medianCpa, rule: sync.rule, sample: sync.ads.slice(0, 3) });
    console.log(`\nplays2s (video_continuous_2_sec_watched_actions) veio? ${sync.ads.some((a) => a.metrics.plays2s != null) ? 'SIM' : 'NÃO (campo recusado ou conta sem anúncio de vídeo: confira o log acima)'}`);
    if (!publish) return;
    if (!page) throw new Error('--page obrigatório pra publicar');
    const input: MetaPublishInput = {
      adAccountId: account, pageId: page, pixelId: pixel, adName: `HookMill probe ${new Date().toISOString().slice(0, 16)}`,
      settings: { dailyBudgetMinor: Number(arg('budget') ?? 500), countries: [arg('country') ?? 'US'], objective: pixel ? 'OUTCOME_SALES' : 'OUTCOME_TRAFFIC', primaryText: 'HookMill probe (paused, will be deleted)', headline: 'Probe', description: null, callToAction: 'LEARN_MORE', link: arg('link') ?? 'https://example.com', specialAdCategories: [], ageMin: 18, ageMax: 65, objectiveReason: pixel ? 'business_type' : 'no_pixel' },
      video: { fileUrl: arg('video-url') ?? null, sizeBytes: null, read: null }, thumbnailUrl: arg('thumb-url') ?? '',
    };
    const ids = { videoId: null as string | null, creativeId: null as string | null, campaignId: null as string | null, adsetId: null as string | null, adId: null as string | null };
    try {
      ids.videoId = (await svc.uploadVideo(auth, input)).videoId;
      console.log('uploading_video →', ids.videoId);
      await svc.waitVideoReady(auth, input, ids, { onPoll: (s) => console.log('  video', s) });
      ids.campaignId = (await svc.createCampaign(auth, input)).campaignId;
      console.log('creating_campaign →', ids.campaignId);
      ids.adsetId = (await svc.createAdSet(auth, input, ids)).adsetId;
      console.log('creating_adset →', ids.adsetId);
      ids.creativeId = (await svc.createAdCreative(auth, input, ids)).creativeId;
      console.log('creating_creative →', ids.creativeId);
      const ad = await svc.createAd(auth, input, ids);
      ids.adId = ad.adId;
      console.log('creating_ad →', ids.adId, ad.previewUrl, svc.adsManagerUrl(account, ad.adId));
    } finally {
      if (ids.campaignId) {
        await svc.graph.delete(ids.campaignId, token).then(() => console.log('campanha apagada', ids.campaignId), (e) => console.log('APAGUE NA MÃO a campanha', ids.campaignId, (e as Error).message));
      }
    }
  } catch (e) {
    if (isMetaError(e)) console.log(`\nMetaError ${e.code} action=${e.action} stage=${e.stage} detail=${e.failDetail} details=${JSON.stringify(e.details)}\n${e.message}`);
    else throw e;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
