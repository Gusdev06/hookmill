import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BrainModule } from '../brain/brain.module';
import { OnboardingModule } from './onboarding.module';
import { ResearchModule } from '../research/research.module';
import { ProductEventsService } from './eventos-produto.service';
import { ClientsController, ProductEventsController, WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

@Module({
  imports: [AuthModule, OnboardingModule, BrainModule, ResearchModule],
  controllers: [WorkspacesController, ClientsController, ProductEventsController],
  providers: [WorkspacesService, ProductEventsService],
  exports: [WorkspacesService, OnboardingModule],
})
export class WorkspacesModule {}
