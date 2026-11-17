/**
 * Metadata storage. Own implementation — no `reflect-metadata` dependency.
 */

export const METADATA_KEY = {
  MODULE: Symbol('best:module'),
  GLOBAL_MODULE: Symbol('best:global-module'),
  INJECTABLE: Symbol('best:injectable'),
  CONTROLLER: Symbol('best:controller'),
  ROUTES: Symbol('best:routes'),
  PARAM_TOKENS: Symbol('best:param-tokens'),
  PROPERTY_TOKENS: Symbol('best:property-tokens'),
  PROVIDERS: Symbol('best:providers'),
  CONTROLLERS: Symbol('best:controllers'),
  IMPORTS: Symbol('best:imports'),
  EXPORTS: Symbol('best:exports'),
  SET_METADATA: Symbol('best:set-metadata'),
  GUARDS: Symbol('best:guards'),
  INTERCEPTORS: Symbol('best:interceptors'),
  FILTERS: Symbol('best:filters'),
  PIPES: Symbol('best:pipes'),
  MIDDLEWARE: Symbol('best:middleware'),
  PATH_METADATA: Symbol('best:path'),
  HTTP_CODE: Symbol('best:http-code'),
} as const;

const store = new WeakMap<object, Map<symbol, unknown>>();

function bucket(target: object): Map<symbol, unknown> {
  let map = store.get(target);
  if (!map) {
    map = new Map();
    store.set(target, map);
  }
  return map;
}

export function defineMetadata(key: symbol, value: unknown, target: object): void {
  bucket(target).set(key, value);
}

export function getMetadata<T = unknown>(key: symbol, target: object): T | undefined {
  return store.get(target)?.get(key) as T | undefined;
}

export function getOwnMetadata<T = unknown>(key: symbol, target: object): T | undefined {
  return getMetadata<T>(key, target);
}

export function hasMetadata(key: symbol, target: object): boolean {
  return store.get(target)?.has(key) ?? false;
}
