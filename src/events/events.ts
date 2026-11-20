/**
 * Typed event emitter.
 *
 * `emit` awaits every handler. A handler that throws does not stop the
 * others: the errors are collected and reported as an `AggregateError`, so a
 * failure is never swallowed silently.
 */

export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;

export interface EventEmitter {
  on<T = unknown>(event: string, handler: EventHandler<T>): () => void;
  once<T = unknown>(event: string, handler: EventHandler<T>): () => void;
  off<T = unknown>(event: string, handler: EventHandler<T>): void;
  emit<T = unknown>(event: string, payload?: T): Promise<void>;
  listenerCount(event: string): number;
}

export function createEventEmitter(): EventEmitter {
  const listeners = new Map<string, EventHandler<any>[]>();

  const remove = (event: string, handler: EventHandler<any>): void => {
    const list = listeners.get(event);
    if (!list) return;
    const index = list.indexOf(handler);
    if (index !== -1) list.splice(index, 1);
    if (list.length === 0) listeners.delete(event);
  };

  const emitter: EventEmitter = {
    on<T = unknown>(event: string, handler: EventHandler<T>): () => void {
      const list = listeners.get(event) ?? [];
      list.push(handler as EventHandler<any>);
      listeners.set(event, list);
      return () => remove(event, handler as EventHandler<any>);
    },

    once<T = unknown>(event: string, handler: EventHandler<T>): () => void {
      const wrapper: EventHandler<any> = async (payload: unknown) => {
        remove(event, wrapper);
        await handler(payload as T);
      };
      const list = listeners.get(event) ?? [];
      list.push(wrapper);
      listeners.set(event, list);
      return () => remove(event, wrapper);
    },

    off<T = unknown>(event: string, handler: EventHandler<T>): void {
      remove(event, handler as EventHandler<any>);
    },

    async emit<T = unknown>(event: string, payload?: T): Promise<void> {
      const list = listeners.get(event);
      if (!list || list.length === 0) return;

      // Snapshot: handlers registered during the emit do not join this round.
      const snapshot = [...list];
      const errors: unknown[] = [];
      for (const handler of snapshot) {
        try {
          await handler(payload);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, `Event "${event}" had ${errors.length} failing handlers`);
      }
    },

    listenerCount(event: string): number {
      return listeners.get(event)?.length ?? 0;
    },
  };

  return emitter;
}
