import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Auth, AuthContext, ClientAllowed } from '../common/auth/auth-context';
import { BrainGraphQueryDto } from './brain.dto';
import { BrainService } from './brain.service';

/** Brain 3D v1 (docs/contratos/brain-3d-v1.md): só leitura, todos os papéis (inclusive CLIENT). */
@ApiTags('brain')
@ApiBearerAuth()
@Controller('brain')
export class BrainController {
  constructor(private readonly brain: BrainService) {}

  @ClientAllowed() @Get('graph')
  graph(@Auth() auth: AuthContext, @Query() q: BrainGraphQueryDto) {
    return this.brain.graph(auth, q);
  }

  /** :id = "<kind>:<chave>" (§2.1), URL-encoded */
  @ClientAllowed() @Get('node/:id')
  node(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.brain.node(auth, id);
  }
}
