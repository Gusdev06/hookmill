import { Inject, Injectable, Logger, Module, OnApplicationBootstrap, OnModuleDestroy, type DynamicModule, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogServiceImpl } from './catalogo/catalog.service';
import type { AdLibraryService, ClaudeService, GenerationService } from './contrato';
import { ApifyAdLibraryService, OffAdLibraryService } from './adlibrary/ad-library.service';
import { FakeAdLibraryService } from './adlibrary/fake-ad-library.service';
import { IntegracaoError } from './erros';
import { FakeClaudeService } from './mock/fake-claude.service';
import { FakeGenerationService } from './mock/fake-generation.service';
import { MockMediaController } from './mock/mock-media.controller';
import { mockVoiceSampleUrl } from './mock/midia';
import type { CostStore, ProviderTaskStore } from './portas';
import { PrismaCostStore, PrismaTaskStore } from './store/prisma.store';
import Anthropic from '@anthropic-ai/sdk';
import { ClaudeLiveService } from './claude/claude.service';
import { SdkClaudeTransport, type SdkTransportOptions } from './claude/transporte';
import { HiggsfieldClient } from './higgsfield/cliente';
import { WaveSpeedClient } from './wavespeed/cliente';
import { mediaPromptVersion } from './wavespeed/prompts-midia';
import { WaveSpeedGenerationService } from './wavespeed/generation.service';
import { Reconciliador } from './wavespeed/reconciliador';
import { WAVESPEED_LIVE, WAVESPEED_WEBHOOK_ROUTE, WAVESPEED_WEBHOOK_SECRET, WaveSpeedWebhookController } from './wavespeed/webhook.controller';

/** Tokens de injeção. O backend injeta por eles e tipa pelos interfaces de ./contrato. */
export const CLAUDE_SERVICE = Symbol('CLAUDE_SERVICE');
export const GENERATION_SERVICE = Symbol('GENERATION_SERVICE');
export const CATALOG_SERVICE = Symbol('CATALOG_SERVICE');
/** feature 2: link da Ad Library (Apify). Modo em AD_LIBRARY_MODE (mock | live | off); sem a env, segue o INTEGRACOES_MODE. */
export const AD_LIBRARY_SERVICE = Symbol('AD_LIBRARY_SERVICE');
const TASK_STORE = Symbol('INTEGRACOES_TASK_STORE');
const COST_STORE = Symbol('INTEGRACOES_COST_STORE');

export type IntegracoesMode = 'mock' | 'live';

export function integracoesMode(env: NodeJS.ProcessEnv = process.env): IntegracoesMode {
  return env.INTEGRACOES_MODE === 'live' ? 'live' : 'mock';
}

export type AdLibraryMode = 'mock' | 'live' | 'off';

export function adLibraryMode(v: string | undefined, mode: IntegracoesMode): AdLibraryMode {
  const m = (v ?? '').trim().toLowerCase();
  return m === 'mock' || m === 'live' || m === 'off' ? m : mode;
}

function publicApiUrl(cfg: ConfigService): string {
  return cfg.get<string>('PUBLIC_API_URL') || `http://localhost:${cfg.get<string>('PORT') || 3001}`;
}

/** Live sem chave no .env: sobe a API, mas toda chamada falha explícita (NOT_CONFIGURED), nunca cai no mock.
 *  Objeto com métodos explícitos (um Proxy responderia `then` e o Nest o trataria como Promise). */
function notConfigured<T extends object>(name: string, missing: string, methods: string[]): T {
  const fail = (m: string) => () => Promise.reject(new IntegracaoError('NOT_CONFIGURED', `${name}.${m}: ${missing} is empty in api/.env`));
  return Object.fromEntries(methods.map((m) => [m, fail(m)])) as T;
}

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
function effortOf(v: string | undefined): SdkTransportOptions['effort'] {
  return (EFFORTS as readonly string[]).includes(v ?? '') ? (v as SdkTransportOptions['effort']) : 'medium';
}

function webhooksOn(cfg: ConfigService): boolean {
  return (cfg.get<string>('WAVESPEED_WEBHOOKS') ?? 'on').toLowerCase() !== 'off';
}

