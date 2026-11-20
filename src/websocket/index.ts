/**
 * WebSocket entry point.
 */
export { createWebSocketGateway, websocketHandlers } from './websocket.ts';
export type {
  MessageHandler,
  WebSocketGateway,
  WebSocketGatewayOptions,
  WebSocketHandlers,
} from './websocket.ts';
export {
  WEBSOCKET_GATEWAY,
  WebSocketModule,
  createWebSocketModule,
} from './websocket.module.ts';
