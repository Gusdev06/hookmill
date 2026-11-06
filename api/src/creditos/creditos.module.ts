import { Global, Module } from '@nestjs/common';
import { AdminCreditosController, CreditosController } from './creditos.controller';
import { CreditosService } from './creditos.service';

/** Global (templates-creditos-v1): o start do lote reserva, o Retry da peça reserva de novo e a vista mostra o saldo. */
@Global()
@Module({ controllers: [CreditosController, AdminCreditosController], providers: [CreditosService], exports: [CreditosService] })
export class CreditosModule {}
