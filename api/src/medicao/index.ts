// Ponto de entrada da medição pro backend: tipos do contrato, token e módulo.
export * from './contrato';
export { MedicaoModule, MEDIA_ANALYSIS_SERVICE } from './medicao.module';
export { NoAudioError } from './media-analysis.service';
export { MediaToolError } from './ffmpeg';
// variacao-auto-v1 §7.5-7.6
export { snapSpans, snapSpansEmOrdem, hasWrittenHook, writtenHookLayer, hasEndCard } from './auto-edit';
export { PuppeteerPageCaptureService, capturarPagina, pageCaptureProvider, type PageCaptureConfig, type PageCaptureFile } from './captura-pagina';
