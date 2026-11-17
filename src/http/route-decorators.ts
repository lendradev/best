/**
 * Route decorators. Handlers are collected into the controller prototype metadata.
 */

import { METADATA_KEY, defineMetadata, getMetadata } from '../core/metadata.ts';

export interface RouteInfo {
  method: string;
  path: string;
  handlerName: string;
}

export interface HttpCodeInfo {
  status: number;
  handlerName: string;
}

export function Controller(prefix = ''): ClassDecorator {
  return (target: any) => {
    defineMetadata(METADATA_KEY.PATH_METADATA, prefix, target);
    defineMetadata(METADATA_KEY.CONTROLLER, true, target);
  };
}

function routeDecorator(method: string, path: string): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const routes = getMetadata<RouteInfo[]>(METADATA_KEY.ROUTES, target) ?? [];
    routes.push({ method, path, handlerName: String(propertyKey) });
    defineMetadata(METADATA_KEY.ROUTES, routes, target);
  };
}

export const Get = (path = '') => routeDecorator('GET', path);
export const Post = (path = '') => routeDecorator('POST', path);
export const Put = (path = '') => routeDecorator('PUT', path);
export const Patch = (path = '') => routeDecorator('PATCH', path);
export const Delete = (path = '') => routeDecorator('DELETE', path);
export const Options = (path = '') => routeDecorator('OPTIONS', path);
export const Head = (path = '') => routeDecorator('HEAD', path);
export const All = (path = '') => routeDecorator('ALL', path);

/** Overrides the default status code for a handler (default 200, 201 for POST). */
export function HttpCode(status: number): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const codes = getMetadata<HttpCodeInfo[]>(METADATA_KEY.HTTP_CODE, target) ?? [];
    codes.push({ status, handlerName: String(propertyKey) });
    defineMetadata(METADATA_KEY.HTTP_CODE, codes, target);
  };
}

export function getRoutes(target: any): RouteInfo[] {
  // Method decorators store metadata on the class prototype.
  const own = getMetadata<RouteInfo[]>(METADATA_KEY.ROUTES, target);
  if (own) return own;
  const proto = target?.prototype;
  return (proto ? getMetadata<RouteInfo[]>(METADATA_KEY.ROUTES, proto) : undefined) ?? [];
}

export function getHttpCodes(target: any): Map<string, number> {
  const read = (source: any): HttpCodeInfo[] =>
    getMetadata<HttpCodeInfo[]>(METADATA_KEY.HTTP_CODE, source) ?? [];
  const codes = [...read(target), ...read(target?.prototype)];
  return new Map(codes.map((c) => [c.handlerName, c.status]));
}

export function getControllerPrefix(target: any): string {
  return getMetadata<string>(METADATA_KEY.PATH_METADATA, target) ?? '';
}
