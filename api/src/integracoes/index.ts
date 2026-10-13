// Ponto de entrada da integracoes pro backend: tipos do contrato, tokens, módulo e erros.
export * from './contrato';
export { IntegracoesModule, CLAUDE_SERVICE, GENERATION_SERVICE, CATALOG_SERVICE, AD_LIBRARY_SERVICE, integracoesMode } from './integracoes.module';
export { IntegracaoError, isIntegracaoError, type IntegracaoErrorCode } from './erros';
export { PROVIDER_TASK_FINISHED, type ProviderTaskFinishedEvent, type ProviderTaskKind, type ProviderTaskStatus } from './portas';
// §13.5: contas do take (o backend usa no 422 LIPSYNC_AUDIO_TOO_LONG antes do generate/launch)
export { takeSecondsFor, takeText, assertTakeDuration } from './catalogo/take';
