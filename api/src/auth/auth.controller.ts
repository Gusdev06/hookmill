import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Auth, AuthContext, ClientAllowed, Public } from '../common/auth/auth-context';
import { LoginThrottle } from '../common/throttle/app-throttler.guard';
import { AuthService } from './auth.service';
import { AcceptInviteDto, LoginDto, RefreshDto, SignupDto, SwitchWorkspaceDto, UpdateMeDto } from './dto/auth.dto';

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public() @LoginThrottle() @HttpCode(200) @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  /** Cadastro self-serve (fase2-cadastro.md §3): conta + 1º cliente (OWNER, SETUP) e a mesma sessão do login. */
  @Public() @LoginThrottle() @HttpCode(201) @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto);
  }

  @Public() @HttpCode(200) @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @ClientAllowed() @HttpCode(200) @Post('logout')
  logout(@Auth() auth: AuthContext, @Body() dto: RefreshDto) {
    return this.auth.logout(auth, dto.refreshToken);
  }

  @Get('me')
  me(@Auth() auth: AuthContext) {
    return this.auth.me(auth);
  }

  @ClientAllowed() @Patch('me')
  updateMe(@Auth() auth: AuthContext, @Body() dto: UpdateMeDto) {
    return this.auth.updateMe(auth, dto);
  }

  @ClientAllowed() @HttpCode(200) @Post('switch-workspace')
  switchWorkspace(@Auth() auth: AuthContext, @Body() dto: SwitchWorkspaceDto) {
    return this.auth.switchWorkspace(auth, dto.workspaceId);
  }

  @Public() @Get('invites/:token')
  getInvite(@Param('token') token: string) {
    return this.auth.getInvite(token);
  }

  @Public() @LoginThrottle() @HttpCode(200) @Post('invites/:token/accept')
  acceptInvite(@Param('token') token: string, @Body() dto: AcceptInviteDto, @Auth() auth?: AuthContext) {
    return this.auth.acceptInvite(token, dto, auth);
  }
}
