import { Body, Controller, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Auth, AuthContext } from '../common/auth/auth-context';
import { CreateUploadDto } from './uploads.dto';
import { UploadsService } from './uploads.service';

@ApiTags('uploads')
@ApiBearerAuth()
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @HttpCode(201) @Post()
  create(@Auth() auth: AuthContext, @Body() dto: CreateUploadDto) {
    return this.uploads.create(auth, dto);
  }

  /** Só em UPLOAD_MODE=proxy. Exige Bearer; upload de outro workspace = 404. */
  @Put(':id/content')
  content(@Auth() auth: AuthContext, @Param('id') id: string, @Req() req: Request) {
    return this.uploads.content(auth, id, req);
  }

  @HttpCode(200) @Post(':id/complete')
  complete(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.uploads.complete(auth, id);
  }
}
