import { DynamicModule, Module } from '@nestjs/common';
import { IntegracoesModule } from '../integracoes';

/**
 * Deixa os tokens da integracoes (CLAUDE_SERVICE, GENERATION_SERVICE, CATALOG_SERVICE) visíveis pra todos os módulos
 * do backend, com UMA instância só (o mock tem timers: duas instâncias = tasks duplicadas).
 */
@Module({})
export class IntegracoesGlobalModule {
  static forRoot(): DynamicModule {
    const integracoes = IntegracoesModule.register();
    return { module: IntegracoesGlobalModule, global: true, imports: [integracoes], exports: [integracoes] };
  }
}
