import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { SampleCreativeGuard } from '../amostra/amostra.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Auth, AuthContext } from '../common/auth/auth-context';
import { Paginated } from '../common/http/envelope.interceptor';
import { ExpensiveAction } from '../common/throttle/app-throttler.guard';
import { CreateCreativeDto, ListCreativesDto, UpdateCreativeDto } from './criativos.dto';
import { CriativosService } from './criativos.service';

@ApiTags('creatives')
@ApiBearerAuth()
@Controller('creatives')
export class CriativosController {
  constructor(private readonly criativos: CriativosService) {}

  @Get()
  async list(@Auth() auth: AuthContext, @Query() q: ListCreativesDto) {
    const r = await this.criativos.list(auth, q);
    return new Paginated(r.items, { ...r.meta });
  }

  @ExpensiveAction() @Post()
  create(@Auth() auth: AuthContext, @Body() dto: CreateCreativeDto) {
    return this.criativos.create(auth, dto);
  }

  @UseGuards(SampleCreativeGuard) // amostra-gratis-v1 §3: o detalhe traz a URL do render
  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.criativos.get(auth, id);
  }

  @Patch(':id')
  rename(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: UpdateCreativeDto) {
    return this.criativos.rename(auth, id, dto.name);
  }

  @Delete(':id')
  archive(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.criativos.archive(auth, id);
  }
}
