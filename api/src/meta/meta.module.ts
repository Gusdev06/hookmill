import { Module, type OnApplicationBootstrap } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { CampeoesModule } from '../campeoes/campeoes.module';
import { JobsModule } from '../jobs/jobs.module';
import { OnboardingModule } from '../workspaces/onboarding.module';
import { MetaCampanhasController } from './campanhas.controller';
import { MetaCampanhasService } from './campanhas.service';
import { MetaConexaoService } from './conexao.service';
import { MetaEscritaService } from './escrita.service';
import { MetaImportService } from './importacao.service';
import { MetaModeGuard } from './meta-mode.guard';
import { CreativeMetaController, MetaController, MetaTemplatesController } from './meta.controller';
import { MetaTemplatesService } from './templates.service';
import { MetaPublicacaoService } from './publicacao.service';
import { MetaSyncService } from './sync.service';

/** Boot: publicação PUBLISHING sem job vivo → FAILED (action retry). BOOT_RECOVERY=off só nos testes de integração. */
@Injectable()
class MetaRecuperacao implements OnApplicationBootstrap {
  private readonly log = new Logger('Meta');
  constructor(private readonly publicacao: MetaPublicacaoService) {}
  onApplicationBootstrap() {
    if (process.env.BOOT_RECOVERY === 'off') return;
    void this.publicacao.recover().then((n) => n && this.log.warn(`${n} publicação(ões) interrompida(s) marcada(s) FAILED`)).catch((e) => this.log.error(`retomada: ${(e as Error).message}`));
  }
}

/**
 * meta-v1.md (B1): conexão/cifra, sync + cron, import (META_IMPORT → Champion, usado pelo iteracao), publicação,
 * controllers. Fala com a Meta SÓ pela porta MetaService (META_SERVICE, integracoes/meta, maquina-ia).
 */
@Module({
  imports: [JobsModule, CampeoesModule, OnboardingModule], // StorageService e KeyedMutex vêm de módulos globais
  controllers: [MetaController, CreativeMetaController, MetaCampanhasController, MetaTemplatesController],
  providers: [MetaConexaoService, MetaSyncService, MetaImportService, MetaPublicacaoService, MetaRecuperacao, MetaModeGuard, MetaCampanhasService, MetaEscritaService, MetaTemplatesService],
  exports: [MetaConexaoService, MetaSyncService, MetaImportService, MetaPublicacaoService, MetaCampanhasService, MetaEscritaService, MetaTemplatesService],
})
export class MetaModule {}
