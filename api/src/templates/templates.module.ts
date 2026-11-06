import { Module } from '@nestjs/common';
import { TemplatesAiModule } from '../templates-ai/templates-ai.module';
import { IteracaoModule } from '../iteracao/iteracao.module';
import { AdminTemplatesController, TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

/** templates-creditos-v1: galeria + usar template (lote AUTO com tipo travado) + admin do catálogo. Créditos = CreditosModule (global). */
@Module({ imports: [IteracaoModule, TemplatesAiModule], controllers: [TemplatesController, AdminTemplatesController], providers: [TemplatesService] })
export class TemplatesModule {}
