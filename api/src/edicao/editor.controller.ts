import { Body, Controller, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { SampleCreativeGuard } from '../amostra/amostra.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Auth, AuthContext } from '../common/auth/auth-context';
import { ExportEditorDto, PutEditorDto } from './editor.dto';
import { EditorAutoService } from './editor-auto.service';
import { EditorService } from './editor.service';

/**
 * Editor no vídeo v1 (docs/contratos/editor-v1.md §5) + editor universal v1 (editor-universal-v1.md §7.1, F-U1: peça AUTO
 * FRAME/HEADLINE responde EditorStateV3 e ganha export/recheck). O guard global garante o workspace do token; o CLIENT só
 * lê (GET), também pelo guard global.
 */
@ApiTags('editor')
@ApiBearerAuth()
@UseGuards(SampleCreativeGuard) // amostra-gratis-v1 §4: abrir no editor trava (402)
@Controller('creatives/:id/editor')
export class EditorController {
  constructor(private readonly editor: EditorService, private readonly auto: EditorAutoService) {}

  @Get()
  get(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.editor.get(auth, id);
  }

  @Put()
  put(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: PutEditorDto) {
    return this.editor.put(auth, id, dto);
  }

  /** §9: re-render grátis da peça com o doc salvo (202 EditorExportView). */
  @HttpCode(202) @Post('export')
  export(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: ExportEditorDto) {
    return this.auto.export(auth, id, dto.revision);
  }

  /** §9.4: refaz as checagens no mesmo arquivo do export reprovado por checagem (202 EditorExportView). */
  @HttpCode(202) @Post('export/recheck')
  recheck(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.auto.recheck(auth, id);
  }
}