/**
 * IntegracoesModule.register() no app.module. Depende de PrismaModule (global), AppConfigModule (global)
 * e EventEmitterModule.forRoot() (o backend registra). Modo vem de INTEGRACOES_MODE (padrão: mock).
 */
@Module({})
export class IntegracoesModule {
  static register(mode: IntegracoesMode = integracoesMode()): DynamicModule {
    const providers: Provider[] = [
      { provide: TASK_STORE, useFactory: (db: PrismaService) => new PrismaTaskStore(db), inject: [PrismaService] },
      { provide: COST_STORE, useFactory: (db: PrismaService) => new PrismaCostStore(db), inject: [PrismaService] },
      {
        provide: CATALOG_SERVICE,
        useFactory: (cfg: ConfigService) =>
          new CatalogServiceImpl({
            // live: amostra real gravada no I3; até lá vazio (o web esconde o play)
            voiceSampleUrl: (id) => (mode === 'mock' ? mockVoiceSampleUrl(publicApiUrl(cfg), id) : ''),
          }),
        inject: [ConfigService],
      },
      {
        provide: CLAUDE_SERVICE,
        useFactory: (costs: CostStore, cfg: ConfigService): ClaudeService => {
          const model = cfg.get<string>('ANTHROPIC_MODEL') || 'claude-opus-5-5';
          if (mode === 'mock') return new FakeClaudeService(costs, { model });
          const apiKey = cfg.get<string>('ANTHROPIC_API_KEY');
          if (!apiKey) return notConfigured<ClaudeService>('ClaudeService', 'ANTHROPIC_API_KEY', ['extractOffer', 'generateScripts', 'suggestFaceDescription', 'analyzeChampion', 'planVariations', 'describeEdit', 'planAutoBatch']);
          const transport = new SdkClaudeTransport(new Anthropic({ apiKey, maxRetries: 2 }), {
            model,
            effort: effortOf(cfg.get<string>('ANTHROPIC_EFFORT')),
            fallbacks: (cfg.get<string>('ANTHROPIC_FALLBACKS') ?? 'on').toLowerCase() !== 'off',
          });
          return new ClaudeLiveService(transport, costs, { model });
        },
        inject: [COST_STORE, ConfigService],
      },
      {
        provide: WAVESPEED_LIVE,
        useFactory: (tasks: ProviderTaskStore, costs: CostStore, bus: EventEmitter2, cfg: ConfigService): WaveSpeedGenerationService | null => {
          const apiKey = cfg.get<string>('WAVESPEED_API_KEY');
          if (mode === 'mock' || !apiKey) return null;
          const hfId = cfg.get<string>('HF_API_KEY_ID');
          const hfSecret = cfg.get<string>('HF_API_KEY_SECRET');
          return new WaveSpeedGenerationService(new WaveSpeedClient({ apiKey }), tasks, costs, bus, {
            // rosto = Higgsfield Soul V2; sem as duas chaves, submitFace falha NOT_CONFIGURED (nunca mock)
            higgsfield: hfId && hfSecret ? new HiggsfieldClient({ keyId: hfId, keySecret: hfSecret }) : null,
            // prompts de mídia: V2 é o padrão (06/10); MEDIA_PROMPTS=v1 volta pra V1
            promptVersion: mediaPromptVersion(cfg.get<string>('MEDIA_PROMPTS')),
            webhookUrl: webhooksOn(cfg) ? `${publicApiUrl(cfg).replace(/\/$/, '')}/api/v1/${WAVESPEED_WEBHOOK_ROUTE}` : null,
            // PUBLIC_MEDIA=off: toda entrada (rosto, áudio, clipe) sobe pela WaveSpeed; URL local/privada sobe sempre
            forceUpload: (cfg.get<string>('PUBLIC_MEDIA') ?? 'on').toLowerCase() === 'off',
          });
        },
        inject: [TASK_STORE, COST_STORE, EventEmitter2, ConfigService],
      },
      {
        provide: WAVESPEED_WEBHOOK_SECRET,
        useFactory: (cfg: ConfigService) => cfg.get<string>('WAVESPEED_WEBHOOK_SECRET') || null,
        inject: [ConfigService],
      },
      {
        provide: GENERATION_SERVICE,
        useFactory: (tasks: ProviderTaskStore, costs: CostStore, bus: EventEmitter2, cfg: ConfigService, live: WaveSpeedGenerationService | null): GenerationService => {
          if (mode === 'mock') return new FakeGenerationService(tasks, costs, bus, { publicApiUrl: publicApiUrl(cfg) });
          return live ?? notConfigured<GenerationService>('GenerationService', 'WAVESPEED_API_KEY', ['submitFace', 'submitSceneVideo', 'submitTts', 'submitLipsync', 'submitTranscribe', 'parseWords', 'parseTranscript']);
        },
        inject: [TASK_STORE, COST_STORE, EventEmitter2, ConfigService, WAVESPEED_LIVE],
      },
      {
        provide: AD_LIBRARY_SERVICE,
        useFactory: (costs: CostStore, cfg: ConfigService): AdLibraryService => {
          const m = adLibraryMode(cfg.get<string>('AD_LIBRARY_MODE'), mode);
          if (m === 'off') return new OffAdLibraryService();
          if (m === 'mock') return new FakeAdLibraryService(costs, { publicApiUrl: publicApiUrl(cfg) });
          // live sem APIFY_TOKEN: status() = not_configured e resolve() falha AD_LIBRARY_UNAVAILABLE (nunca mock)
          return new ApifyAdLibraryService(costs, { token: cfg.get<string>('APIFY_TOKEN') ?? '', actor: cfg.get<string>('APIFY_AD_LIBRARY_ACTOR') || undefined });
        },
        inject: [COST_STORE, ConfigService],
      },
      IntegracoesLifecycle,
    ];
    return {
      module: IntegracoesModule,
      controllers: mode === 'mock' ? [MockMediaController] : [WaveSpeedWebhookController],
      providers,
      exports: [CLAUDE_SERVICE, GENERATION_SERVICE, CATALOG_SERVICE, AD_LIBRARY_SERVICE],
    };
  }
}

