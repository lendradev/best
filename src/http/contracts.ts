/**
 * Cross-cutting primitives: guards, interceptors, pipes, filters, and the
 * HTTP exception hierarchy.
 */

export interface ExecutionContext {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: Headers;
  body: unknown;
  request: unknown;
  /** Populated by pipes and handlers. */
  state: Record<string, unknown>;
}

export interface CanActivate {
  canActivate(context: ExecutionContext): boolean | Promise<boolean>;
}

export interface NestInterceptor {
  intercept(context: ExecutionContext, next: () => Promise<unknown>): Promise<unknown>;
}

export interface PipeTransform<T = unknown> {
  transform(value: unknown, context: ExecutionContext): T | Promise<T>;
}

export interface ExceptionFilter {
  catch(exception: unknown, context: ExecutionContext): unknown;
}

/* -------------------------------------------------------------------------- */
/* HTTP exceptions                                                            */
/* -------------------------------------------------------------------------- */

export class HttpException extends Error {
  readonly status: number;
  readonly response: unknown;

  constructor(status: number, response: unknown) {
    super(typeof response === 'string' ? response : `HTTP ${status}`);
    this.status = status;
    this.response = response;
    this.name = new.target.name;
  }
}

function createException(name: string, status: number, defaultMessage: string) {
  return class extends HttpException {
    constructor(message: unknown = defaultMessage) {
      super(status, {
        statusCode: status,
        error: name,
        message: typeof message === 'string' ? message : defaultMessage,
      });
    }
  };
}

export const BadRequestException = createException('Bad Request', 400, 'Bad Request');
export const UnauthorizedException = createException('Unauthorized', 401, 'Unauthorized');
export const ForbiddenException = createException('Forbidden', 403, 'Forbidden');
export const NotFoundException = createException('Not Found', 404, 'Not Found');
export const ConflictException = createException('Conflict', 409, 'Conflict');
export const GoneException = createException('Gone', 410, 'Gone');
export const UnprocessableEntityException = createException(
  'Unprocessable Entity',
  422,
  'Unprocessable Entity',
);
export const TooManyRequestsException = createException('Too Many Requests', 429, 'Too Many Requests');
export const InternalServerErrorException = createException(
  'Internal Server Error',
  500,
  'Internal Server Error',
);
export const NotImplementedException = createException('Not Implemented', 501, 'Not Implemented');
export const ServiceUnavailableException = createException(
  'Service Unavailable',
  503,
  'Service Unavailable',
);

/** Marks a class as a guard. */
const GUARDS = Symbol.for('best:guards');
const INTERCEPTORS = Symbol.for('best:interceptors');
const FILTERS = Symbol.for('best:filters');
const PIPES = Symbol.for('best:pipes');
const MIDDLEWARE = Symbol.for('best:middleware');

export function UseGuards(...guards: any[]): ClassDecorator & MethodDecorator {
  return makeDecorator(GUARDS)(...guards) as ClassDecorator & MethodDecorator;
}

export function UseInterceptors(...interceptors: any[]): ClassDecorator & MethodDecorator {
  return makeDecorator(INTERCEPTORS)(...interceptors) as ClassDecorator & MethodDecorator;
}

export function UseFilters(...filters: any[]): ClassDecorator & MethodDecorator {
  return makeDecorator(FILTERS)(...filters) as ClassDecorator & MethodDecorator;
}

export function UsePipes(...pipes: any[]): ClassDecorator & MethodDecorator {
  return makeDecorator(PIPES)(...pipes) as ClassDecorator & MethodDecorator;
}

export function UseMiddleware(...middleware: any[]): ClassDecorator & MethodDecorator {
  return makeDecorator(MIDDLEWARE)(...middleware) as ClassDecorator & MethodDecorator;
}

/**
 * Cross-cutting members are stored per target:
 * - class-level members on the constructor,
 * - method-level members on the prototype under a per-method key.
 *
 * A single symbol property per prototype would leak a method's guards into
 * every other method of the same controller, so method scope is keyed by name.
 */
const METHOD_SCOPE = Symbol.for('best:method-scope');
function defineScoped(
  target: any,
  kind: symbol,
  members: any[],
  methodName?: string,
): void {
  if (!methodName) {
    const existing = (target[kind] as any[] | undefined) ?? [];
    target[kind] = [...existing, ...members];
    return;
  }
  const scope = (target[METHOD_SCOPE] ??= new Map<string, any[]>());
  const key = `${kind.description ?? kind.toString()}:${methodName}`;
  const existing = scope.get(key) ?? [];
  scope.set(key, [...existing, ...members]);
}

function makeDecorator(kind: symbol) {
  return function (...members: any[]) {
    return function (target: any, key?: string | symbol, _descriptor?: any) {
      defineScoped(target, kind, members, key === undefined ? undefined : String(key));
    };
  } as any;
}

export function getDecorators(target: any, kind: symbol): any[] {
  const own = (target?.[kind] as any[] | undefined) ?? [];
  const parent = target ? ((Object.getPrototypeOf(target) as any)?.[kind] as any[] | undefined) : undefined;
  return [...(parent ?? []), ...(own ?? [])];
}

/** Method-scoped members for a specific handler name. */
export function getMethodDecorators(
  controllerType: any,
  methodName: string,
  kind: symbol,
): any[] {
  const scope = controllerType?.prototype?.[METHOD_SCOPE] as Map<string, any[]> | undefined;
  return scope?.get(`${kind.description ?? kind.toString()}:${methodName}`) ?? [];
}

/** Class-level members only (constructor scope). */
export function getClassDecorators(controllerType: any, kind: symbol): any[] {
  const own = (controllerType?.[kind] as any[] | undefined) ?? [];
  const parent = controllerType
    ? ((Object.getPrototypeOf(controllerType) as any)?.[kind] as any[] | undefined)
    : undefined;
  return [...(parent ?? []), ...(own ?? [])];
}
