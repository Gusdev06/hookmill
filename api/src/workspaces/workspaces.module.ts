import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClientsController, WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

@Module({ imports: [AuthModule], controllers: [WorkspacesController, ClientsController], providers: [WorkspacesService], exports: [WorkspacesService] })
export class WorkspacesModule {}
