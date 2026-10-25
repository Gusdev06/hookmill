import type { Action, Job } from '@maquina/contratos';
import type { Job as JobRow, JobType } from '@prisma/client';
import { asAsyncErrorCode, jobAction } from '../common/errors/falhas';
import { META_ERROR_ACTION } from '../integracoes';

export type { Action } from '@maquina/contratos';

/** Etapas do checklist por tipo de job (api.md §4 e §7). */
export const JOB_CHECKLIST: Record<JobType, string[]> = {
  // briefing-leitura-v2 §4.3 (22/10): etapa que não precisou rodar é emitida e concluída na hora (texto colado: só as 2 últimas)
  OFFER_EXTRACT: ['fetching_page', 'rendering_page', 'reading_subpages', 'reading_images', 'extracting', 'detecting_language'],
  SCRIPTS_GENERATE: ['reading_brief', 'studying_winners', 'writing'],
  SCRIPT_REGENERATE: ['reading_brief', 'studying_winners', 'writing'],
  CHAMPION_RESOLVE: ['fetching_ad', 'downloading_video'],
  CHAMPION_ANALYZE: ['reading_video', 'extracting_audio', 'transcribing', 'measuring', 'mapping_edit', 'diagnosing'], // §13.7
  VARIATIONS_PLAN: ['reading_teardown', 'writing'],
  VARIATION_ITEM_REGENERATE: ['writing'],
  AUTO_PLAN: ['checking_brain', 'planning'], // variacao-auto-v1 §5.2
  ZIP_BUILD: ['zipping'], // variacao-auto-v1 §5.1
  // meta-v1 (21/10): etapas fixadas no contrato (§3.2 e §3.3); o módulo meta (B1) preenche
  META_SYNC: ['listing_campaigns', 'listing_adsets', 'listing_ads', 'reading_insights', 'scoring'], // campanhas-v1 §4
  META_IMPORT: ['fetching_video', 'downloading_video'],
  META_PUBLISH: ['uploading_video', 'processing_video', 'creating_campaign', 'creating_adset', 'creating_creative', 'creating_ad'],
};

export const actionFor = jobAction;

/** Ação do job falho por tipo (feature 2: link sem vídeo = subir o arquivo; análise = analisar de novo). */
function jobActionByType(type: JobType, code: string | null) {
  if (type === 'CHAMPION_RESOLVE') return 'upload_video' as const;
  // vídeo que não decodifica = subir outro arquivo; o resto da análise é transitório (esclarecimento 06/10)
  if (type === 'CHAMPION_ANALYZE') return code === 'MEDIA_INVALID' ? ('upload_video' as const) : ('analyze_again' as const);
  if (type === 'VARIATIONS_PLAN' || type === 'VARIATION_ITEM_REGENERATE') return 'regenerate' as const;
  // meta-v1 §3.3: ação pelo código da Meta (reconnect_meta, edit_ad_text, raise_budget…); o resto = retry
  if (type.startsWith('META_')) return (code && (META_ERROR_ACTION as Record<string, Action>)[code]) || 'retry';
  return actionFor(code);
}

/** Linha do banco → Job do contrato (api.md §1). */
export function presentJob(job: JobRow): Job {
  const steps = JOB_CHECKLIST[job.type];
  const finishedOk = job.status === 'SUCCEEDED' || job.status === 'PARTIAL';
  const current = job.stage ? steps.indexOf(job.stage) : -1;
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    etaSec: job.etaSec,
    checklist: steps.map((key, i) => ({ key, done: finishedOk || (current >= 0 && i < current) })),
    errorCode: job.errorCode ? asAsyncErrorCode(job.errorCode) : null,
    failReason: job.failReason,
    action: job.status === 'FAILED' || job.status === 'PARTIAL' ? jobActionByType(job.type, job.errorCode) : null,
    output: job.output ?? null,
  };
}

export type JobView = Job;
