import { describe, expect, test } from 'bun:test';
import {
  STATIC_FILES,
  StaticFilesModule,
  createStaticFilesModule,
  createStaticHandler,
} from '../src/static/index.ts';
import { createContext } from '../src/factory.ts';
import { Module } from '../src/core/decorators.ts';

const root = `${process.env.TMPDIR ?? '/tmp'}/best-static-fixtures`;

async function seed(): Promise<void> {
  await Bun.write(`${root}/index.html`, '<h1>index</h1>');
  await Bun.write(`${root}/app.js`, 'export const a = 1;');
  await Bun.write(`${root}/style.css`, 'body{}');
  await Bun.write(`${root}/data.json`, '{"ok":true}');
  await Bun.write(`${root}/logo.svg`, '<svg></svg>');
  await Bun.write(`${root}/blob.bin`, 'binary');
  await Bun.write(`${root}/nested/index.html`, '<h1>nested</h1>');
  await Bun.write(`${root}/../best-static-secret.txt`, 'secret');
}

function get(path: string, method = 'GET'): Request {
  return new Request(`http://localhost${path}`, { method });
}

/**
 * A request whose URL keeps the raw path. The `Request` constructor
 * normalizes `..` segments away, so a traversal attempt has to reach the
 * handler unnormalized.
 */
function rawRequest(path: string, method = 'GET'): Request {
  return { url: `http://localhost${path}`, method } as unknown as Request;
}

describe('createStaticHandler', () => {
  test('serves a file that exists', async () => {
    await seed();
    const handler = createStaticHandler({ root });
    const response = await handler(get('/public/app.js'));
    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    expect(await response!.text()).toBe('export const a = 1;');
  });

  test('returns null for a path outside the prefix', async () => {
    await seed();
    const handler = createStaticHandler({ root });
    expect(await handler(get('/other/app.js'))).toBeNull();
  });

  test('does not match a prefix that is only a string prefix of the path', async () => {
    await seed();
    const handler = createStaticHandler({ root, prefix: '/public' });
    expect(await handler(get('/public-extra/app.js'))).toBeNull();
  });

  test('rejects a traversal with .. segments', async () => {
    await seed();
    const handler = createStaticHandler({ root });
    const response = await handler(rawRequest('/public/../../etc/passwd'));
    expect(response).not.toBeNull();
    expect(response!.status).toBe(403);
  });

  test('rejects an encoded traversal', async () => {
    await seed();
    const handler = createStaticHandler({ root });
    const response = await handler(rawRequest('/public/%2e%2e/best-static-secret.txt'));
    expect(response).not.toBeNull();
    expect(response!.status).toBe(403);
  });

  test('rejects a backslash traversal', async () => {
    await seed();
    const handler = createStaticHandler({ root });
    const response = await handler(rawRequest('/public/..\\best-static-secret.txt'));
    expect(response).not.toBeNull();
    expect(response!.status).toBe(403);
  });

  test('serves the content type of the extension', async () => {
    await seed();
    const handler = createStaticHandler({ root });
    const cases: Array<[string, string]> = [
      ['/public/index.html', 'text/html; charset=utf-8'],
      ['/public/app.js', 'text/javascript; charset=utf-8'],
      ['/public/style.css', 'text/css; charset=utf-8'],
      ['/public/data.json', 'application/json; charset=utf-8'],
      ['/public/logo.svg', 'image/svg+xml'],
    ];
    for (const [path, expected] of cases) {
      const response = await handler(get(path));
      expect(response!.headers.get('content-type')).toBe(expected);
    }
  });

  test('falls back to application/octet-stream for an unknown extension', async () => {
    await seed();
    const handler = createStaticHandler({ root });
    const response = await handler(get('/public/blob.bin'));
    expect(response!.headers.get('content-type')).toBe('application/octet-stream');
  });

  test('serves the index file for a directory request', async () => {
    await seed();
    const handler = createStaticHandler({ root });
    const response = await handler(get('/public/nested'));
    expect(response).not.toBeNull();
    expect(await response!.text()).toBe('<h1>nested</h1>');
  });

  test('serves the index file for the root of the prefix', async () => {
    await seed();
    const handler = createStaticHandler({ root });
    const response = await handler(get('/public'));
    expect(response).not.toBeNull();
    expect(await response!.text()).toBe('<h1>index</h1>');
  });

  test('returns null for a missing file', async () => {
    await seed();
    const handler = createStaticHandler({ root });
    expect(await handler(get('/public/missing.html'))).toBeNull();
  });

  test('answers a HEAD request without a body', async () => {
    await seed();
    const handler = createStaticHandler({ root });
    const response = await handler(get('/public/app.js', 'HEAD'));
    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    expect(await response!.text()).toBe('');
  });

  test('honours a custom prefix, index and cache header', async () => {
    await seed();
    const handler = createStaticHandler({
      root,
      prefix: '/assets',
      index: 'app.js',
      cacheControl: 'public, max-age=60',
    });
    expect(await handler(get('/public/app.js'))).toBeNull();
    const response = await handler(get('/assets'));
    expect(await response!.text()).toBe('export const a = 1;');
    expect(response!.headers.get('cache-control')).toBe('public, max-age=60');
  });
});

describe('StaticFilesModule', () => {
  test('resolves the handler from the container', async () => {
    @Module({ imports: [StaticFilesModule] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const handler = app.container.resolve<(request: Request) => Promise<Response | null>>(
      STATIC_FILES,
    );
    expect(typeof handler).toBe('function');
    await app.close();
  });

  test('createStaticFilesModule applies the options', async () => {
    @Module({ imports: [createStaticFilesModule({ root, prefix: '/assets' })] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const handler = app.container.resolve<(request: Request) => Promise<Response | null>>(
      STATIC_FILES,
    );
    expect(await handler(get('/public/app.js'))).toBeNull();
    const response = await handler(get('/assets/app.js'));
    expect(response).not.toBeNull();
    await app.close();
  });
});
