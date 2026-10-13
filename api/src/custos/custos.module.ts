import { Global, Module } from '@nestjs/common';
import { CustosService } from './custos.service';

@Global()
@Module({ providers: [CustosService], exports: [CustosService] })
export class CustosModule {}
