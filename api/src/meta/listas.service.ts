// meta-templates-v2 §4 (B2, 03/11): listas da conta pro editor de template — contas do Instagram, públicos personalizados
// e idiomas. Serviço fino: conta e Página selecionadas (422 META_NOT_CONNECTED / META_SELECTION_MISSING) e a chamada à
// porta MetaService via `viaPorta` (MetaError → erro HTTP do §3.4; token inválido marca a conexão). Cache é da porta.
import { Inject, Injectable } from '@nestjs/common';
import type { MetaCustomAudiencesResponse, MetaInstagramAccountsResponse, MetaLocalesResponse } from '@maquina/contratos';
import type { AuthContext } from '../common/auth/auth-context';
import { AppConfig } from '../config/app-config';
import { META_SERVICE, type MetaService } from '../integracoes';
import { PrismaService } from '../prisma/prisma.service';
import { assertSelected, metaAuthOf, viaPorta } from './comum';
import { MetaConexaoService } from './conexao.service';

@Injectable()
export class MetaListasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly conexao: MetaConexaoService,
    @Inject(META_SERVICE) private readonly meta: MetaService,
  ) {}

  private async selected(auth: AuthContext) {
    const c = assertSelected(await this.conexao.usable(auth.workspaceId));
    return { c, metaAuth: metaAuthOf(c, this.config) };
  }

  /** GET /meta/instagram-accounts: PAGE primeiro, depois username (ordem da porta); sem cache. */
  async instagramAccounts(auth: AuthContext): Promise<MetaInstagramAccountsResponse> {
    const { c, metaAuth } = await this.selected(auth);
    return viaPorta(this.prisma, c, () => this.meta.listInstagramAccounts(metaAuth, { adAccountId: c.adAccountId, pageId: c.pageId }));
  }

  /** GET /meta/custom-audiences: até 500, mais recentes primeiro (cache de 5 min por conta na porta). */
  async customAudiences(auth: AuthContext): Promise<MetaCustomAudiencesResponse> {
    const { c, metaAuth } = await this.selected(auth);
    return viaPorta(this.prisma, c, () => this.meta.listCustomAudiences(metaAuth, { adAccountId: c.adAccountId }));
  }

  /** GET /meta/locales: lista inteira em inglês, `name` asc (cache de 24 h na porta). */
  async locales(auth: AuthContext): Promise<MetaLocalesResponse> {
    const { c, metaAuth } = await this.selected(auth);
    return viaPorta(this.prisma, c, () => this.meta.listLocales(metaAuth));
  }
}
