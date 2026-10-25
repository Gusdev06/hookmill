import { Module } from '@nestjs/common';
import { OnboardingService } from './onboarding';

/** Cálculo do onboarding (percent/steps/updatedBy) compartilhado por auth, workspaces, ofertas e meta, sem ciclo entre módulos. */
@Module({ providers: [OnboardingService], exports: [OnboardingService] })
export class OnboardingModule {}
