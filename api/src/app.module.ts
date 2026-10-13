import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { ArquivosModule } from './arquivos/arquivos.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './common/auth/auth.guard';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { EnvelopeInterceptor } from './common/http/envelope.interceptor';
import { AppThrottlerGuard, buildThrottlers } from './common/throttle/app-throttler.guard';
import { IntegracoesGlobalModule } from './common/integracoes-global.module';
import { AppConfig } from './config/app-config';
import { AppConfigModule } from './config/config.module';
import { EventosModule } from './eventos/eventos.module';
import { JobsModule } from './jobs/jobs.module';
import { PrismaModule } from './prisma/prisma.module';
import { SaudeModule } from './saude/saude.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { BibliotecaModule } from './biblioteca/biblioteca.module';
import { CriativosCoreModule } from './criativos/criativos-core.module';
import { CriativosModule } from './criativos/criativos.module';
import { CustosModule } from './custos/custos.module';
import { EdicaoModule } from './edicao/edicao.module';
import { GeracaoModule } from './geracao/geracao.module';
import { OfertasModule } from './ofertas/ofertas.module';
import { RecuperacaoModule } from './recuperacao/recuperacao.module';
import { RevisaoModule } from './revisao/revisao.module';
import { RoteirosModule } from './roteiros/roteiros.module';
import { RostosModule } from './rostos/rostos.module';
import { CampeoesModule } from './campeoes/campeoes.module';
import { MedicaoModule } from './medicao';
import { UploadsModule } from './uploads/uploads.module';
import { VariacoesModule } from './variacoes/variacoes.module';
import { IteracaoModule } from './iteracao/iteracao.module';
import { ZipModule } from './iteracao/zip.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot({ throttlers: buildThrottlers() }),
    JwtModule.registerAsync({
      global: true,
      inject: [AppConfig],
      useFactory: (c: AppConfig) => ({ secret: c.jwtAccessSecret, signOptions: { expiresIn: c.jwtAccessTtlSec } }),
    }),
    // backend
    AuthModule,
    WorkspacesModule,
    ArquivosModule,
    JobsModule,
    EventosModule,
    SaudeModule,
    // maquina-ia (api/src/integracoes): modo por INTEGRACOES_MODE (mock | live), tokens visíveis pra todo o backend
    IntegracoesGlobalModule.forRoot(),
    // domínio (B2)
    CustosModule,
    CriativosCoreModule,
    OfertasModule,
    CriativosModule,
    RoteirosModule,
    RostosModule,
    EdicaoModule,
    GeracaoModule,
    RevisaoModule,
    BibliotecaModule,
    RecuperacaoModule,
    // feature 2 (variar campeão)
    MedicaoModule,
    UploadsModule,
    CampeoesModule,
    VariacoesModule,
    // variação automática v1 (B2: zip do lote AUTO; peças em EdicaoModule)
    ZipModule,
    IteracaoModule, // B1: o lote (POST /iterate, análise sozinha, plano, start)
  ],
  providers: [
    // Ordem importa: auth primeiro (preenche req.auth), throttle depois (conta por workspace).
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
