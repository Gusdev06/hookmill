import { VersaoSemLegendaService } from './versao-sem-legenda';
import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../arquivos/storage.service';
import { MEDIA_ANALYSIS_SERVICE, type MediaAnalysisService } from '../medicao';
import { LEITURA_MIDIA, criarLeitura, leituraConfig } from '../medicao/leitura';
import { JobsModule } from '../jobs/jobs.module';
import { MedicaoModule } from '../medicao';
import { UploadsModule } from '../uploads/uploads.module';
import { AnaliseService } from './analise.service';
import { CampeoesController } from './campeoes.controller';
import { CampeoesService } from './campeoes.service';
import { ChampionStateMachine } from './champion-state-machine';
import { ChampionViews } from './champion-views';
import { AD_LIBRARY_SERVICE } from '../integracoes';
import { AD_LIBRARY } from './portas';
import { ResearchChampionService } from './research-champion.service';
import { ResearchModule } from '../research/research.module';
import { createReadStream } from 'node:fs';
import { TROCA_TEXTO, criarTrocaTexto, trocaConfig } from '../medicao/troca';
import { PlacasService, TROCA_CONFIG, type TrocaLiberacao } from './placas.service';

@Module({
  imports: [JobsModule, UploadsModule, MedicaoModule, ResearchModule], // ads-research-v1 §6.1: campeão por researchAdId
  controllers: [CampeoesController],
  providers: [
    CampeoesService, AnaliseService, ChampionStateMachine, ChampionViews, VersaoSemLegendaService, ResearchChampionService,
    // AdLibraryService da integracoes (mock | live | off por AD_LIBRARY_MODE); testes trocam pelo token do backend
    { provide: AD_LIBRARY, useExisting: AD_LIBRARY_SERVICE },
    // leitura-lambda-v1: mídia da análise no processo (local) ou na Lambda hookmill-leitura, por ANALYZE_IMPL
    {
      provide: LEITURA_MIDIA,
      inject: [ConfigService, StorageService, MEDIA_ANALYSIS_SERVICE],
      useFactory: (cfg: ConfigService, storage: StorageService, media: MediaAnalysisService) => {
        const c = leituraConfig((k) => cfg.get<string>(k));
        const log = new Logger('Leitura');
        if (c.impl === 'lambda') log.log(`leitura na Lambda ${c.functionName} (${c.region}), fallback ${c.fallback ? 'local' : 'desligado'}`);
        return criarLeitura(c, {
          storage: {
            downloadTo: (f, p) => storage.downloadTo(f, p),
            signedUrl: (f) => storage.signedUrl(f),
            newKey: (ws, kind, mime) => storage.newKey(ws, kind, mime),
            presignPut: (key, o) => storage.presignPut(key, o),
          },
          media, ffmpeg: cfg.get<string>('FFMPEG_PATH') || 'ffmpeg', log,
        });
      },
    },
    // troca-texto-queimado-v1 §16.5 (F1b): PLATE_IMPL=off (padrão) não constrói porta nenhuma; testes trocam TROCA_TEXTO pelo fake
    { provide: TROCA_CONFIG, inject: [ConfigService], useFactory: (cfg: ConfigService): TrocaLiberacao => { const c = trocaConfig((k) => cfg.get<string>(k)); return { impl: c.impl, workspaceIds: c.workspaceIds }; } },
    {
      provide: TROCA_TEXTO,
      inject: [ConfigService, StorageService],
      useFactory: (cfg: ConfigService, storage: StorageService) => {
        const c = trocaConfig((k) => cfg.get<string>(k));
        if (c.impl === 'off') return null;
        const log = new Logger('Troca');
        log.log(`troca de texto: PLATE_IMPL=${c.impl}${c.workspaceIds.length ? ` (workspaces ${c.workspaceIds.join(', ')})` : ''}`);
        return criarTrocaTexto(c, {
          storage: {
            presignPut: (key, o) => storage.presignPut(key, o),
            presignGet: (key) => storage.signedUrlForKey(key),
            remove: (key) => storage.deleteObject(key),
            tmpPrefix: 'tmp/troca/',
            putFile: (key, file, contentType) => storage.putStream(key, createReadStream(file), contentType),
          },
          log, ffmpeg: cfg.get<string>('FFMPEG_PATH') || undefined, ffprobe: cfg.get<string>('FFPROBE_PATH') || undefined,
        });
      },
    },
    PlacasService,
  ],
  exports: [PlacasService, TROCA_TEXTO, LEITURA_MIDIA, ResearchChampionService, ResearchModule, CampeoesService, AnaliseService, ChampionStateMachine, ChampionViews, VersaoSemLegendaService, AD_LIBRARY, MedicaoModule],
})
export class CampeoesModule {}
