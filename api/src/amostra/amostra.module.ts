import { Global, Module } from '@nestjs/common';
import { AmostraAdminController } from './amostra.controller';
import { AmostraService } from './amostra.service';

/** Global: as travas da amostra são conferidas em iterate, peças, zip, editor, Meta, Library e arquivos. */
@Global()
@Module({ controllers: [AmostraAdminController], providers: [AmostraService], exports: [AmostraService] })
export class AmostraModule {}
