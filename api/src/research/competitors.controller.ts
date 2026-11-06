// ads-research-v1 §2.5/§7: concorrentes (CLIENT só lê; adicionar = só equipe, R10).
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Auth, AuthContext } from '../common/auth/auth-context';
import { CompetitorsService } from './competitors.service';
import { AddCompetitorDto, DismissCompetitorDto, ListCompetitorsQueryDto, UpdateCompetitorDto } from './dto/research.dto';

@ApiTags('research')
@ApiBearerAuth()
@Controller('research/competitors')
export class CompetitorsController {
  constructor(private readonly competitors: CompetitorsService) {}

  @Get()
  list(@Auth() auth: AuthContext, @Query() q: ListCompetitorsQueryDto) {
    return this.competitors.list(auth, q.status);
  }

  /** R10: só a equipe (INTERNAL OWNER). */
  @HttpCode(202) @Post()
  add(@Auth() auth: AuthContext, @Body() dto: AddCompetitorDto) {
    return this.competitors.add(auth, dto);
  }

  @Patch(':id')
  rename(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: UpdateCompetitorDto) {
    return this.competitors.rename(auth, id, dto.name);
  }

  @HttpCode(200) @Post(':id/dismiss')
  dismiss(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: DismissCompetitorDto) {
    return this.competitors.dismiss(auth, id, dto.reason);
  }

  @HttpCode(200) @Post(':id/restore')
  restore(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.competitors.restore(auth, id);
  }

  @HttpCode(202) @Post(':id/refresh')
  refresh(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.competitors.refresh(auth, id);
  }
}
