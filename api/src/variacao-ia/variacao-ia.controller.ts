import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Auth, AuthContext } from '../common/auth/auth-context';
import { ExpensiveAction } from '../common/throttle/app-throttler.guard';
import { CreateSemanticPlanDto, ListSemanticPlansDto } from './variacao-ia.dto';
import { VariacaoIaService } from './variacao-ia.service';

@ApiTags('ai-variations') @ApiBearerAuth() @Controller('ai-variations')
export class VariacaoIaController {
  constructor(private readonly plans: VariacaoIaService) {}
  @Get('config') config(@Auth() auth: AuthContext) { return this.plans.config(auth); }
  @Get() list(@Auth() auth: AuthContext, @Query() q: ListSemanticPlansDto) { return this.plans.list(auth, q.championId); }
  @Get(':id') get(@Auth() auth: AuthContext, @Param('id') id: string) { return this.plans.get(auth, id); }
  @ExpensiveAction() @HttpCode(202) @Post()
  create(@Auth() auth: AuthContext, @Body() dto: CreateSemanticPlanDto) { return this.plans.create(auth, dto); }
}
