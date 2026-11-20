import { describe, expect, test } from 'bun:test';
import { Module } from '../src/core/decorators.ts';
import { createContext } from '../src/factory.ts';
import {
  WEBSOCKET_GATEWAY,
  WebSocketModule,
  createWebSocketGateway,
  createWebSocketModule,
  websocketHandlers,
} from '../src/websocket/index.ts';

/** Minimal stand-in for the socket object `Bun.serve` hands to the handlers. */
function fakeSocket(): WebSocket & { sent: string[] } {
  const sent: string[] = [];
  const socket = {
    sent,
    readyState: WebSocket.OPEN as number,
    send(data: string) {
      sent.push(data);
    },
    close() {},
  };
  return socket as unknown as WebSocket & { sent: string[] };
}

/** Closes the socket so the gateway stops delivering to it. */
function closeSocket(socket: WebSocket & { sent: string[] }): void {
  (socket as unknown as { readyState: number }).readyState = WebSocket.CLOSED;
}

describe('createWebSocketGateway', () => {
  test('a message without a topic reaches every connected socket', () => {
    const gateway = createWebSocketGateway();
    const handlers = websocketHandlers(gateway);
    const first = fakeSocket();
    const second = fakeSocket();

    handlers.open(first);
    handlers.open(second);
    handlers.message(first, 'plain text');

    expect(first.sent).toEqual(['plain text']);
    expect(second.sent).toEqual(['plain text']);
  });

  test('a topic message reaches the sockets subscribed to that topic', () => {
    const gateway = createWebSocketGateway();
    const handlers = websocketHandlers(gateway);
    const first = fakeSocket();
    const second = fakeSocket();

    handlers.open(first);
    handlers.open(second);
    handlers.message(first, JSON.stringify({ topic: 'news', data: 'hello' }));

    expect(first.sent).toEqual(['hello']);
    expect(second.sent).toEqual([]);
  });

  test('the topic handler receives the payload', () => {
    const gateway = createWebSocketGateway();
    const handlers = websocketHandlers(gateway);
    const socket = fakeSocket();
    const seen: string[] = [];

    gateway.on('news', (data) => {
      seen.push(data);
    });
    handlers.open(socket);
    handlers.message(socket, JSON.stringify({ topic: 'news', data: 'payload' }));

    expect(seen).toEqual(['payload']);
  });

  test('a non-string payload is serialized', () => {
    const gateway = createWebSocketGateway();
    const handlers = websocketHandlers(gateway);
    const socket = fakeSocket();
    const seen: string[] = [];

    gateway.on('news', (data) => {
      seen.push(data);
    });
    handlers.open(socket);
    handlers.message(socket, JSON.stringify({ topic: 'news', data: { id: 7 } }));

    expect(seen).toEqual(['{"id":7}']);
  });

  test('a message that is not valid JSON is broadcast as is', () => {
    const gateway = createWebSocketGateway();
    const handlers = websocketHandlers(gateway);
    const socket = fakeSocket();

    handlers.open(socket);
    handlers.message(socket, '{not json');

    expect(socket.sent).toEqual(['{not json']);
  });

  test('publish sends to the subscribers of a topic only', () => {
    const gateway = createWebSocketGateway();
    const handlers = websocketHandlers(gateway);
    const subscriber = fakeSocket();
    const other = fakeSocket();

    handlers.open(subscriber);
    handlers.open(other);
    handlers.message(subscriber, JSON.stringify({ topic: 'news', data: 'x' }));
    subscriber.sent.length = 0;

    gateway.publish('news', 'broadcast');

    expect(subscriber.sent).toEqual(['broadcast']);
    expect(other.sent).toEqual([]);
  });

  test('send delivers to one socket only', () => {
    const gateway = createWebSocketGateway();
    const handlers = websocketHandlers(gateway);
    const target = fakeSocket();
    const other = fakeSocket();

    handlers.open(target);
    handlers.open(other);
    gateway.send(target, 'direct');

    expect(target.sent).toEqual(['direct']);
    expect(other.sent).toEqual([]);
  });

  test('a closed socket is dropped and unsubscribed', () => {
    const gateway = createWebSocketGateway();
    const handlers = websocketHandlers(gateway);
    const socket = fakeSocket();

    handlers.open(socket);
    expect(gateway.clients).toBe(1);

    handlers.close(socket);
    expect(gateway.clients).toBe(0);

    gateway.publish('news', 'after close');
    expect(socket.sent).toEqual([]);
  });

  test('a socket that is not open does not receive a message', () => {
    const gateway = createWebSocketGateway();
    const handlers = websocketHandlers(gateway);
    const socket = fakeSocket();

    handlers.open(socket);
    closeSocket(socket);
    handlers.message(socket, 'closed');

    expect(socket.sent).toEqual([]);
  });

  test('the gateway carries the configured path', () => {
    const gateway = createWebSocketGateway({ path: '/socket' });
    expect(gateway.path).toBe('/socket');
  });
});

describe('WebSocketModule', () => {
  test('resolves the gateway from the container', async () => {
    @Module({ imports: [WebSocketModule] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const gateway = app.container.resolve<ReturnType<typeof createWebSocketGateway>>(
      WEBSOCKET_GATEWAY,
    );
    expect(typeof gateway.on).toBe('function');
    await app.close();
  });

  test('createWebSocketModule applies the options', async () => {
    @Module({ imports: [createWebSocketModule({ path: '/socket' })] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const gateway = app.container.resolve<ReturnType<typeof createWebSocketGateway>>(
      WEBSOCKET_GATEWAY,
    );
    expect(gateway.path).toBe('/socket');
    await app.close();
  });
});
