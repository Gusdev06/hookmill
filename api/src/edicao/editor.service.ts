// Editor no vídeo v1, F2a (docs/contratos/editor-v1.md §5): GET/PUT /creatives/:id/editor do criativo do zero.
// remix-keep fica 422 EDIT_NOT_SUPPORTED até o F3.
import { Injectable } from '@nestjs/common';
import type { EditDoc, EditNotSupportedDetails, EditSettings, EditorLayerInfo, EditorState, PutEditorResponse, ScratchSource, UserRef } from '@maquina/contratos';
import { FONT_CATALOG, framesDasCenas, layoutPadrao, normalizarDoc, resolverProps, validarDoc, type FontId, type TemplateId } from '@maquina/video';
import type { Creative, Prisma } from '@prisma/client';
import { StorageService } from '../arquivos/storage.service';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { initials } from '../common/util/format';
import { KeyedMutex } from '../common/util/mutex';
import { AppConfig } from '../config/app-config';
import { CreativeStateMachine, assertNotAutoPiece, assertState, invalidState } from '../criativos/state-machine';
import { CreativeViews, currentScenes, editSettingsOf } from '../criativos/views';
import { EventosService } from '../eventos/eventos.service';
import { PrismaService } from '../prisma/prisma.service';
import { REMIX_KEEP_TEMPLATE } from './edicao.service';
import { EDITABLE, aplicarMudancaDeSettings, definidos, cenaPronta, docJson, editDocOf, montarScratchSource } from './editor-doc';
import { EditorSaves, anunciarEdicao } from './editor-saves';
import type { PutEditorDto } from './editor.dto';

const FPS = 30;
const CAMADAS = ['hook', 'caption', 'cta'] as const;

