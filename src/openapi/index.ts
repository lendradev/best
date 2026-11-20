/**
 * OpenAPI entry point.
 */
export { createOpenApiDocument } from './openapi.ts';
export type {
  OpenApiDocument,
  OpenApiInfo,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiOptions,
} from './openapi.ts';
export { OPENAPI_DOCUMENT, OpenApiModule, createOpenApiModule } from './openapi.module.ts';
export type { OpenApiModuleOptions } from './openapi.module.ts';
