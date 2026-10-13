import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { createValidationPipe } from './common/http/validation';
import { AppConfig } from './config/app-config';

export function configureApp(app: NestExpressApplication) {
  const config = app.get(AppConfig);
  app.setGlobalPrefix('api/v1');
  app.set('trust proxy', 1); // atrás do Traefik do EasyPanel: IP real pro throttle
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.useBodyParser('json', { limit: '2mb' }); // rawBody: true guarda o corpo cru (webhook assinado)
  app.enableCors({
    origin: config.webOrigins,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });
  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();
  return config;
}

/**
 * Rede final: uma promise rejeitada sem dono (trabalho em segundo plano fora do JobsService.detach) NÃO derruba a API.
 * O padrão do Node é sair do processo; aqui loga e segue (todas as rotas continuam no ar).
 */
export function installProcessGuards(log = new Logger('Processo')) {
  process.on('unhandledRejection', (reason) => log.error(`rejeição não tratada: ${(reason as Error)?.stack ?? reason}`));
}

async function bootstrap() {
  installProcessGuards();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  const config = configureApp(app);

  if (!config.isProduction) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('HookMill API').setVersion('1').addBearerAuth().build(),
    );
    SwaggerModule.setup('api/docs', app, doc, { jsonDocumentUrl: 'api/docs-json' });
  }

  await app.listen(config.port);
  console.log(`API em http://localhost:${config.port}/api/v1${config.isProduction ? '' : ' · swagger /api/docs'}`);
}

if (require.main === module) bootstrap();
