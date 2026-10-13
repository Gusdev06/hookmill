// POST /iterate/:id/zip (variacao-auto-v1 §5.1): "Download zip" · todos os papéis (CLIENT incluso).
import { Body, Controller, Param, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Auth, AuthContext, ClientAllowed } from '../common/auth/auth-context';
import { ZipService } from './zip.service';

export class ZipEmptyDto {}

@ApiTags('iterate')
@ApiBearerAuth()
@Controller('iterate')
export class ZipController {
  constructor(private readonly zip: ZipService) {}

  @ClientAllowed() @Post(':id/zip')
  async build(@Auth() auth: AuthContext, @Param('id') id: string, @Body() _dto: ZipEmptyDto, @Res({ passthrough: true }) res: Response) {
    const r = await this.zip.request(auth, id);
    res.status(r.httpStatus);
    return { zip: r.zip };
  }
}
