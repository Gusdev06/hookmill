// ads-research-v1 §5/§6/§7: grid, detalhe, salvar e carregar vídeo (CLIENT só lê).
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Auth, AuthContext } from '../common/auth/auth-context';
import { ResearchAdsService } from './ads.service';
import { ListResearchAdsQueryDto, SaveResearchAdDto } from './dto/research.dto';

@ApiTags('research')
@ApiBearerAuth()
@Controller('research/ads')
export class AdsController {
  constructor(private readonly ads: ResearchAdsService) {}

  @Get()
  list(@Auth() auth: AuthContext, @Query() q: ListResearchAdsQueryDto) {
    return this.ads.list(auth, q);
  }

  @Get(':id')
  detail(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.ads.detail(auth, id);
  }

  @HttpCode(202) @Post(':id/media')
  media(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.ads.requestMedia(auth, id);
  }

  @Put(':id/save')
  save(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: SaveResearchAdDto) {
    return this.ads.save(auth, id, dto.note);
  }

  @HttpCode(204) @Delete(':id/save')
  async unsave(@Auth() auth: AuthContext, @Param('id') id: string) {
    await this.ads.unsave(auth, id);
  }
}
