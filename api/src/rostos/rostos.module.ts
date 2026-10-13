import { Module } from '@nestjs/common';
import { RostosController } from './rostos.controller';
import { RostosService } from './rostos.service';

@Module({ controllers: [RostosController], providers: [RostosService], exports: [RostosService] })
export class RostosModule {}
