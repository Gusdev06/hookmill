import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Auth, AuthContext, ClientAllowed } from '../common/auth/auth-context';
import { ExpensiveAction } from '../common/throttle/app-throttler.guard';
import { ApproveDto, ChangeRequestDto } from './revisao.dto';
import { RevisaoService } from './revisao.service';

@ApiTags('review')
@ApiBearerAuth()
@Controller('creatives/:id')
export class RevisaoController {
  constructor(private readonly revisao: RevisaoService) {}

  @Get('review')
  review(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.revisao.review(auth, id);
  }

  @ClientAllowed() @HttpCode(200) @Post('approve')
  approve(@Auth() auth: AuthContext, @Param('id') id: string, @Body() _dto: ApproveDto) {
    return this.revisao.approve(auth, id);
  }

  @ClientAllowed() @ExpensiveAction() @HttpCode(200) @Post('changes')
  change(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: ChangeRequestDto) {
    return this.revisao.change(auth, id, dto);
  }
}
