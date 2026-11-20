/**
 * OpenAPI DI wiring.
 */

import { Module } from '../core/decorators.ts';
import { METADATA_KEY, defineMetadata } from '../core/metadata.ts';
import type { RouteDefinition } from '../http/context.ts';
import { createOpenApiDocument, type OpenApiDocument } from './openapi.ts';

export const OPENAPI_DOCUMENT = Symbol('best:openapi-document');

export interface OpenApiModuleOptions {
  /** Title of the API. */
  title: string;
  /** Version of the API. */
  version: string;
  /** Description of the API. */
  description?: string;
  /** The OpenAPI version. Default `'3.1.0'`. */
  openapiVersion?: string;
  /**
   * The routes to describe. A function is read when the document is
   * resolved, so it can return the routes of an application that was
   * created after the module was declared.
   */
  routes: RouteDefinition[] | (() => RouteDefinition[]);
  /** Extra schemas merged into `components.schemas`. */
  schemas?: Record<string, Record<string, unknown>>;
}

function documentFactory(options: OpenApiModuleOptions): () => OpenApiDocument {
  return () =>
    createOpenApiDocument({
      title: options.title,
      version: options.version,
      description: options.description,
      openapiVersion: options.openapiVersion,
      routes: typeof options.routes === 'function' ? options.routes() : options.routes,
      schemas: options.schemas,
    });
}

/**
 * Builds an OpenAPI module.
 *
 *   const app = await createContext([AppModule]);
 *   const document = app.container.resolve<OpenApiDocument>(OPENAPI_DOCUMENT);
 *
 * The routes can be read from the application, so the document describes the
 * routes the application actually serves:
 *
 *   createOpenApiModule({
 *     title: 'My API',
 *     version: '1.0.0',
 *     routes: () => app.router.routes,
 *   })
 */
export function createOpenApiModule(options: OpenApiModuleOptions): typeof OpenApiModule {
  class ConfiguredOpenApiModule {}
  Object.defineProperty(ConfiguredOpenApiModule, 'name', { value: 'OpenApiModule' });
  defineMetadata(
    METADATA_KEY.MODULE,
    {
      imports: [],
      controllers: [],
      providers: [
        {
          provide: OPENAPI_DOCUMENT,
          useFactory: documentFactory(options),
        },
      ],
      exports: [OPENAPI_DOCUMENT],
    },
    ConfiguredOpenApiModule,
  );
  return ConfiguredOpenApiModule;
}

/**
 * Registers an OpenAPI document as a singleton.
 *
 * The document of the default module has no routes, so it is only useful once
 * the routes are passed to `createOpenApiModule`.
 */
@Module({
  providers: [
    {
      provide: OPENAPI_DOCUMENT,
      useFactory: documentFactory({ title: 'API', version: '1.0.0', routes: [] }),
    },
  ],
  exports: [OPENAPI_DOCUMENT],
})
export class OpenApiModule {}
