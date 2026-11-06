// ads-research-v1 §7 (Ad Radar; a API segue em /research/*). Toda rota exige sessão e workspace ativo (AuthGuard global);
// CLIENT só lê: descobrir, remover, restaurar, atualizar, salvar e usar = 403 (sem @ClientAllowed, o guard nega).
import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Auth, AuthContext } from '../common/auth/auth-context';
import { ResearchService } from './research.service';

@ApiTags('research')
@ApiBearerAuth()
@Controller('research')
export class ResearchController {
  constructor(private readonly research: ResearchService) {}

  @Get('status')
  status(@Auth() auth: AuthContext) {
    return this.research.status(auth);
  }

  @Get('discovery')
  discovery(@Auth() auth: AuthContext) {
    return this.research.discoveryView(auth);
  }

  /** "Procurar de novo" (1× a cada 7 dias). */
  @HttpCode(202) @Post('discovery')
  requestDiscovery(@Auth() auth: AuthContext) {
    return this.research.requestDiscovery(auth);
  }
}
