import { BadRequestException, Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/auth/auth-context';
import { RawResponse } from '../../common/http/envelope.interceptor';
import type { VideoFormat } from '../contrato';
import { FORMATS, MOCK_MAX_SEC, MOCK_MEDIA_ROUTE, ensureMockLipsync, ensureMockMedia, seedOf, type MockMediaKind } from './midia';

/**
 * Serve a mídia sintética do modo mock (só registrado com INTEGRACOES_MODE=mock).
 * Público porque o StorageService.ingestFromUrl baixa sem token, como baixaria da WaveSpeed.
 * Parâmetros travados (semente hex de 16, formato do enum, 1-30 s) pra não virar gerador aberto.
 */
@Public()
@RawResponse()
@Controller(MOCK_MEDIA_ROUTE)
export class MockMediaController {
  @Get('voice/:voiceId')
  async voice(@Param('voiceId') voiceId: string, @Res() res: Response) {
    const id = voiceId.replace(/\.wav$/, '');
    if (!/^[A-Za-z0-9_]{1,40}$/.test(id)) throw new BadRequestException('invalid voice');
    const f = await ensureMockMedia({ kind: 'audio', seed: seedOf('voice', id), sec: 3 });
    res.type(f.mimeType).sendFile(f.path);
  }

  /** §13: clipe de lipsync do mock (rosto enviado em loop + áudio enviado). Só existe se a task mock gravou a spec. */
  @Get('lipsync/:file')
  async lipsync(@Param('file') file: string, @Res() res: Response) {
    const seed = file.replace(/\.mp4$/, '');
    if (!/^[0-9a-f]{16}$/.test(seed)) throw new BadRequestException('invalid file');
    let f: { path: string; mimeType: string };
    try {
      f = await ensureMockLipsync(seed);
    } catch {
      throw new NotFoundException('unknown lipsync');
    }
    res.type(f.mimeType).sendFile(f.path);
  }

  @Get(':kind/:file')
  async media(
    @Param('kind') kind: string,
    @Param('file') file: string,
    @Query('format') format: string | undefined,
    @Query('sec') sec: string | undefined,
    @Res() res: Response,
  ) {
    if (!['face', 'video', 'audio', 'static'].includes(kind)) throw new BadRequestException('invalid kind');
    const seed = file.replace(/\.(png|mp4|wav)$/, '');
    if (!/^[0-9a-f]{16}$/.test(seed)) throw new BadRequestException('invalid file');
    if (format && !FORMATS.includes(format as VideoFormat)) throw new BadRequestException('invalid format');
    const s = sec == null ? undefined : Number(sec);
    if (s != null && !(s >= 1 && s <= MOCK_MAX_SEC)) throw new BadRequestException('invalid sec');
    const f = await ensureMockMedia({ kind: kind as MockMediaKind, seed, format: format as VideoFormat | undefined, sec: s });
    res.type(f.mimeType).sendFile(f.path);
  }
}
