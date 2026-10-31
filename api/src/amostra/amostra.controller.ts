// PATCH /admin/users/:id/access (amostra-gratis-v1 §5, P2): liberação manual até existir checkout. Só INTERNAL + OWNER.
import { Body, Controller, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AccountAccess, UpdateAccessBody } from '@maquina/contratos';
import { IsIn } from 'class-validator';
import { Auth, AuthContext, Roles } from '../common/auth/auth-context';
import { AmostraService } from './amostra.service';

export class UpdateAccessDto implements UpdateAccessBody {
  @IsIn(['SAMPLE', 'PAID', 'INTERNAL']) access: AccountAccess;
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/users')
export class AmostraAdminController {
  constructor(private readonly amostra: AmostraService) {}

  @Roles('OWNER') @Patch(':id/access')
  updateAccess(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: UpdateAccessDto) {
    return this.amostra.updateAccess(auth, id, dto.access);
  }
}
