import { Module } from '@nestjs/common';
import { OnboardingModule } from '../workspaces/onboarding.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({ imports: [OnboardingModule], controllers: [AuthController], providers: [AuthService], exports: [AuthService] })
export class AuthModule {}