/** Boot: retoma tasks mock pendentes ou liga o reconciliador do live. Shutdown: limpa timers. */
@Injectable()
class IntegracoesLifecycle implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Integracoes');
  private reconciler: Reconciliador | null = null;
  private faceReconciler: Reconciliador | null = null;
  constructor(
    @Inject(GENERATION_SERVICE) private readonly gen: GenerationService,
    @Inject(WAVESPEED_LIVE) private readonly live: WaveSpeedGenerationService | null,
    private readonly cfg: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    if (this.gen instanceof FakeGenerationService) {
      const n = await this.gen.resumePending();
      this.log.log(`INTEGRACOES_MODE=mock (custo zero)${n ? `; ${n} task(s) mock retomada(s)` : ''}`);
      return;
    }
    const missing = ['ANTHROPIC_API_KEY', 'WAVESPEED_API_KEY', 'HF_API_KEY_ID', 'HF_API_KEY_SECRET'].filter((k) => !this.cfg.get<string>(k));
    if (missing.length) this.log.warn(`INTEGRACOES_MODE=live sem ${missing.join(', ')}: essas chamadas falham com NOT_CONFIGURED`);
    if (this.live) {
      const on = webhooksOn(this.cfg);
      if (on && !this.cfg.get<string>('WAVESPEED_WEBHOOK_SECRET')) this.log.warn('WAVESPEED_WEBHOOK_SECRET vazio: todo webhook vai dar 401 (o reconciliador cobre)');
      this.reconciler = new Reconciliador(this.live, on);
      this.reconciler.start();
      this.faceReconciler = new Reconciliador(this.live, on, 'HIGGSFIELD');
      this.faceReconciler.start();
      this.log.log(`INTEGRACOES_MODE=live (WaveSpeed: ${on ? 'webhook + reconciliador 2 min' : 'só polling 15 s'}; rosto Higgsfield: polling 5 s; prompts ${mediaPromptVersion(this.cfg.get<string>('MEDIA_PROMPTS'))})`);
    }
  }

  onModuleDestroy() {
    if (this.gen instanceof FakeGenerationService) this.gen.dispose();
    this.reconciler?.stop();
    this.faceReconciler?.stop();
  }
}
