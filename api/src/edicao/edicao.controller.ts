import { Body, Controller, Get, HttpCode, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import { SampleCreativeGuard } from '../amostra/amostra.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { existsSync } from 'node:fs';
import { Auth, AuthContext, Public } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { EmptyDto, UpdateEditDto } from './edicao.dto';
import { EdicaoService } from './edicao.service';

@ApiTags('templates')
@Controller('templates')
export class TemplatesController {
  constructor(private readonly edicao: EdicaoService) {}

  @ApiBearerAuth() @Get()
  list() {
    return this.edicao.templates();
  }

  /** Miniatura do template (pública: é a mesma pra todo mundo e vai num <img>). */
  @Public() @Get(':id/thumbnail')
  thumbnail(@Param('id') id: string, @Res() res: Response) {
    const path = this.edicao.templateThumbnail(id);
    if (!path || !existsSync(path)) throw new AppException('NOT_FOUND');
    res.sendFile(path);
  }
}

@ApiTags('edit')
@ApiBearerAuth()
@UseGuards(SampleCreativeGuard) // amostra-gratis-v1 §4
@Controller('creatives/:id')
export class EdicaoController {
  constructor(private readonly edicao: EdicaoService) {}

  @Get('edit')
  get(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.edicao.get(auth, id);
  }

  @Patch('edit')
  update(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: UpdateEditDto) {
    return this.edicao.update(auth, id, dto);
  }

  @HttpCode(202) @Post('render')
  render(@Auth() auth: AuthContext, @Param('id') id: string, @Body() _dto: EmptyDto) {
    return this.edicao.requestRender(auth, id);
  }

  @Get('renders/:renderId')
  getRender(@Auth() auth: AuthContext, @Param('id') id: string, @Param('renderId') renderId: string) {
    return this.edicao.getRender(auth, id, renderId);
  }
}
