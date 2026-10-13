import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Auth, AuthContext } from '../common/auth/auth-context';
import { Paginated } from '../common/http/envelope.interceptor';
import { ExpensiveAction } from '../common/throttle/app-throttler.guard';
import { AnalyzeChampionDto, AttachVideoDto, CreateChampionDto, ListChampionsQueryDto, UpdateChampionDto, UpdateTeardownDto } from './campeoes.dto';
import { CampeoesService } from './campeoes.service';

@ApiTags('champions')
@ApiBearerAuth()
@Controller('champions')
export class CampeoesController {
  constructor(private readonly campeoes: CampeoesService) {}

  @Get('config')
  config() {
    return this.campeoes.config();
  }

  @Get()
  async list(@Auth() auth: AuthContext, @Query() q: ListChampionsQueryDto) {
    const r = await this.campeoes.list(auth, q);
    return new Paginated(r.items, { nextCursor: r.nextCursor });
  }

  @ExpensiveAction() @HttpCode(202) @Post()
  create(@Auth() auth: AuthContext, @Body() dto: CreateChampionDto) {
    return this.campeoes.create(auth, dto);
  }

  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.campeoes.get(auth, id);
  }

  @Patch(':id')
  update(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: UpdateChampionDto) {
    return this.campeoes.update(auth, id, dto);
  }

  @HttpCode(202) @Put(':id/video')
  attachVideo(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: AttachVideoDto) {
    return this.campeoes.attachVideo(auth, id, dto.uploadId);
  }

  @ExpensiveAction() @HttpCode(202) @Post(':id/analyze')
  analyze(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: AnalyzeChampionDto) {
    return this.campeoes.analyze(auth, id, dto);
  }

  @Patch(':id/teardown')
  updateTeardown(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: UpdateTeardownDto) {
    return this.campeoes.updateTeardown(auth, id, dto);
  }

  @Delete(':id')
  remove(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.campeoes.remove(auth, id);
  }
}
