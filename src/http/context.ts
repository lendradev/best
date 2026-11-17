/**
 * HTTP layer: request context, routing table, router, and the server.
 */

import { Container } from '../core/container.ts';

/** Injected into handlers to reach the current HTTP request. */
export const REQUEST = Symbol('best:request');

export interface RequestContext {
  method: string;
  url: URL;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: Headers;
  body: unknown;
  /** Raw request, available for streaming bodies. */
  raw: Request;
}

export interface ResponseContext {
  status: number;
  headers: Headers;
  body: unknown;
}

export interface RouteDefinition {
  method: string;
  path: string;
  handlerName: string;
  guards: any[];
  interceptors: any[];
  filters: any[];
  pipes: any[];
  handler: (...args: any[]) => unknown;
  controllerType: any;
}

/**
 * Compiles a path pattern like `/users/:id` into a matcher.
 * Supports `:param`, `:param?` (optional), and `*` (wildcard tail).
 */
export function compilePath(pattern: string): {
  regexp: RegExp;
  paramNames: string[];
} {
  const paramNames: string[] = [];
  const segments = pattern.split('/').filter((s) => s.length > 0);

  let source = '^';
  for (const segment of segments) {
    if (segment.startsWith(':')) {
      const optional = segment.endsWith('?');
      const name = segment.slice(1, optional ? -1 : undefined);
      paramNames.push(name);
      source += optional ? '(?:/([^/]+))?' : '/([^/]+)';
      continue;
    }
    if (segment === '*') {
      paramNames.push('wildcard');
      source += '/(.*)';
      continue;
    }
    source += '/' + segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  if (segments.length === 0) source += '/';
  source += '/?$';
  return { regexp: new RegExp(source), paramNames };
}

export function matchPath(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const { regexp, paramNames } = compilePath(pattern);
  const match = regexp.exec(path);
  if (!match) return null;
  const params: Record<string, string> = {};
  paramNames.forEach((name, index) => {
    const value = match[index + 1];
    if (value !== undefined) params[name] = decodeURIComponent(value);
  });
  return params;
}

/** Router holds the flattened route table for an application. */
export class Router {
  readonly routes: RouteDefinition[] = [];

  add(route: RouteDefinition): void {
    this.routes.push(route);
  }

  find(method: string, path: string): { route: RouteDefinition; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method && route.method !== 'ALL') continue;
      const params = matchPath(route.path, path);
      if (params) return { route, params };
    }
    return null;
  }

  /** All routes matching a path regardless of method — used for 405 responses. */
  pathExists(path: string): boolean {
    return this.routes.some((route) => matchPath(route.path, path) !== null);
  }
}

export function createRequestContext(request: Request, body: unknown): RequestContext {
  const url = new URL(request.url);
  return {
    method: request.method.toUpperCase(),
    url,
    path: url.pathname,
    params: {},
    query: url.searchParams,
    headers: request.headers,
    body,
    raw: request,
  };
}

export type { Container };
