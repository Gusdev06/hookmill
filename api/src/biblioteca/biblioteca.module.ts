import { Module } from '@nestjs/common';
import { BibliotecaController, DownloadController } from './biblioteca.controller';
import { BibliotecaService } from './biblioteca.service';

@Module({ controllers: [BibliotecaController, DownloadController], providers: [BibliotecaService] })
export class BibliotecaModule {}
