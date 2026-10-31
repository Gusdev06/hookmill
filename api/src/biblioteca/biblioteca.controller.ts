import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { SampleCreativeGuard } from '../amostra/amostra.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Auth, AuthContext, ClientAllowed } from '../common/auth/auth-context';
import { Paginated } from '../common/http/envelope.interceptor';
import { DownloadQueryDto, LibraryQueryDto, WinnerDto } from './biblioteca.dto';
import { BibliotecaService } from './biblioteca.service';

@ApiTags('library')
@ApiBearerAuth()
@Controller('library')
export class BibliotecaController {
  constructor(private readonly biblioteca: BibliotecaService) {}

  @Get()
  async list(@Auth() auth: AuthContext, @Query() q: LibraryQueryDto) {
    const r = await this.biblioteca.list(auth, q);
    return new Paginated(r.items, { ...r.meta });
  }

  @ClientAllowed() @Put(':creativeId/winner')
  winner(@Auth() auth: AuthContext, @Param('creativeId') id: string, @Body() dto: WinnerDto) {
    return this.biblioteca.setWinner(auth, id, dto.isWinner);
  }
}

/** fase2-agencia.md §3.5 (Send): baixar o MP4 com o nome padronizado. GET: liberado pra todos os papéis, inclusive CLIENT. */
@ApiTags('library')
@ApiBearerAuth()
@UseGuards(SampleCreativeGuard) // amostra-gratis-v1 §4: download trava (402)
@Controller('creatives/:id')
export class DownloadController {
  constructor(private readonly biblioteca: BibliotecaService) {}

  @Get('download')
  download(@Auth() auth: AuthContext, @Param('id') id: string, @Query() q: DownloadQueryDto) {
    return this.biblioteca.download(auth, id, q.format);
  }
}
