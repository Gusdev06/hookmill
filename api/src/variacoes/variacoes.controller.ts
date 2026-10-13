import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Auth, AuthContext } from '../common/auth/auth-context';
import { ExpensiveAction } from '../common/throttle/app-throttler.guard';
import { BatchSettingsDto, CreateBatchDto, GenerateCastingFacesDto, LaunchBatchDto, RegenerateItemDto, ReplanBatchDto, UpdateCastingDto, UpdateItemDto } from './variacoes.dto';
import { VariacoesService } from './variacoes.service';

/** Lotes a partir do campeão (§4.2/§4.3). */
@ApiTags('champions')
@ApiBearerAuth()
@Controller('champions/:championId/batches')
export class ChampionBatchesController {
  constructor(private readonly variacoes: VariacoesService) {}

  @Get()
  list(@Auth() auth: AuthContext, @Param('championId') championId: string) {
    return this.variacoes.listForChampion(auth, championId);
  }

  @ExpensiveAction() @HttpCode(202) @Post()
  create(@Auth() auth: AuthContext, @Param('championId') championId: string, @Body() dto: CreateBatchDto) {
    return this.variacoes.create(auth, championId, dto);
  }
}

@ApiTags('variation-batches')
@ApiBearerAuth()
@Controller('variation-batches/:id')
export class VariacoesController {
  constructor(private readonly variacoes: VariacoesService) {}

  @Get()
  get(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.variacoes.get(auth, id);
  }

  @ExpensiveAction() @HttpCode(202) @Post('replan')
  replan(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: ReplanBatchDto) {
    return this.variacoes.replan(auth, id, dto);
  }

  @Patch('items/:itemId')
  updateItem(@Auth() auth: AuthContext, @Param('id') id: string, @Param('itemId') itemId: string, @Body() dto: UpdateItemDto) {
    return this.variacoes.updateItem(auth, id, itemId, dto);
  }

  @HttpCode(202) @Post('items/:itemId/regenerate')
  regenerateItem(@Auth() auth: AuthContext, @Param('id') id: string, @Param('itemId') itemId: string, @Body() dto: RegenerateItemDto) {
    return this.variacoes.regenerateItem(auth, id, itemId, dto.note);
  }

  @Patch('settings')
  updateSettings(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: BatchSettingsDto) {
    return this.variacoes.updateSettings(auth, id, dto);
  }

  @Patch('castings/:castingId')
  updateCasting(@Auth() auth: AuthContext, @Param('id') id: string, @Param('castingId') castingId: string, @Body() dto: UpdateCastingDto) {
    return this.variacoes.updateCasting(auth, id, castingId, dto.description);
  }

  @ExpensiveAction() @HttpCode(202) @Post('castings/:castingId/faces/generate')
  generateFaces(@Auth() auth: AuthContext, @Param('id') id: string, @Param('castingId') castingId: string, @Body() dto: GenerateCastingFacesDto) {
    return this.variacoes.generateCastingFaces(auth, id, castingId, dto.description, dto.count);
  }

  @HttpCode(200) @Post('castings/:castingId/faces/:faceId/select')
  selectFace(@Auth() auth: AuthContext, @Param('id') id: string, @Param('castingId') castingId: string, @Param('faceId') faceId: string) {
    return this.variacoes.selectCastingFace(auth, id, castingId, faceId);
  }

  @Get('estimate')
  estimate(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.variacoes.estimate(auth, id);
  }

  @ExpensiveAction() @HttpCode(202) @Post('launch')
  launch(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: LaunchBatchDto) {
    return this.variacoes.launch(auth, id, dto.expectedCostUsd);
  }
}
