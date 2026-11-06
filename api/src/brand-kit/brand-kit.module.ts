import { Module } from '@nestjs/common';
import { BrainModule } from '../brain/brain.module';
import { MedicaoModule } from '../medicao';
import { UploadsModule } from '../uploads/uploads.module';
import { BrandKitController } from './brand-kit.controller';
import { BrandKitService } from './brand-kit.service';

/** kit-marca-v1: kit da marca do cliente. Prisma, AppConfig e StorageService vêm de módulos globais. */
@Module({ imports: [UploadsModule, MedicaoModule, BrainModule], controllers: [BrandKitController], providers: [BrandKitService], exports: [BrandKitService] })
export class BrandKitModule {}
