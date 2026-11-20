/**
 * Event emitter DI wiring.
 */

import { Module } from '../core/decorators.ts';
import { createEventEmitter } from './events.ts';

export const EVENT_EMITTER = Symbol('best:event-emitter');

/**
 * Registers the event emitter as a singleton.
 *
 *   @Module({ imports: [EventsModule] })
 */
@Module({
  providers: [
    {
      provide: EVENT_EMITTER,
      useFactory: () => createEventEmitter(),
    },
  ],
  exports: [EVENT_EMITTER],
})
export class EventsModule {}
