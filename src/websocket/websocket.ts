/**
 * WebSocket gateway.
 *
 * The gateway never starts a server: `Bun.serve` is owned by the caller, so
 * the gateway exposes the three handlers that `Bun.serve` expects and the
 * `websocketHandlers` helper bundles them into a ready-to-use object.
 */

export interface WebSocketGatewayOptions {
  /** Path the upgrade is accepted on. Default '/ws'. */
  path?: string;
}

export type MessageHandler = (data: string, socket: WebSocket) => void | Promise<void>;

export interface WebSocketGateway {
  /** Path the upgrade is accepted on. */
  readonly path: string;
  /** Registers a message handler for a topic. */
  on(topic: string, handler: MessageHandler): void;
  /** Sends a message to every socket subscribed to a topic. */
  publish(topic: string, data: string): void;
  /** Sends a message to one socket. */
  send(socket: WebSocket, data: string): void;
  /** Number of connected sockets. */
  readonly clients: number;
}

/** The handler shape `Bun.serve` expects for its `websocket` option. */
export interface WebSocketHandlers {
  open(socket: WebSocket): void;
  message(socket: WebSocket, message: string | Buffer): void;
  close(socket: WebSocket): void;
}

interface SocketState {
  topics: Set<string>;
}

function parseTopic(data: string): { topic: string; payload: string } | null {
  const trimmed = data.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const topic = record.topic;
    if (typeof topic !== 'string' || topic.length === 0) return null;
    const payload = record.data;
    return {
      topic,
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload ?? null),
    };
  } catch {
    return null;
  }
}

/**
 * Creates a gateway. The returned object also carries `handleOpen`,
 * `handleMessage` and `handleClose`, which are the functions to pass to
 * `Bun.serve({ websocket: { ... } })`.
 */
export function createWebSocketGateway(options: WebSocketGatewayOptions = {}): WebSocketGateway {
  const path = options.path ?? '/ws';
  const handlers = new Map<string, MessageHandler>();
  const sockets = new Map<WebSocket, SocketState>();
  const subscribers = new Map<string, Set<WebSocket>>();

  const stateOf = (socket: WebSocket): SocketState => {
    let state = sockets.get(socket);
    if (!state) {
      state = { topics: new Set() };
      sockets.set(socket, state);
    }
    return state;
  };

  const subscribe = (socket: WebSocket, topic: string): void => {
    const state = stateOf(socket);
    if (state.topics.has(topic)) return;
    state.topics.add(topic);
    let group = subscribers.get(topic);
    if (!group) {
      group = new Set();
      subscribers.set(topic, group);
    }
    group.add(socket);
  };

  const unsubscribe = (socket: WebSocket, topic: string): void => {
    const state = sockets.get(socket);
    if (state) state.topics.delete(topic);
    const group = subscribers.get(topic);
    if (!group) return;
    group.delete(socket);
    if (group.size === 0) subscribers.delete(topic);
  };

  const broadcast = (topic: string, data: string): void => {
    const group = subscribers.get(topic);
    if (!group) return;
    for (const socket of group) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      socket.send(data);
    }
  };

  const gateway: WebSocketGateway = {
    path,
    on(topic: string, handler: MessageHandler): void {
      handlers.set(topic, handler);
    },
    publish(topic: string, data: string): void {
      broadcast(topic, data);
    },
    send(socket: WebSocket, data: string): void {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(data);
    },
    get clients(): number {
      return sockets.size;
    },
  };

  const handleOpen = (socket: WebSocket): void => {
    stateOf(socket);
  };

  const handleMessage = (socket: WebSocket, message: string | Buffer): void => {
    const data = typeof message === 'string' ? message : message.toString();
    const parsed = parseTopic(data);

    if (!parsed) {
      // A message without a topic goes to every connected socket.
      for (const socket of sockets.keys()) {
        if (socket.readyState === WebSocket.OPEN) socket.send(data);
      }
      return;
    }

    subscribe(socket, parsed.topic);
    const handler = handlers.get(parsed.topic);
    if (handler) {
      const result = handler(parsed.payload, socket);
      if (result instanceof Promise) result.catch(() => {});
    }
    broadcast(parsed.topic, parsed.payload);
  };

  const handleClose = (socket: WebSocket): void => {
    const state = sockets.get(socket);
    if (state) {
      for (const topic of state.topics) unsubscribe(socket, topic);
    }
    sockets.delete(socket);
  };

  return Object.assign(gateway, {
    handleOpen,
    handleMessage,
    handleClose,
  });
}

/**
 * Bundles the gateway handlers into the object `Bun.serve` expects.
 *
 *   const gateway = createWebSocketGateway();
 *   Bun.serve({ fetch, websocket: websocketHandlers(gateway) });
 */
export function websocketHandlers(gateway: WebSocketGateway): WebSocketHandlers {
  const source = gateway as WebSocketGateway & {
    handleOpen(socket: WebSocket): void;
    handleMessage(socket: WebSocket, message: string | Buffer): void;
    handleClose(socket: WebSocket): void;
  };
  return {
    open: (socket) => source.handleOpen(socket),
    message: (socket, message) => source.handleMessage(socket, message),
    close: (socket) => source.handleClose(socket),
  };
}