@Injectable()
export class EditorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly sm: CreativeStateMachine,
    private readonly views: CreativeViews,
    private readonly eventos: EventosService,
    private readonly locks: KeyedMutex,
    private readonly config: AppConfig,
    private readonly saves: EditorSaves,
  ) {}

  private async creative(auth: AuthContext, id: string): Promise<Creative> {
    const c = await this.prisma.creative.findFirst({ where: { id, workspaceId: auth.workspaceId, archivedAt: null } });
    if (!c) throw new AppException('NOT_FOUND');
    return c;
  }

  /** Estado + ajustes + tipo. remix-keep: 422 até o F3. */
  private check(c: Creative): EditSettings {
    assertNotAutoPiece(c); // variacao-auto-v1 §3.3
    const settings = editSettingsOf(c.editSettings);
    if (settings?.templateId === REMIX_KEEP_TEMPLATE) throw new AppException('EDIT_NOT_SUPPORTED', { reason: 'remix_editor_not_enabled' } satisfies EditNotSupportedDetails);
    assertState(c.state, [...EDITABLE]);
    if (!settings) throw invalidState(c.state, [...EDITABLE]);
    return settings;
  }

  /** Fonte do editor: todas as cenas vigentes prontas, com URL assinada. Sem isso (cena gerando/falhou) = 409. */
  private async fonte(c: Creative): Promise<ScratchSource> {
    const scenes = await currentScenes(this.prisma, c.id);
    if (!scenes.length || !scenes.every(cenaPronta)) throw invalidState(c.state, ['EDIT_PENDING', 'RENDER_FAILED', 'RENDER_READY']);
    const ids = scenes.flatMap((s) => [s.clipFileId, s.thumbnailFileId]).filter((x): x is string => !!x);
    const files = new Map((await this.prisma.file.findMany({ where: { id: { in: ids } } })).map((f) => [f.id, f]));
    return montarScratchSource(scenes, files, (f) => this.storage.fileRef(f), c);
  }

  private camadas(fonte: ScratchSource, settings: EditSettings, doc: EditDoc | null): EditorLayerInfo[] {
    const cenas = resolverProps(fonte, settings, doc ? { ...doc, layers: [], captionWords: [] } : null).scenes;
    const padrao = layoutPadrao(settings.templateId as TemplateId, fonte.format, settings, framesDasCenas(cenas, FPS) / FPS);
    return CAMADAS.map((id) => ({
      id, role: id, labelKey: `editor.layer.${id}`,
      defaults: { transform: padrao[id].transform, timing: padrao[id].timing, style: padrao[id].style, text: padrao[id].text },
      editable: { move: true, text: id !== 'caption', style: true, timing: true, hide: true },
      lockedReason: null,
      leavesEmptyCover: false,
    }));
  }

  async get(auth: AuthContext, creativeId: string): Promise<EditorState> {
    const c = await this.creative(auth, creativeId);
    const settings = this.check(c);
    const fonte = await this.fonte(c);
    const doc = normalizarDoc(editDocOf(c.editDoc), fonte, settings);
    const [latest, preview] = await Promise.all([
      this.prisma.render.findFirst({ where: { creativeId: c.id }, orderBy: { createdAt: 'desc' }, include: { file: true } }),
      this.prisma.render.findFirst({ where: { creativeId: c.id, status: 'READY', stale: false }, orderBy: { createdAt: 'desc' }, include: { file: true } }),
    ]);
    return {
      revision: c.editRevision,
      base: 'scratch',
      composition: 'Criativo',
      settings,
      doc,
      source: fonte,
      urlsExpireAt: new Date(Date.now() + this.config.storage.signedUrlTtlSec * 1000).toISOString(),
      layers: this.camadas(fonte, settings, doc),
      capabilities: { trimScenes: true, reorderScenes: true, trimVideo: false, fixCaptionWords: true, locked: [] },
      fonts: (Object.keys(FONT_CATALOG) as FontId[]).map((id) => ({ id, label: FONT_CATALOG[id].label })),
      dirty: c.editDirty,
      latestRender: latest ? await this.views.render(latest) : null,
      previewRender: preview ? await this.views.render(preview) : null,
      editedInEditor: await this.views.editedInEditor(c),
    };
  }

  /**
   * Salva doc + ajustes (autosave do editor). Ordem: estado → revisão (409 EDIT_CONFLICT) → §3.2 → validarDoc (400 com
   * as regras do contrato) → normalizarDoc → grava com revisão + 1. RENDER_READY vira EDIT_PENDING (EDIT_CHANGED).
   */
  async put(auth: AuthContext, creativeId: string, dto: PutEditorDto): Promise<PutEditorResponse> {
    return this.locks.run(creativeId, async () => {
      const c = await this.creative(auth, creativeId);
      const current = this.check(c);
      if (dto.baseRevision !== c.editRevision) {
        const last = this.saves.get(c.id) ?? (await this.fallbackSave(c));
        throw new AppException('EDIT_CONFLICT', { revision: c.editRevision, savedBy: last.savedBy, savedAt: last.savedAt });
      }
      const settings: EditSettings = { ...current, ...(definidos(dto.settings) as Partial<EditSettings>) };
      const fonte = await this.fonte(c);
      const pedido = aplicarMudancaDeSettings((dto.doc as EditDoc | null) ?? null, current, settings);
      const erros = validarDoc(pedido, fonte);
      if (erros.length) throw new AppException('VALIDATION_ERROR', { fields: erros });
      const doc = normalizarDoc(pedido, fonte, settings);

      const revision = c.editRevision + 1;
      const now = new Date();
      const data = {
        editSettings: settings as unknown as Prisma.InputJsonValue,
        editDoc: docJson(doc),
        editRevision: revision,
        editDirty: true,
      };
      if (c.state === 'RENDER_READY') {
        await this.sm.transition({ creativeId: c.id, event: 'EDIT_CHANGED', from: 'RENDER_READY', to: 'EDIT_PENDING', where: { editRevision: c.editRevision }, data });
      } else {
        const r = await this.prisma.creative.updateMany({ where: { id: c.id, editRevision: c.editRevision, archivedAt: null }, data });
        if (r.count !== 1) {
          const fresh = await this.prisma.creative.findUniqueOrThrow({ where: { id: c.id } });
          const last = this.saves.get(c.id) ?? (await this.fallbackSave(fresh));
          throw new AppException('EDIT_CONFLICT', { revision: fresh.editRevision, savedBy: last.savedBy, savedAt: last.savedAt });
        }
        this.sm.announce(c.id);
      }
      await anunciarEdicao({ prisma: this.prisma, eventos: this.eventos, saves: this.saves }, c.id, auth.userId, revision, now);
      return { revision, doc, settings, dirty: true as const };
    });
  }

  private async fallbackSave(c: Creative): Promise<{ savedBy: UserRef; savedAt: string }> {
    const u = await this.prisma.user.findUnique({ where: { id: c.createdById }, select: { id: true, name: true } });
    return { savedBy: { id: c.createdById, name: u?.name ?? '', initials: initials(u?.name ?? '') }, savedAt: c.updatedAt.toISOString() };
  }
}
