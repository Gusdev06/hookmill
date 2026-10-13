import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Auth, AuthContext } from '../common/auth/auth-context';
import { ExpensiveAction } from '../common/throttle/app-throttler.guard';
import { ConfirmDto, GenerateScriptsDto, UpdateScriptDto } from './roteiros.dto';
import { RoteirosService } from './roteiros.service';

@ApiTags('scripts')
@ApiBearerAuth()
@Controller('creatives/:id/scripts')
export class RoteirosController {
  constructor(private readonly roteiros: RoteirosService) {}

  @Get()
  list(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.roteiros.list(auth, id);
  }

  @ExpensiveAction() @HttpCode(202) @Post('generate')
  generate(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: GenerateScriptsDto) {
    return this.roteiros.generate(auth, id, dto.count, dto.replace);
  }

  @ExpensiveAction() @HttpCode(202) @Post(':scriptId/regenerate')
  regenerate(@Auth() auth: AuthContext, @Param('id') id: string, @Param('scriptId') scriptId: string, @Body() _dto: ConfirmDto) {
    return this.roteiros.regenerate(auth, id, scriptId);
  }

  @Patch(':scriptId')
  update(@Auth() auth: AuthContext, @Param('id') id: string, @Param('scriptId') scriptId: string, @Body() dto: UpdateScriptDto) {
    return this.roteiros.update(auth, id, scriptId, dto);
  }

  @HttpCode(200) @Post(':scriptId/select')
  select(@Auth() auth: AuthContext, @Param('id') id: string, @Param('scriptId') scriptId: string, @Body() dto: ConfirmDto) {
    return this.roteiros.select(auth, id, scriptId, dto.confirm);
  }
}
