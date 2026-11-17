/**
 * Nest-like factory: `createApp` for HTTP servers, `createContext` for
 * headless (non-HTTP) applications.
 */

import { Application, type AppOptions } from './application.ts';
import { listen, type RunningServer, type ServeOptions } from './http/server.ts';

export interface CreateAppResult {
  app: Application;
  listen(options?: ServeOptions): Promise<RunningServer>;
}

export function createApp(modules: any[] | any, options: AppOptions = {}): CreateAppResult {
  const list = Array.isArray(modules) ? modules : [modules];
  const app = new Application(list, options);
  return {
    app,
    async listen(serveOptions: ServeOptions = {}) {
      await app.init();
      return listen(app, serveOptions);
    },
  };
}

/** Creates an application without starting an HTTP server. */
export async function createContext(modules: any[] | any, options: AppOptions = {}): Promise<Application> {
  const list = Array.isArray(modules) ? modules : [modules];
  const app = new Application(list, options);
  await app.init();
  return app;
}

export { Application };
export type { AppOptions, RunningServer, ServeOptions };
