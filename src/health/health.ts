/**
 * Health check.
 *
 * Each indicator reports on one dependency. The check runs them all and
 * reports the overall state, so a route can answer `200` or `503` without
 * knowing what the dependencies are.
 */

export type HealthStatus = 'up' | 'down';

export interface HealthIndicatorResult {
  /** State of the dependency. */
  status: HealthStatus;
  /** What the indicator wants to report about the dependency. */
  details?: Record<string, unknown>;
}

export interface HealthIndicator {
  /** Name of the dependency. */
  readonly name: string;
  /** Checks the dependency. A thrown error means the dependency is down. */
  check(): Promise<HealthIndicatorResult> | HealthIndicatorResult;
}

export interface HealthReport {
  /** Overall state. `down` when any indicator is down. */
  status: HealthStatus;
  /** Result of every indicator, keyed by its name. */
  checks: Record<string, HealthIndicatorResult>;
  /** Milliseconds the process has been running. */
  uptime: number;
}

export interface HealthCheck {
  /** Runs every indicator and reports the overall state. */
  check(): Promise<HealthReport>;
  /** The registered indicators. */
  readonly indicators: HealthIndicator[];
}

export interface HealthCheckOptions {
  /** Milliseconds the process has been running. Default `Date.now() - process.uptime() * 1000`. */
  uptime?: () => number;
}

/** Builds an indicator from a name and a check function. */
export function createHealthIndicator(
  name: string,
  check: () => Promise<HealthIndicatorResult> | HealthIndicatorResult,
): HealthIndicator {
  return { name, check };
}

export function createHealthCheck(
  indicators: HealthIndicator[] = [],
  options: HealthCheckOptions = {},
): HealthCheck {
  const uptime =
    options.uptime ?? (() => Math.round(process.uptime() * 1000));

  return {
    async check(): Promise<HealthReport> {
      const checks: Record<string, HealthIndicatorResult> = {};

      for (const indicator of indicators) {
        try {
          const result = await indicator.check();
          checks[indicator.name] = result;
        } catch (error) {
          checks[indicator.name] = {
            status: 'down',
            details: { error: error instanceof Error ? error.message : String(error) },
          };
        }
      }

      const status = Object.values(checks).every((result) => result.status === 'up')
        ? 'up'
        : 'down';

      return { status, checks, uptime: uptime() };
    },

    get indicators(): HealthIndicator[] {
      return [...indicators];
    },
  };
}

/**
 * Builds a fetch handler that answers with the report: `200` when every
 * indicator is up, `503` when one is down.
 */
export function createHealthHandler(healthCheck: HealthCheck): (request: Request) => Promise<Response> {
  return async function handleHealth(): Promise<Response> {
    const report = await healthCheck.check();
    return new Response(JSON.stringify(report), {
      status: report.status === 'up' ? 200 : 503,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  };
}
