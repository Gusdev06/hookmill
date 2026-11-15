import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { createValidationPipe } from './common/http/validation';
import { AppConfig } from './config/app-config';

/**
 * 15/11 (diagnóstico de lentidão): `Server-Timing: app;dur=<ms>` em toda resposta (o navegador separa servidor de rede)
 * e `Timing-Allow-Origin` pro site ler os tempos. Requisição acima de LENTA_MS vai pro log com método, rota e status.
 */
const LENTA_MS = Number(process.env.SLOW_REQUEST_MS) || 800;
function tempoDoServidor(origens: string | string[] | boolean | RegExp | (string | RegExp)[] | undefined) {
  const log = new Logger('Tempo');
  const tao = (Array.isArray(origens) ? origens : [origens]).filter((o): o is string => typeof o === 'string').join(' ') || '*';
  return (req: Request, res: Response, next: NextFunction) => {
    const t0 = process.hrtime.bigint();
    const ms = () => Number(process.hrtime.bigint() - t0) / 1e6;
    const writeHead = res.writeHead;
    res.writeHead = function (this: Response, ...args: Parameters<Response['writeHead']>) {
      if (!this.headersSent) {
        this.setHeader('Server-Timing', `app;dur=${ms().toFixed(1)}`);
        this.setHeader('Timing-Allow-Origin', tao);
      }
      return writeHead.apply(this, args);
    } as Response['writeHead'];
    res.on('finish', () => {
      const d = ms();
      if (d >= LENTA_MS && req.method !== 'OPTIONS') log.warn(`${req.method} ${req.path} ${res.statusCode} ${d.toFixed(0)} ms`);
    });
    next();
  };
}

export function configureApp(app: NestExpressApplication) {
  const config = app.get(AppConfig);
  app.setGlobalPrefix('api/v1');
  app.set('trust proxy', 1); // atrás do Traefik do EasyPanel: IP real pro throttle
  app.use(tempoDoServidor(config.webOrigins));
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.useBodyParser('json', { limit: '2mb' }); // rawBody: true guarda o corpo cru (webhook assinado)
  app.enableCors({
    origin: config.webOrigins,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    // 15/11: sem isto o Chrome guarda o preflight só 5 s e quase toda chamada pagava 2 viagens (~0,3 s cada, de Bali).
    // 7200 s é o teto do Chrome.
    maxAge: 7200,
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
