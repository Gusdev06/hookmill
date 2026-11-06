// ads-research-v1 (Ad Radar, Construção 04/11): descoberta de concorrentes, coletas da Ad Library, tetos, mídia e retenção.
// Portas da maquina-ia (ADS_RESEARCH_SERVICE e o Claude da descoberta no CLAUDE_SERVICE) vêm do IntegracoesGlobalModule.
// Exporta o que campeoes/iteracao/templates/workspaces/ofertas usam (visibilidade, mídia, gatilhos da descoberta).
import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { AdsController } from './ads.controller';
import { ResearchAdsService } from './ads.service';
import { ResearchCapsService } from './caps.service';
import { CompetitorsController } from './competitors.controller';
import { CompetitorsService } from './competitors.service';
import { DiscoveryService } from './discovery.service';
import { ResearchMediaService } from './media.service';
import { ResearchConfig } from './research.config';
import { ResearchController } from './research.controller';
import { ResearchService } from './research.service';
import { ResearchViews } from './research.views';
import { ResearchRetencaoService } from './retencao.service';
import { ResearchSyncService } from './sync.service';

@Module({
  imports: [JobsModule],
  controllers: [ResearchController, CompetitorsController, AdsController],
  providers: [
    ResearchConfig, ResearchCapsService, ResearchSyncService, ResearchViews, DiscoveryService, CompetitorsService, ResearchMediaService,
    ResearchAdsService, ResearchService, ResearchRetencaoService,
  ],
  exports: [ResearchConfig, ResearchSyncService, ResearchCapsService, ResearchAdsService, ResearchMediaService, DiscoveryService, ResearchViews],
})
export class ResearchModule {}
