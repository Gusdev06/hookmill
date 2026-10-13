import { Global, Module } from '@nestjs/common';
import { KeyedMutex } from '../common/util/mutex';
import { CreativeNotifier } from './notifier';
import { CreativeStateMachine } from './state-machine';
import { CreativeViews } from './views';

/** Peças do criativo usadas por todos os módulos de domínio (máquina de estados, views, trava por criativo). */
@Global()
@Module({
  providers: [CreativeStateMachine, CreativeViews, CreativeNotifier, { provide: KeyedMutex, useValue: new KeyedMutex() }],
  exports: [CreativeStateMachine, CreativeViews, KeyedMutex],
})
export class CriativosCoreModule {}
