import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { UploadsModule } from '../uploads/uploads.module';
import { OnboardingModule } from '../workspaces/onboarding.module';
import { OfertasController } from './ofertas.controller';
import { OfertasService } from './ofertas.service';

@Module({ imports: [JobsModule, UploadsModule, OnboardingModule], controllers: [OfertasController], providers: [OfertasService], exports: [OfertasService] })
export class OfertasModule {}
