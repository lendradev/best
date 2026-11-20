/**
 * WebSocket DI wiring.
 */

import { Module } from '../core/decorators.ts';
import { METADATA_KEY, defineMetadata } from '../core/metadata.ts';
import { createWebSocketGateway, type WebSocketGatewayOptions } from './websocket.ts';

export const WEBSOCKET_GATEWAY = Symbol('best:websocket-gateway');

/**
 * Registers the WebSocket gateway as a singleton.
 *
 *   @Module({ imports: [WebSocketModule] })
 */
@Module({
  providers: [
    {
      provide: WEBSOCKET_GATEWAY,
      useFactory: () => createWebSocketGateway(),
    },
  ],
  exports: [WEBSOCKET_GATEWAY],
})
export class WebSocketModule {}

/**
 * Builds a WebSocket module with a custom configuration.
 *
 *   @Module({ imports: [createWebSocketModule({ path: '/socket' })] })
 */
export function createWebSocketModule(
  options: WebSocketGatewayOptions,
): typeof WebSocketModule {
  class ConfiguredWebSocketModule {}
  Object.defineProperty(ConfiguredWebSocketModule, 'name', { value: 'WebSocketModule' });
  defineMetadata(
    METADATA_KEY.MODULE,
    {
      imports: [],
      controllers: [],
      providers: [
        {
          provide: WEBSOCKET_GATEWAY,
          useFactory: () => createWebSocketGateway(options),
        },
      ],
      exports: [WEBSOCKET_GATEWAY],
    },
    ConfiguredWebSocketModule,
  );
  return ConfiguredWebSocketModule;
}
