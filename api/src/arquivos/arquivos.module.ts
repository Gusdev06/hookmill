import { Controller, Get, Global, Module, Param, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Auth, AuthContext } from '../common/auth/auth-context';
import { StorageService } from './storage.service';

@ApiTags('files')
@ApiBearerAuth()
@Controller('files')
export class FilesController {
  constructor(private readonly storage: StorageService) {}

  /** 302 pra uma URL assinada nova (6 h). Arquivo de outro workspace = 404. */
  @Get(':id')
  async redirect(@Auth() auth: AuthContext, @Param('id') id: string, @Res() res: Response) {
    const file = await this.storage.getForWorkspace(auth.workspaceId, id);
    res.redirect(302, await this.storage.signedUrl(file));
  }
}

@Global()
@Module({ controllers: [FilesController], providers: [StorageService], exports: [StorageService] })
export class ArquivosModule {}
