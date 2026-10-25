import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Auth, AuthContext, ClientAllowed, Roles } from '../common/auth/auth-context';
import { Paginated } from '../common/http/envelope.interceptor';
import { CreateClientDto, CreateInviteDto, SpendQueryDto, UpdateMemberDto, UpdateWorkspaceDto } from './dto/workspaces.dto';
import { WorkspacesService } from './workspaces.service';

@ApiTags('workspace')
@ApiBearerAuth()
@Controller('workspace')
export class WorkspacesController {
  constructor(private readonly ws: WorkspacesService) {}

  @Get()
  get(@Auth() auth: AuthContext) {
    return this.ws.get(auth);
  }

  @Roles('OWNER', 'ADMIN') @Patch()
  update(@Auth() auth: AuthContext, @Body() dto: UpdateWorkspaceDto) {
    return this.ws.update(auth, dto);
  }

  @Roles('OWNER', 'ADMIN') @HttpCode(200) @Post('onboarding/complete')
  completeOnboarding(@Auth() auth: AuthContext) {
    return this.ws.completeOnboarding(auth);
  }

  @Get('members')
  members(@Auth() auth: AuthContext) {
    return this.ws.members(auth);
  }

  @Roles('OWNER', 'ADMIN') @Post('invites')
  createInvite(@Auth() auth: AuthContext, @Body() dto: CreateInviteDto) {
    return this.ws.createInvite(auth, dto);
  }

  @Roles('OWNER', 'ADMIN') @Delete('invites/:id')
  revokeInvite(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.ws.revokeInvite(auth, id);
  }

  @Roles('OWNER') @Patch('members/:userId')
  updateMember(@Auth() auth: AuthContext, @Param('userId') userId: string, @Body() dto: UpdateMemberDto) {
    return this.ws.updateMember(auth, userId, dto.role);
  }

  @Roles('OWNER') @Delete('members/:userId')
  removeMember(@Auth() auth: AuthContext, @Param('userId') userId: string) {
    return this.ws.removeMember(auth, userId);
  }

  @Get('services')
  services() {
    return this.ws.services();
  }

  /** onboarding-v2 §3.4: estado do tour do usuário NESTE workspace (todos, inclusive CLIENT). */
  @Get('tour')
  tour(@Auth() auth: AuthContext) {
    return this.ws.tour(auth);
  }

  @ClientAllowed() @HttpCode(200) @Post('tour/complete')
  completeTour(@Auth() auth: AuthContext) {
    return this.ws.completeTour(auth);
  }

  @Get('spend')
  spend(@Auth() auth: AuthContext, @Query() q: SpendQueryDto) {
    return this.ws.spend(auth, q.month);
  }
}

/** fase2-agencia.md §3.1-§3.2: tela Clients e New client. Não usa o wid pra listar (todos os workspaces do usuário). */
@ApiTags('workspace')
@ApiBearerAuth()
@Controller('workspaces')
export class ClientsController {
  constructor(private readonly ws: WorkspacesService) {}

  @Get()
  async list(@Auth() auth: AuthContext) {
    const r = await this.ws.listClients(auth);
    return new Paginated(r.items, r.meta);
  }

  @Roles('OWNER', 'ADMIN') @Post()
  create(@Auth() auth: AuthContext, @Body() dto: CreateClientDto) {
    return this.ws.createClient(auth, dto);
  }
}
