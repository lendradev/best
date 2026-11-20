/**
 * OpenAPI document generator.
 *
 * The document is built from the route table the router already holds, so it
 * cannot drift from the routes the application serves.
 */

import type { RouteDefinition } from '../http/context.ts';

export interface OpenApiInfo {
  title: string;
  version: string;
  description?: string;
}

export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses: Record<string, OpenApiResponse>;
}

export interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  schema?: Record<string, unknown>;
  description?: string;
}

export interface OpenApiRequestBody {
  required?: boolean;
  content: Record<string, { schema?: Record<string, unknown> }>;
}

export interface OpenApiResponse {
  description: string;
  content?: Record<string, { schema?: Record<string, unknown> }>;
}

export interface OpenApiDocument {
  openapi: string;
  info: OpenApiInfo;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: { schemas: Record<string, Record<string, unknown>> };
}

export interface OpenApiOptions {
  /** Title of the API. */
  title: string;
  /** Version of the API. */
  version: string;
  /** Description of the API. */
  description?: string;
  /** The OpenAPI version. Default `'3.1.0'`. */
  openapiVersion?: string;
  /** The routes to describe. */
  routes: RouteDefinition[];
  /** Extra schemas merged into `components.schemas`. */
  schemas?: Record<string, Record<string, unknown>>;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

/** The path parameters of a pattern, e.g. `:id` in `/users/:id`. */
function pathParameters(pattern: string): OpenApiParameter[] {
  const names = pattern.match(/:([A-Za-z0-9_]+)\??/g) ?? [];
  return names.map((name) => ({
    name: name.replace(/^:/, '').replace(/\?$/, ''),
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
}

/** Turns a route path into an OpenAPI path template. */
function toOpenApiPath(path: string): string {
  const normalized = path.replace(/\/{2,}/g, '/');
  const withoutTrailingSlash =
    normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  return withoutTrailingSlash.replace(/:([A-Za-z0-9_]+)\??/g, '{$1}');
}

export function createOpenApiDocument(options: OpenApiOptions): OpenApiDocument {
  const paths: Record<string, Record<string, OpenApiOperation>> = {};

  for (const route of options.routes) {
    const method = route.method.toLowerCase();
    if (!METHODS.includes(method)) continue;

    const path = toOpenApiPath(route.path);
    const entry = paths[path] ?? {};

    entry[method] = {
      operationId: route.handlerName,
      tags: route.controllerType?.name ? [route.controllerType.name] : undefined,
      parameters: pathParameters(route.path),
      responses: {
        '200': { description: 'Successful response' },
      },
    };

    paths[path] = entry;
  }

  return {
    openapi: options.openapiVersion ?? '3.1.0',
    info: {
      title: options.title,
      version: options.version,
      ...(options.description === undefined ? {} : { description: options.description }),
    },
    paths,
    components: { schemas: { ...options.schemas } },
  };
}
