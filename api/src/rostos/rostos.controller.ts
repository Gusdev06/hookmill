import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Auth, AuthContext } from '../common/auth/auth-context';
import { ExpensiveAction } from '../common/throttle/app-throttler.guard';
import { ConfirmDto } from '../roteiros/roteiros.dto';
import { FaceDescriptionDto, GenerateFacesDto } from './rostos.dto';
import { RostosService } from './rostos.service';

@ApiTags('faces')
@ApiBearerAuth()
@Controller('creatives/:id/faces')
export class RostosController {
  constructor(private readonly rostos: RostosService) {}

  @Get()
  list(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.rostos.list(auth, id);
  }

  @ExpensiveAction() @HttpCode(202) @Post('generate')
  generate(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: GenerateFacesDto) {
    return this.rostos.generate(auth, id, dto.description, dto.count);
  }

  @Patch('description')
  description(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: FaceDescriptionDto) {
    return this.rostos.updateDescription(auth, id, dto.description);
  }

  @HttpCode(200) @Post(':faceId/select')
  select(@Auth() auth: AuthContext, @Param('id') id: string, @Param('faceId') faceId: string, @Body() dto: ConfirmDto) {
    return this.rostos.select(auth, id, faceId, dto.confirm);
  }
}
