/**
 * HTTP server built on `Bun.serve`.
 */

import type { Application } from '../application.ts';
import { NotFoundError, UniqueConstraintError } from '../orm/client.ts';
import { createRequestContext } from './context.ts';
import { HttpException } from './contracts.ts';

export interface ServeOptions {
  port?: number;
  hostname?: string;
  /** Signals the server to stop accepting connections. */
  onListen?: (info: { port: number; hostname: string }) => void;
}

export interface RunningServer {
  port: number;
  hostname: string;
  url: string;
  stop(): Promise<void>;
}

export function errorBody(error: unknown): { status: number; body: unknown } {
  if (error instanceof HttpException) {
    return { status: error.status, body: error.response };
  }
  if (error instanceof NotFoundError) {
    return { status: 404, body: { statusCode: 404, message: error.message } };
  }
  if (error instanceof UniqueConstraintError) {
    return { status: 409, body: { statusCode: 409, message: error.message } };
  }
  return {
    status: 500,
    body: { statusCode: 500, message: 'Internal Server Error' },
  };
}

async function parseBody(request: Request, limit: number): Promise<unknown> {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'DELETE') return undefined;

  const contentType = request.headers.get('content-type') ?? '';
  const raw = await request.text();
  if (raw.length === 0) return undefined;
  if (raw.length > limit) {
    throw new HttpException(413, { statusCode: 413, message: 'Payload Too Large' });
  }

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      throw new HttpException(400, { statusCode: 400, message: 'Invalid JSON body' });
    }
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  if (contentType.includes('text/')) {
    return raw;
  }
  return raw;
}

export function createFetchHandler(app: Application): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    let body: unknown;
    try {
      body = await parseBody(request, app.options.bodyLimit);
    } catch (error) {
      const { status, body: payload } = errorBody(error);
      return Response.json(payload, { status });
    }

    const context = createRequestContext(request, body);
    const match = app.router.find(context.method, context.path);

    if (!match) {
      const status = app.router.pathExists(context.path) ? 405 : 404;
      return Response.json(
        { statusCode: status, message: status === 405 ? 'Method Not Allowed' : 'Not Found' },
        { status },
      );
    }

    context.params = match.params;

    try {
      const result = await app.execute(match.route, context);
      const headers = new Headers(result.headers);
      if (result.body === undefined || result.body === null) {
        return new Response(null, { status: result.status, headers });
      }
      if (result.body instanceof Response) return result.body;
      if (result.body instanceof Blob || result.body instanceof ArrayBuffer) {
        return new Response(result.body, { status: result.status, headers });
      }
      headers.set('content-type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify(result.body), { status: result.status, headers });
    } catch (error) {
      const { status, body: payload } = errorBody(error);
      return Response.json(payload, { status });
    }
  };
}

export async function listen(app: Application, options: ServeOptions = {}): Promise<RunningServer> {
  const handler = createFetchHandler(app);
  const server = Bun.serve({
    port: options.port ?? Number(process.env.PORT ?? 3000),
    hostname: options.hostname ?? process.env.HOST ?? '0.0.0.0',
    fetch: handler,
    error(error: Error) {
      console.error('[best] unhandled server error:', error);
      return Response.json(
        { statusCode: 500, message: 'Internal Server Error' },
        { status: 500 },
      );
    },
  });

  const port = server.port ?? 0;
  const hostname = server.hostname ?? '0.0.0.0';
  options.onListen?.({ port, hostname });

  return {
    port,
    hostname,
    url: `http://${hostname}:${port}`,
    async stop() {
      await server.stop(true);
      await app.close();
    },
  };
}
