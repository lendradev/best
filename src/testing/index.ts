/**
 * Testing utilities — `createTestingModule` equivalent.
 */

import { Application, type AppOptions } from '../application.ts';
import { Container, type ProviderOptions } from '../core/container.ts';
import { METADATA_KEY, defineMetadata } from '../core/metadata.ts';

export interface TestingModuleOptions extends AppOptions {
  providers?: any[];
  controllers?: any[];
  imports?: any[];
}

export interface TestingModule {
  app: Application;
  container: Container;
  get<T = unknown>(token: any): T;
  close(): Promise<void>;
}

/**
 * Builds an application instance without starting a server, for unit tests.
 *
 *   const module = await createTestingModule({ providers: [UserService] });
 *   const service = module.get(UserService);
 */
export async function createTestingModule(options: TestingModuleOptions = {}): Promise<TestingModule> {
  const providers = options.providers ?? [];
  const controllers = options.controllers ?? [];

  const TestModule = class {};
  const metadata = {
    imports: options.imports ?? [],
    controllers,
    providers,
    exports: providers,
  };

  Object.defineProperty(TestModule, 'name', { value: 'TestModule' });
  defineMetadata(METADATA_KEY.MODULE, metadata, TestModule);

  const app = new Application([TestModule], options);
  await app.init();

  return {
    app,
    container: app.container,
    get<T = unknown>(token: any): T {
      return app.container.resolve(token) as T;
    },
    async close() {
      await app.close();
    },
  };
}

export { Container };
export type { ProviderOptions };
