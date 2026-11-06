import { Module } from '@nestjs/common';
import { BrainModule } from '../brain/brain.module';
import { JobsModule } from '../jobs/jobs.module';
import { UploadsModule } from '../uploads/uploads.module';
import { OnboardingModule } from '../workspaces/onboarding.module';
import { ResearchModule } from '../research/research.module';
import { OfertasController } from './ofertas.controller';
import { OfertasService } from './ofertas.service';

@Module({ imports: [JobsModule, UploadsModule, OnboardingModule, BrainModule, ResearchModule], controllers: [OfertasController], providers: [OfertasService], exports: [OfertasService] })
export class OfertasModule {}
