import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Auth, AuthContext } from '../common/auth/auth-context';
import { ExpensiveAction } from '../common/throttle/app-throttler.guard';
import { EstimateQueryDto, GenerateDto, RegenerateSceneDto, RegenerateTakeDto, UpdateEngineDto, VoicesQueryDto } from './geracao.dto';
import { GeracaoService } from './geracao.service';

@ApiTags('engine')
@ApiBearerAuth()
@Controller()
export class CatalogoController {
  constructor(private readonly geracao: GeracaoService) {}

  @Get('engines')
  engines() {
    return this.geracao.engines();
  }

  @Get('voices')
  voices(@Query() q: VoicesQueryDto) {
    return this.geracao.voices(q.language);
  }
}

@ApiTags('generation')
@ApiBearerAuth()
@Controller('creatives/:id')
export class GeracaoController {
  constructor(private readonly geracao: GeracaoService) {}

  @Get('estimate')
  estimate(@Auth() auth: AuthContext, @Param('id') id: string, @Query() q: EstimateQueryDto) {
    return this.geracao.estimate(auth, id, q);
  }

  @Patch('engine')
  updateEngine(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: UpdateEngineDto) {
    return this.geracao.updateEngine(auth, id, dto);
  }

  @ExpensiveAction() @HttpCode(202) @Post('generate')
  generate(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: GenerateDto) {
    return this.geracao.generate(auth, id, dto);
  }

  @Get('scenes')
  scenes(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.geracao.scenes(auth, id);
  }

  @ExpensiveAction() @HttpCode(202) @Post('scenes/:index/regenerate')
  regenerate(@Auth() auth: AuthContext, @Param('id') id: string, @Param('index', ParseIntPipe) index: number, @Body() dto: RegenerateSceneDto) {
    return this.geracao.regenerateScene(auth, id, index, dto);
  }

  /** §13.5: "Refazer o clipe": o take inteiro, com o preço confirmado. */
  @ExpensiveAction() @HttpCode(202) @Post('take/regenerate')
  regenerateTake(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: RegenerateTakeDto) {
    return this.geracao.regenerateTake(auth, id, { expectedCostUsd: dto.expectedCostUsd });
  }
}
