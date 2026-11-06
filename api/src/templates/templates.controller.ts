// templates-creditos-v1 §7 (rota `/ad-templates`: `/templates` já é o registro de templates Remotion do wizard): galeria, fit por anúncio, usar template, histórico de usos e o admin do catálogo.
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Auth, AuthContext, Roles } from '../common/auth/auth-context';
import { ExpensiveAction } from '../common/throttle/app-throttler.guard';
import { CreditosService } from '../creditos/creditos.service';
import { PageQueryDto } from '../creditos/creditos.controller';
import { TemplateExampleCompleteDto, TemplateExampleUploadDto, TemplateFitsDto, TemplateSourceDto, UpdateTemplateDto, UseTemplateDto, UseTemplatesDto } from './templates.dto';
import { TemplatesService } from './templates.service';

@ApiTags('ad-templates')
@ApiBearerAuth()
@Controller('ad-templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService, private readonly creditos: CreditosService) {}

  @Roles('OWNER', 'ADMIN', 'MEMBER') @Get()
  list(@Auth() auth: AuthContext, @Query() q: TemplateSourceDto) {
    return this.templates.list(auth, q);
  }

  @Roles('OWNER', 'ADMIN', 'MEMBER') @Get('runs')
  runs(@Auth() auth: AuthContext, @Query() q: PageQueryDto) {
    return this.creditos.runs(auth, q.cursor, q.limit);
  }

  @Roles('OWNER', 'ADMIN', 'MEMBER') @HttpCode(200) @Post('fits')
  fits(@Auth() auth: AuthContext, @Body() dto: TemplateFitsDto) {
    return this.templates.fits(auth, { slug: dto.slug, slugs: dto.slugs }, dto.sources);
  }

  /** templates-multi-v1 §3.1: vários templates marcados num lote só (2-12, soma dos créditos sem teto). */
  @Roles('OWNER', 'ADMIN', 'MEMBER') @ExpensiveAction() @HttpCode(202) @Post('use')
  useMany(@Auth() auth: AuthContext, @Body() dto: UseTemplatesDto) {
    return this.templates.useMany(auth, dto);
  }

  @Roles('OWNER', 'ADMIN', 'MEMBER') @Get(':slug')
  detail(@Auth() auth: AuthContext, @Param('slug') slug: string, @Query() q: TemplateSourceDto) {
    return this.templates.detail(auth, slug, q);
  }

  @Roles('OWNER', 'ADMIN', 'MEMBER') @ExpensiveAction() @HttpCode(202) @Post(':slug/use')
  use(@Auth() auth: AuthContext, @Param('slug') slug: string, @Body() dto: UseTemplateDto) {
    return this.templates.use(auth, slug, dto);
  }
}

/** Só usuário INTERNAL que é OWNER do workspace ativo (403 no resto). */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/ad-templates')
export class AdminTemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Roles('OWNER') @Get()
  list(@Auth() auth: AuthContext) {
    return this.templates.adminList(auth);
  }

  @Roles('OWNER') @Patch(':slug')
  update(@Auth() auth: AuthContext, @Param('slug') slug: string, @Body() dto: UpdateTemplateDto) {
    return this.templates.adminUpdate(auth, slug, dto);
  }

  @Roles('OWNER') @HttpCode(200) @Post(':slug/example')
  exampleUpload(@Auth() auth: AuthContext, @Param('slug') slug: string, @Body() dto: TemplateExampleUploadDto) {
    return this.templates.adminExampleUpload(auth, slug, dto);
  }

  @Roles('OWNER') @HttpCode(200) @Post(':slug/example/complete')
  exampleComplete(@Auth() auth: AuthContext, @Param('slug') slug: string, @Body() dto: TemplateExampleCompleteDto) {
    return this.templates.adminExampleComplete(auth, slug, dto.key);
  }
}
