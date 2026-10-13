import { Module } from '@nestjs/common';
import * as medicao from '../medicao';
import { CampeoesModule } from '../campeoes/campeoes.module';
import { EdicaoModule } from '../edicao/edicao.module';
import { JobsModule } from '../jobs/jobs.module';
import { UploadsModule } from '../uploads/uploads.module';
import { BatchStateMachine } from '../variacoes/batch-state-machine';
import { IteracaoController } from './iteracao.controller';
import { IteracaoService } from './iteracao.service';
import { IteracaoViews } from './iteracao.views';
import { PlanoAutoService } from './plano-auto.service';
import { ZipModule } from './zip.module';
import { MEDIA_RULES, PAGE_CAPTURE, regrasDeMidiaFallback, type MediaRulesPort } from './portas';

/** §7.6: as funções puras da medicao (V1) quando ela exportar; até lá, o fallback do iteracao. */
function mediaRules(): MediaRulesPort {
  const m = medicao as unknown as Partial<MediaRulesPort>;
  return {
    snapSpans: typeof m.snapSpans === 'function' ? m.snapSpans : regrasDeMidiaFallback.snapSpans,
    hasWrittenHook: typeof m.hasWrittenHook === 'function' ? m.hasWrittenHook : regrasDeMidiaFallback.hasWrittenHook,
    hasEndCard: typeof m.hasEndCard === 'function' ? m.hasEndCard : regrasDeMidiaFallback.hasEndCard,
  };
}

/**
 * Variação automática de campeão (variacao-auto-v1.md, B1): o lote. Reaproveita a análise do campeão (campeoes), a
 * máquina do lote (variacoes), os uploads, as peças (edicao/pecas, B2) e o zip (iteracao/zip*, B2). Portas do video
 * (portas.ts): troque a linha do provider quando o V1 entregar.
 */
@Module({
  imports: [JobsModule, CampeoesModule, UploadsModule, EdicaoModule, ZipModule],
  controllers: [IteracaoController],
  providers: [
    IteracaoService, IteracaoViews, PlanoAutoService, BatchStateMachine,
    // V1 (§7.5 PageCaptureService): trocar por { provide: PAGE_CAPTURE, useExisting: <token da medicao> }
    { provide: PAGE_CAPTURE, ...medicao.pageCaptureProvider },   // V1: Chromium do Remotion (medicao/captura-pagina.ts)
    { provide: MEDIA_RULES, useFactory: mediaRules },
  ],
  exports: [IteracaoService],
})
export class IteracaoModule {}
