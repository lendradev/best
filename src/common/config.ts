/**
 * Config service — typed access to environment variables and a config object.
 */

export interface ConfigOptions {
  /** Values that override environment variables. */
  values?: Record<string, string | number | boolean | undefined>;
  /** Prefix stripped from environment keys, e.g. "APP_". */
  envPrefix?: string;
  /** Fail when a required key is missing. */
  required?: string[];
}

export class ConfigService {
  readonly #values: Map<string, string>;
  readonly #cache = new Map<string, unknown>();

  constructor(options: ConfigOptions = {}) {
    this.#values = new Map();

    const prefix = options.envPrefix;
    for (const [key, value] of Object.entries(options.values ?? {})) {
      if (value !== undefined) this.#values.set(key, String(value));
    }

    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;
      if (prefix && !key.startsWith(prefix)) continue;
      const name = prefix ? key.slice(prefix.length) : key;
      if (this.#values.has(name)) continue;
      this.#values.set(name, value);
    }

    for (const key of options.required ?? []) {
      if (!this.#values.has(key)) {
        throw new Error(`Missing required config value: "${key}"`);
      }
    }
  }

  get<T = string>(key: string, fallback?: T): T {
    if (this.#cache.has(key)) return this.#cache.get(key) as T;
    const raw = this.#values.get(key);
    if (raw === undefined) {
      if (fallback === undefined) throw new Error(`Config value "${key}" is not defined`);
      return fallback;
    }
    const parsed = parseValue(raw) as T;
    this.#cache.set(key, parsed);
    return parsed;
  }

  has(key: string): boolean {
    return this.#values.has(key);
  }

  set(key: string, value: string | number | boolean): void {
    this.#values.set(key, String(value));
    this.#cache.delete(key);
  }

  keys(): string[] {
    return [...this.#values.keys()];
  }
}

function parseValue(raw: string): string | number | boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null as unknown as string;
  if (raw !== '' && !Number.isNaN(Number(raw)) && /^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}
