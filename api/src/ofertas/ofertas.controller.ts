import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Auth, AuthContext } from '../common/auth/auth-context';
import { Paginated } from '../common/http/envelope.interceptor';
import { DEFAULT_LIMIT, PageQueryDto } from '../common/http/pagination';
import { ExpensiveAction } from '../common/throttle/app-throttler.guard';
import { CreateOfferDto, ExtractOfferDto, ProductImageDto, RereadOfferDto, UpdateOfferDto } from './ofertas.dto';
import { OfertasService } from './ofertas.service';

@ApiTags('offers')
@ApiBearerAuth()
@Controller('offers')
export class OfertasController {
  constructor(private readonly ofertas: OfertasService) {}

  @Get()
  async list(@Auth() auth: AuthContext, @Query() q: PageQueryDto) {
    const r = await this.ofertas.list(auth, q.limit ?? DEFAULT_LIMIT, q.cursor);
    return new Paginated(r.items, { nextCursor: r.nextCursor });
  }

  @ExpensiveAction() @HttpCode(202) @Post('extract')
  extract(@Auth() auth: AuthContext, @Body() dto: ExtractOfferDto) {
    return this.ofertas.extract(auth, dto);
  }

  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.ofertas.get(auth, id);
  }

  @Post()
  create(@Auth() auth: AuthContext, @Body() dto: CreateOfferDto) {
    return this.ofertas.create(auth, dto);
  }

  @Patch(':id')
  update(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: UpdateOfferDto) {
    return this.ofertas.update(auth, id, dto);
  }

  @ExpensiveAction() @HttpCode(202) @Post(':id/reread')
  reread(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: RereadOfferDto) {
    return this.ofertas.reread(auth, id, dto.pageText);
  }

  /** variacao-auto-v1 D4: foto opcional do produto (reserva do SPLIT-LP). */
  @Put(':id/product-image')
  setProductImage(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: ProductImageDto) {
    return this.ofertas.setProductImage(auth, id, dto.uploadId);
  }

  @Delete(':id/product-image')
  removeProductImage(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.ofertas.removeProductImage(auth, id);
  }

  @Delete(':id')
  archive(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.ofertas.archive(auth, id);
  }
}
