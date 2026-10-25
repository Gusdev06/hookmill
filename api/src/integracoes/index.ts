// Ponto de entrada da integracoes pro backend: tipos do contrato, tokens, módulo e erros.
export * from './contrato';
export { IntegracoesModule, CLAUDE_SERVICE, GENERATION_SERVICE, CATALOG_SERVICE, AD_LIBRARY_SERVICE, META_SERVICE, integracoesMode } from './integracoes.module';
// meta-v1 (21/10): erro, cifra do token, regra de vencedor (puras) e modo. Assinatura da porta em meta/PORTA.md.
export { MetaError, isMetaError, META_ERROR_TEXT, META_ERROR_ACTION, META_WRITE_ERROR_ACTION, accountStatusLabel, accountUnusable, type MetaErrorCode, type MetaErrorAction } from './meta/erros';
export { cifrar, decifrar, chaveDe, CifraError } from './meta/cifra';
export { verdictOf, trendOf, scoreAds, medianCpaOf, compareAds, ruleFromEnv, minSpendIn, isEligible } from './meta/vencedor';
export { metaMode } from './meta/modo';
export { buildHealth, type HealthFacts } from './meta/saude';
export { REQUIRED_SCOPES, missingScopes } from './meta/escopos';
export { IntegracaoError, isIntegracaoError, type IntegracaoErrorCode } from './erros';
export { PROVIDER_TASK_FINISHED, type ProviderTaskFinishedEvent, type ProviderTaskKind, type ProviderTaskStatus } from './portas';
// §13.5: contas do take (o backend usa no 422 LIPSYNC_AUDIO_TOO_LONG antes do generate/launch)
export { takeSecondsFor, takeText, assertTakeDuration } from './catalogo/take';
