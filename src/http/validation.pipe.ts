/**
 * Validation pipe — declarative, schema-free validation rules.
 *
 * Rules are plain objects so no class-validator dependency is required:
 *
 *   new ValidationPipe({ email: { type: 'email', required: true } })
 */

import { BadRequestException, type ExecutionContext, type PipeTransform } from './contracts.ts';

export type RuleType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'integer'
  | 'email'
  | 'url'
  | 'uuid'
  | 'date'
  | 'array'
  | 'object'
  | 'any';

export interface Rule {
  type?: RuleType;
  required?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  enum?: readonly unknown[];
  trim?: boolean;
  default?: unknown;
  /** Custom check. Return `true`, or a string message describing the failure. */
  check?: (value: unknown) => boolean | string;
  message?: string;
}

export type Schema = Record<string, Rule>;

export interface ValidationPipeOptions {
  /** Skip unknown keys instead of rejecting them. */
  whitelist?: boolean;
  /** Transform values to their declared type. */
  transform?: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URL_RE = /^https?:\/\/[^\s]+$/i;

export class ValidationPipe implements PipeTransform {
  readonly #schema: Schema;
  readonly #options: Required<ValidationPipeOptions>;

  constructor(schema: Schema, options: ValidationPipeOptions = {}) {
    this.#schema = schema;
    this.#options = { whitelist: options.whitelist ?? false, transform: options.transform ?? true };
  }

  transform(value: unknown, _context: ExecutionContext): unknown {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('Validation target must be an object');
    }
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    for (const [key, rule] of Object.entries(this.#schema)) {
      let current = input[key];

      if (rule.trim && typeof current === 'string') current = current.trim();

      if (current === undefined || current === null) {
        if (rule.required) {
          throw new BadRequestException(rule.message ?? `"${key}" is required`);
        }
        if (rule.default !== undefined) {
          output[key] = rule.default;
        }
        continue;
      }

      const coerced = this.#coerce(current, rule);
      const error = this.#validate(coerced, rule);
      if (error) {
        throw new BadRequestException(rule.message ?? `"${key}" ${error}`);
      }
      output[key] = coerced;
    }

    if (!this.#options.whitelist) {
      for (const [key, val] of Object.entries(input)) {
        if (!(key in output) && !(key in this.#schema)) output[key] = val;
      }
    }

    return output;
  }

  #coerce(value: unknown, rule: Rule): unknown {
    if (!this.#options.transform) return value;
    switch (rule.type) {
      case 'number':
      case 'integer': {
        if (typeof value === 'number') return value;
        const n = Number(value);
        return Number.isNaN(n) ? value : n;
      }
      case 'boolean': {
        if (typeof value === 'boolean') return value;
        if (value === 'true') return true;
        if (value === 'false') return false;
        return value;
      }
      default:
        // Strings are never coerced: a number sent for a string field is a
        // type error, not something to silently stringify.
        return value;
    }
  }

  #validate(value: unknown, rule: Rule): string | null {
    if (rule.enum && !rule.enum.includes(value)) {
      return `must be one of: ${rule.enum.join(', ')}`;
    }

    switch (rule.type) {
      case 'number':
        if (typeof value !== 'number' || Number.isNaN(value)) return 'must be a number';
        break;
      case 'integer':
        if (typeof value !== 'number' || !Number.isInteger(value)) return 'must be an integer';
        break;
      case 'boolean':
        if (typeof value !== 'boolean') return 'must be a boolean';
        break;
      case 'string':
        if (typeof value !== 'string') return 'must be a string';
        break;
      case 'email':
        if (typeof value !== 'string' || !EMAIL_RE.test(value)) return 'must be a valid email';
        break;
      case 'url':
        if (typeof value !== 'string' || !URL_RE.test(value)) return 'must be a valid URL';
        break;
      case 'uuid':
        if (typeof value !== 'string' || !UUID_RE.test(value)) return 'must be a valid UUID';
        break;
      case 'date':
        if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return 'must be a valid date';
        break;
      case 'array':
        if (!Array.isArray(value)) return 'must be an array';
        break;
      case 'object':
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'must be an object';
        break;
      default:
        break;
    }

    if (typeof value === 'number') {
      if (rule.min !== undefined && value < rule.min) return `must be >= ${rule.min}`;
      if (rule.max !== undefined && value > rule.max) return `must be <= ${rule.max}`;
    }

    if (typeof value === 'string') {
      if (rule.minLength !== undefined && value.length < rule.minLength) {
        return `must be at least ${rule.minLength} characters`;
      }
      if (rule.maxLength !== undefined && value.length > rule.maxLength) {
        return `must be at most ${rule.maxLength} characters`;
      }
      if (rule.pattern && !rule.pattern.test(value)) return `must match ${rule.pattern}`;
    }

    if (Array.isArray(value)) {
      if (rule.min !== undefined && value.length < rule.min) return `must contain at least ${rule.min} items`;
      if (rule.max !== undefined && value.length > rule.max) return `must contain at most ${rule.max} items`;
    }

    if (rule.check) {
      const result = rule.check(value);
      if (result !== true) return typeof result === 'string' ? result : 'is invalid';
    }

    return null;
  }
}
