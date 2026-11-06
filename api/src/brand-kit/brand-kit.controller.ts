import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Auth, AuthContext, ClientAllowed } from '../common/auth/auth-context';
import { CreateBrandAssetDto, UpdateBrandAssetDto } from './brand-kit.dto';
import { BrandKitService } from './brand-kit.service';

/** kit-marca-v1 §3. Papéis iguais aos da oferta: CLIENT só lê (o AuthGuard nega o resto com 403). */
@ApiTags('brand-kit')
@ApiBearerAuth()
@Controller('brand-kit')
export class BrandKitController {
  constructor(private readonly kit: BrandKitService) {}

  @ClientAllowed() @Get()
  get(@Auth() auth: AuthContext) {
    return this.kit.get(auth);
  }

  @HttpCode(201) @Post('assets')
  create(@Auth() auth: AuthContext, @Body() dto: CreateBrandAssetDto) {
    return this.kit.create(auth, dto);
  }

  @Patch('assets/:id')
  update(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: UpdateBrandAssetDto) {
    return this.kit.update(auth, id, dto);
  }

  @Delete('assets/:id')
  remove(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.kit.remove(auth, id);
  }
}
