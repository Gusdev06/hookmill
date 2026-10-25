import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OnboardingModule } from './onboarding.module';
import { ClientsController, WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

@Module({
  imports: [AuthModule, OnboardingModule],
  controllers: [WorkspacesController, ClientsController],
  providers: [WorkspacesService],
  exports: [WorkspacesService, OnboardingModule],
})
export class WorkspacesModule {}
