import { describe, expect, test } from 'bun:test';
import { Module } from '../src/core/decorators.ts';
import { createContext } from '../src/factory.ts';
import { Controller, Get, Post } from '../src/http/route-decorators.ts';
import type { RouteDefinition } from '../src/http/context.ts';
import {
  OPENAPI_DOCUMENT,
  OpenApiModule,
  createOpenApiDocument,
  createOpenApiModule,
} from '../src/openapi/index.ts';

@Controller('/users')
class UserController {
  @Get('/:id')
  findOne() {
    return { id: '1' };
  }

  @Post('/')
  create() {
    return { id: '1' };
  }
}

@Controller('/health')
class HealthController {
  @Get('/')
  check() {
    return { status: 'ok' };
  }
}

describe('createOpenApiDocument', () => {
  test('the document carries the openapi version and the info', () => {
    const document = createOpenApiDocument({
      title: 'My API',
      version: '2.1.0',
      routes: [],
    });
    expect(document.openapi).toBe('3.1.0');
    expect(document.info.title).toBe('My API');
    expect(document.info.version).toBe('2.1.0');
  });

  test('the openapi version can be overridden', () => {
    const document = createOpenApiDocument({
      title: 'My API',
      version: '1.0.0',
      openapiVersion: '3.0.3',
      routes: [],
    });
    expect(document.openapi).toBe('3.0.3');
  });

  test('the document has one entry per route', async () => {
    @Module({ controllers: [UserController, HealthController] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const document = createOpenApiDocument({
      title: 'My API',
      version: '1.0.0',
      routes: app.router.routes,
    });

    expect(Object.keys(document.paths)).toContain('/users/{id}');
    expect(Object.keys(document.paths)).toContain('/users');
    expect(Object.keys(document.paths)).toContain('/health');
    expect(document.paths['/users/{id}']?.get).toBeDefined();
    expect(document.paths['/users']?.post).toBeDefined();
    await app.close();
  });

  test('a path parameter becomes a required path parameter', async () => {
    @Module({ controllers: [UserController] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const document = createOpenApiDocument({
      title: 'My API',
      version: '1.0.0',
      routes: app.router.routes,
    });
    const parameters = document.paths['/users/{id}']?.get?.parameters ?? [];
    expect(parameters[0]?.name).toBe('id');
    expect(parameters[0]?.in).toBe('path');
    expect(parameters[0]?.required).toBe(true);
    await app.close();
  });

  test('every operation carries a response', async () => {
    @Module({ controllers: [UserController] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const document = createOpenApiDocument({
      title: 'My API',
      version: '1.0.0',
      routes: app.router.routes,
    });
    expect(document.paths['/users/{id}']?.get?.responses['200']).toBeDefined();
    await app.close();
  });

  test('the operation id is the handler name', async () => {
    @Module({ controllers: [UserController] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const document = createOpenApiDocument({
      title: 'My API',
      version: '1.0.0',
      routes: app.router.routes,
    });
    expect(document.paths['/users/{id}']?.get?.operationId).toBe('findOne');
    await app.close();
  });

  test('the extra schemas land in the components', () => {
    const document = createOpenApiDocument({
      title: 'My API',
      version: '1.0.0',
      routes: [],
      schemas: { User: { type: 'object' } },
    });
    expect(document.components.schemas.User).toEqual({ type: 'object' });
  });

  test('the document is valid json', () => {
    const document = createOpenApiDocument({
      title: 'My API',
      version: '1.0.0',
      routes: [],
    });
    expect(JSON.parse(JSON.stringify(document)).info.title).toBe('My API');
  });
});

describe('OpenApiModule', () => {
  test('resolves the document from the container', async () => {
    @Module({ imports: [OpenApiModule] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const document = app.container.resolve<ReturnType<typeof createOpenApiDocument>>(
      OPENAPI_DOCUMENT,
    );
    expect(document.openapi).toBe('3.1.0');
    await app.close();
  });

  test('createOpenApiModule reads the routes of an application', async () => {
    let routes: RouteDefinition[] = [];

    @Module({ controllers: [UserController] })
    class AppModule {}

    const app = await createContext([AppModule]);
    routes = app.router.routes;

    @Module({ imports: [createOpenApiModule({ title: 'My API', version: '1.0.0', routes })] })
    class DocumentModule {}

    const documentApp = await createContext([DocumentModule]);
    const document = documentApp.container.resolve<ReturnType<typeof createOpenApiDocument>>(
      OPENAPI_DOCUMENT,
    );
    expect(Object.keys(document.paths)).toContain('/users/{id}');
    expect(document.info.title).toBe('My API');
    await documentApp.close();
    await app.close();
  });
});
