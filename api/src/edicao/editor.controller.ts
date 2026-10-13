import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Auth, AuthContext } from '../common/auth/auth-context';
import { PutEditorDto } from './editor.dto';
import { EditorService } from './editor.service';

/** Editor no vídeo v1 (docs/contratos/editor-v1.md §5). O guard global garante o workspace do token. */
@ApiTags('editor')
@ApiBearerAuth()
@Controller('creatives/:id/editor')
export class EditorController {
  constructor(private readonly editor: EditorService) {}

  @Get()
  get(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.editor.get(auth, id);
  }

  @Put()
  put(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: PutEditorDto) {
    return this.editor.put(auth, id, dto);
  }
}
