import { describe, expect, test } from 'bun:test';
import { Module } from '../src/core/decorators.ts';
import { createContext } from '../src/factory.ts';
import {
  HEALTH_CHECK,
  HealthModule,
  createHealthCheck,
  createHealthHandler,
  createHealthIndicator,
  createHealthModule,
} from '../src/health/index.ts';

describe('createHealthCheck', () => {
  test('reports up when every indicator is up', async () => {
    const check = createHealthCheck([
      createHealthIndicator('database', () => ({ status: 'up' })),
      createHealthIndicator('cache', () => ({ status: 'up' })),
    ]);
    const report = await check.check();
    expect(report.status).toBe('up');
    expect(Object.keys(report.checks)).toEqual(['database', 'cache']);
  });

  test('reports down when one indicator is down', async () => {
    const check = createHealthCheck([
      createHealthIndicator('database', () => ({ status: 'up' })),
      createHealthIndicator('cache', () => ({ status: 'down' })),
    ]);
    const report = await check.check();
    expect(report.status).toBe('down');
    expect(report.checks.cache?.status).toBe('down');
  });

  test('a throwing indicator counts as down', async () => {
    const check = createHealthCheck([
      createHealthIndicator('database', () => {
        throw new Error('connection refused');
      }),
    ]);
    const report = await check.check();
    expect(report.status).toBe('down');
    expect(report.checks.database?.details?.error).toBe('connection refused');
  });

  test('an async indicator is awaited', async () => {
    const check = createHealthCheck([
      createHealthIndicator('database', async () => {
        await Bun.sleep(1);
        return { status: 'up', details: { latency: 3 } };
      }),
    ]);
    const report = await check.check();
    expect(report.checks.database?.details?.latency).toBe(3);
  });

  test('the report carries the uptime', async () => {
    const check = createHealthCheck([], { uptime: () => 1_234 });
    const report = await check.check();
    expect(report.uptime).toBe(1_234);
  });

  test('the indicators are listed', () => {
    const check = createHealthCheck([createHealthIndicator('database', () => ({ status: 'up' }))]);
    expect(check.indicators).toHaveLength(1);
    expect(check.indicators[0]?.name).toBe('database');
  });
});

describe('createHealthHandler', () => {
  test('answers 200 when everything is up', async () => {
    const handler = createHealthHandler(
      createHealthCheck([createHealthIndicator('database', () => ({ status: 'up' }))]),
    );
    const response = await handler(new Request('http://localhost/health'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; checks: Record<string, unknown> };
    expect(body.status).toBe('up');
    expect(body.checks.database).toBeDefined();
  });

  test('answers 503 when something is down', async () => {
    const handler = createHealthHandler(
      createHealthCheck([createHealthIndicator('database', () => ({ status: 'down' }))]),
    );
    const response = await handler(new Request('http://localhost/health'));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe('down');
  });

  test('the body names every check', async () => {
    const handler = createHealthHandler(
      createHealthCheck([
        createHealthIndicator('database', () => ({ status: 'up' })),
        createHealthIndicator('cache', () => ({ status: 'up' })),
      ]),
    );
    const response = await handler(new Request('http://localhost/health'));
    const body = (await response.json()) as { checks: Record<string, unknown> };
    expect(Object.keys(body.checks)).toEqual(['database', 'cache']);
  });
});

describe('HealthModule', () => {
  test('resolves the health check from the container', async () => {
    @Module({ imports: [HealthModule] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const check = app.container.resolve<ReturnType<typeof createHealthCheck>>(HEALTH_CHECK);
    expect(typeof check.check).toBe('function');
    await app.close();
  });

  test('createHealthModule applies the indicators', async () => {
    @Module({
      imports: [
        createHealthModule([createHealthIndicator('database', () => ({ status: 'up' }))]),
      ],
    })
    class AppModule {}

    const app = await createContext([AppModule]);
    const check = app.container.resolve<ReturnType<typeof createHealthCheck>>(HEALTH_CHECK);
    const report = await check.check();
    expect(report.checks.database?.status).toBe('up');
    await app.close();
  });
});
