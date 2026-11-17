/**
 * Core decorators: module wiring, DI markers, and route metadata.
 */

import {
  Container,
  markInjectable,
  setParamTokens,
  setPropertyTokens,
  type ProviderScope,
} from './container.ts';
import { METADATA_KEY, defineMetadata, getMetadata } from './metadata.ts';
import type { InjectionToken } from './tokens.ts';

export interface ModuleMetadata {
  imports: any[];
  controllers: any[];
  providers: any[];
  exports: any[];
}

export interface ModuleOptions {
  imports?: any[];
  controllers?: any[];
  providers?: any[];
  exports?: any[];
}

export function Module(metadata: ModuleOptions): ClassDecorator {
  return (target: any) => {
    defineMetadata(
      METADATA_KEY.MODULE,
      {
        imports: metadata.imports ?? [],
        controllers: metadata.controllers ?? [],
        providers: metadata.providers ?? [],
        exports: metadata.exports ?? [],
      } satisfies ModuleMetadata,
      target,
    );
    markInjectable(target);
  };
}

/** Marks a class as injectable. Optional when the class is listed as a provider. */
export function Injectable(options: { scope?: ProviderScope } = {}): ClassDecorator {
  return (target: any) => {
    markInjectable(target);
    defineMetadata(METADATA_KEY.INJECTABLE, options.scope ?? 'singleton', target);
  };
}

/** Injects a provider by token into a constructor parameter. */
export function Inject(token: InjectionToken): ParameterDecorator {
  return (target: any, _propertyKey: string | symbol | undefined, index: number) => {
    setParamTokens(target, index, token);
  };
}

/** Injects a provider by token into a class property. */
export function InjectProperty(token: InjectionToken): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    setPropertyTokens(target, String(propertyKey), token);
  };
}

/** Registers a class as a provider in the module it is declared in. */
export function Provider(options: { scope?: ProviderScope } = {}): ClassDecorator {
  return (target: any) => {
    markInjectable(target);
    defineMetadata(METADATA_KEY.PROVIDERS, { class: target, scope: options.scope ?? 'singleton' }, target);
  };
}

export function getModuleMetadata(target: any): ModuleMetadata {
  const raw = getMetadata<Partial<ModuleMetadata>>(METADATA_KEY.MODULE, target);
  return {
    imports: raw?.imports ?? [],
    controllers: raw?.controllers ?? [],
    providers: raw?.providers ?? [],
    exports: raw?.exports ?? [],
  };
}

/** Reads the scope declared by `@Injectable({ scope })`. */
export function getDeclaredScope(target: any): ProviderScope {
  const value = getMetadata<ProviderScope>(METADATA_KEY.INJECTABLE, target);
  return value ?? 'singleton';
}

export { Container };
