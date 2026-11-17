/**
 * Handler parameter decorators. These mark which argument receives what.
 *
 * Parameter metadata is stored per method name on the class prototype, so two
 * handlers in the same controller never collide.
 */

import { METADATA_KEY, defineMetadata, getMetadata } from '../core/metadata.ts';

export const PARAM_TYPES = Symbol.for('best:param-types');

export type ParamSource =
  | 'body'
  | 'query'
  | 'param'
  | 'headers'
  | 'request'
  | 'context'
  | 'custom';

export interface ParamMeta {
  index: number;
  source: ParamSource;
  name?: string;
  /** Pipe applied to this parameter before it reaches the handler. */
  pipe?: any;
}

export type ParamMetaMap = Map<string, ParamMeta[]>;

export function defineParam(
  target: any,
  methodName: string,
  index: number,
  meta: Omit<ParamMeta, 'index'>,
): void {
  const map = getMetadata<ParamMetaMap>(PARAM_TYPES, target) ?? new Map<string, ParamMeta[]>();
  const list = map.get(methodName) ?? [];
  list.push({ index, ...meta });
  map.set(methodName, list);
  defineMetadata(PARAM_TYPES, map, target);
}

export function getParamMeta(target: any, methodName: string): ParamMeta[] {
  const map = getMetadata<ParamMetaMap>(PARAM_TYPES, target);
  return map?.get(methodName) ?? [];
}

/**
 * Declares a parameter source. An optional pipe transforms the value before
 * the handler receives it.
 *
 *   @Body(new ValidationPipe({ email: { type: 'email' } })) body: CreateUserDto
 */
function paramDecorator(source: ParamSource, name?: string, pipe?: any) {
  return ((target: any, key: string | symbol | undefined, index: number) => {
    defineParam(target, String(key), index, { source, name, pipe });
  }) as ParameterDecorator;
}

export const Body = (name?: string) => paramDecorator('body', name);
/** Body with an inline pipe, e.g. `@Body(new ValidationPipe({...}))`. */
export const BodyPiped = (pipe: any, name?: string) => paramDecorator('body', name, pipe);
export const Query = (name?: string) => paramDecorator('query', name);
export const Param = (name?: string) => paramDecorator('param', name);
export const Headers = (name?: string) => paramDecorator('headers', name);
export const Req = () => paramDecorator('request');
export const Context = () => paramDecorator('context');

/** Custom decorator source, resolved through the request `state` bag. */
export const Ctx = (name: string) => paramDecorator('custom', name);

/** Parameter with an inline pipe. */
export const Piped = (source: ParamSource, pipe: any, name?: string) =>
  paramDecorator(source, name, pipe);

export { METADATA_KEY };
