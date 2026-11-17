import { describe, expect, test } from 'bun:test';
import {
  Body,
  BodyPiped,
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Post,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from '../src/index.ts';
import { createApp } from '../src/factory.ts';
import { createFetchHandler } from '../src/http/server.ts';
import type { ExecutionContext, NestInterceptor } from '../src/http/contracts.ts';

@Injectable()
class AuthGuard {
  canActivate(context: ExecutionContext): boolean {
    return context.headers.get('authorization') === 'Bearer secret';
  }
}

@Injectable()
class TimingInterceptor implements NestInterceptor {
  async intercept(_context: ExecutionContext, next: () => Promise<unknown>) {
    const result = await next();
    return { data: result, intercepted: true };
  }
}

@Controller('/items')
class ItemController {
  @Get('/')
  @UseGuards(AuthGuard)
  list() {
    return ['a', 'b'];
  }

  @Get('/guarded-class')
  @UseInterceptors(TimingInterceptor)
  guarded() {
    return 'value';
  }

  @Post('/')
  create(@BodyPiped(new ValidationPipe({ title: { type: 'string', required: true } })) body: { title: string }) {
    return body;
  }

  @Get('/missing')
  missing() {
    throw new NotFoundException('Item not found');
  }
}

@Module({ controllers: [ItemController], providers: [AuthGuard, TimingInterceptor] })
class TestModule {}

describe('Cross-cutting concerns', () => {
  test('guard blocks unauthorized requests', async () => {
    const { app } = createApp([TestModule]);
    await app.init();
    const handler = createFetchHandler(app);

    const denied = await handler(new Request('http://localhost/items'));
    expect(denied.status).toBe(403);

    const allowed = await handler(
      new Request('http://localhost/items', { headers: { authorization: 'Bearer secret' } }),
    );
    expect(allowed.status).toBe(200);
  });

  test('interceptor wraps the handler result', async () => {
    const { app } = createApp([TestModule]);
    await app.init();
    const handler = createFetchHandler(app);
    const response = await handler(new Request('http://localhost/items/guarded-class'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: 'value', intercepted: true });
  });

  test('validation pipe rejects an invalid body', async () => {
    const { app } = createApp([TestModule]);
    await app.init();
    const handler = createFetchHandler(app);
    const response = await handler(
      new Request('http://localhost/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 123 }),
      }),
    );
    expect(response.status).toBe(400);
  });

  test('validation pipe accepts a valid body', async () => {
    const { app } = createApp([TestModule]);
    await app.init();
    const handler = createFetchHandler(app);
    const response = await handler(
      new Request('http://localhost/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'hello' }),
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ title: 'hello' });
  });

  test('http exception maps to its status code', async () => {
    const { app } = createApp([TestModule]);
    await app.init();
    const handler = createFetchHandler(app);
    const response = await handler(new Request('http://localhost/items/missing'));
    expect(response.status).toBe(404);
    const body = (await response.json()) as { statusCode: number; message: string };
    expect(body.statusCode).toBe(404);
    expect(body.message).toBe('Item not found');
  });
});
