/**
 * Static file serving built on `Bun.file`.
 *
 * The handler is a plain fetch-style function, so it can be mounted in front
 * of an application router: it answers with a `Response` when the request
 * path maps to a file, and with `null` when it does not, which lets the next
 * route handle the request.
 */

import { joinPath, resolvePath } from '../common/fs.ts';

export interface StaticFilesOptions {
  /** Directory served. Relative to the process working directory. */
  root: string;
  /** URL prefix the files are served under. Default '/public'. */
  prefix?: string;
  /** File name served for a directory request. Default 'index.html'. */
  index?: string;
  /** Cache-Control header value. Default 'public, max-age=0'. */
  cacheControl?: string;
}

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  txt: 'text/plain; charset=utf-8',
  woff2: 'font/woff2',
  ico: 'image/x-icon',
};

function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  const extension = path.slice(dot + 1).toLowerCase();
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

function normalizePrefix(prefix: string): string {
  const withSlash = prefix.startsWith('/') ? prefix : `/${prefix}`;
  return withSlash.length > 1 && withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash;
}

/** A resolved path is safe only when it stays inside the served root. */
function isInside(root: string, target: string): boolean {
  if (target === root) return true;
  const boundary = root.endsWith('/') ? root : `${root}/`;
  return target.startsWith(boundary);
}

function forbidden(): Response {
  return new Response('Forbidden', { status: 403 });
}

/**
 * Reads the raw path of a request URL. `new URL(...).pathname` collapses
 * `..` segments, which would hide a traversal attempt, so the path is taken
 * from the raw string instead.
 */
function rawPathname(url: string): string {
  const withoutScheme = url.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]*/, '');
  const cut = withoutScheme.search(/[?#]/);
  return cut === -1 ? withoutScheme : withoutScheme.slice(0, cut);
}

/**
 * Creates a handler that serves the files of `options.root` under
 * `options.prefix`.
 *
 * Behaviour worth knowing:
 * - A request outside the prefix returns `null`, so other routes still run.
 * - A path that tries to escape the root (via `..`, an encoded `..`, a
 *   backslash or a null byte) is answered with `403`.
 * - A path inside the prefix whose file does not exist returns `null`.
 * - A directory request is answered with the index file when it exists.
 */
export function createStaticHandler(
  options: StaticFilesOptions,
): (request: Request) => Promise<Response | null> {
  const root = resolvePath(options.root);
  const prefix = normalizePrefix(options.prefix ?? '/public');
  const index = options.index ?? 'index.html';
  const cacheControl = options.cacheControl ?? 'public, max-age=0';

  return async function handleStatic(request: Request): Promise<Response | null> {
    let pathname: string;
    try {
      pathname = decodeURIComponent(rawPathname(request.url));
    } catch {
      return forbidden();
    }

    if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null;

    const rest = pathname.slice(prefix.length);
    const relative = rest.replace(/^\/+/, '');

    const segments: string[] = [];
    for (const segment of relative.split('/')) {
      if (segment === '' || segment === '.') continue;
      if (segment === '..' || segment.includes('\\') || segment.includes('\0')) {
        return forbidden();
      }
      segments.push(segment);
    }

    const target = segments.length === 0 ? root : joinPath(root, ...segments);
    if (!isInside(root, target)) return forbidden();

    const file = Bun.file(target);
    if (await file.exists()) return serve(file, request, cacheControl);

    const indexFile = Bun.file(joinPath(target, index));
    if (await indexFile.exists()) return serve(indexFile, request, cacheControl);

    return null;
  };
}

function serve(file: ReturnType<typeof Bun.file>, request: Request, cacheControl: string): Response {
  const headers = new Headers({
    'content-type': contentTypeFor(file.name ?? ''),
    'cache-control': cacheControl,
  });

  if (request.method === 'HEAD') {
    headers.set('content-length', String(file.size));
    return new Response(null, { status: 200, headers });
  }

  return new Response(file, { status: 200, headers });
}
