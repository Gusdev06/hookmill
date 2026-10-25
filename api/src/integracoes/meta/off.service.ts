// META_MODE=off ou live sem configuração: toda chamada falha META_NOT_CONFIGURED { reason } (nunca cai no mock).
import type { MetaService, MetaServiceStatus } from '../contrato';
import { notConfigured } from './erros';
import { DEFAULT_GRAPH_VERSION } from './cliente';

const METHODS: (keyof MetaService)[] = [
  'buildAuthUrl', 'verifyState', 'exchangeCode', 'inspectToken', 'revoke', 'listOptions', 'readAdAccount', 'health', 'syncAds', 'videoSource',
  'uploadVideo', 'waitVideoReady', 'createCampaign', 'createAdSet', 'createAdCreative', 'createAd', 'setStatus', 'adsManagerUrl',
  'readObject', 'setDailyBudget', 'objectUrl',
];

export function offMetaService(reason: 'off' | 'not_configured', missing: string[] = [], graphVersion = DEFAULT_GRAPH_VERSION): MetaService {
  const what = reason === 'off' ? 'META_MODE=off' : `${missing.join(', ')} empty in api/.env`;
  const svc: Record<string, unknown> = {
    status: (): MetaServiceStatus => ({ mode: reason === 'off' ? 'off' : 'live', configured: false, appIdMasked: null, graphVersion }),
    usage: () => null,
    rule: () => ({ minSpendUsd: 50, minResults: 3, trendBetter: 0.85, trendWorse: 1.25, trendFreq: 3, usdRates: {} }),
  };
  for (const m of METHODS) {
    // síncronos lançam na hora; assíncronos rejeitam. `revoke` é melhor esforço e não lança.
    if (m === 'buildAuthUrl' || m === 'verifyState' || m === 'adsManagerUrl' || m === 'objectUrl') svc[m] = () => { throw notConfigured(reason, what); };
    else if (m === 'revoke') svc[m] = async () => undefined;
    else svc[m] = () => Promise.reject(notConfigured(reason, what));
  }
  return svc as unknown as MetaService;
}
