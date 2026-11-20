import { describe, expect, test } from 'bun:test';
import { Module } from '../src/core/decorators.ts';
import { createContext } from '../src/factory.ts';
import {
  PASSWORD_HASHER,
  SecurityModule,
  TOKEN_SIGNER,
  createSecurityModule,
  hashPassword,
  signToken,
  verifyPassword,
  verifyToken,
} from '../src/security/index.ts';

const SECRET = 'test-secret-value';

describe('hashPassword', () => {
  test('a hash verifies against the right password', async () => {
    const hash = await hashPassword('correct horse');
    expect(await verifyPassword('correct horse', hash)).toBe(true);
  });

  test('a hash does not verify against a wrong password', async () => {
    const hash = await hashPassword('correct horse');
    expect(await verifyPassword('wrong horse', hash)).toBe(false);
  });

  test('two hashes of the same password differ', async () => {
    const first = await hashPassword('same');
    const second = await hashPassword('same');
    expect(first).not.toBe(second);
  });

  test('a corrupt hash returns false instead of throwing', async () => {
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
  });
});

describe('signToken', () => {
  test('a token verifies with the right secret', async () => {
    const { token } = await signToken({ sub: '42' }, { secret: SECRET });
    const payload = await verifyToken(token, { secret: SECRET });
    expect(payload?.sub).toBe('42');
  });

  test('a token does not verify with the wrong secret', async () => {
    const { token } = await signToken({ sub: '42' }, { secret: SECRET });
    expect(await verifyToken(token, { secret: 'other-secret' })).toBeNull();
  });

  test('a tampered payload does not verify', async () => {
    const { token } = await signToken({ sub: '42' }, { secret: SECRET });
    const [body, signature] = token.split('.');
    const tampered = `${Buffer.from(JSON.stringify({ sub: 'admin' })).toString('base64url')}.${signature}`;
    expect(body).toBeDefined();
    expect(await verifyToken(tampered, { secret: SECRET })).toBeNull();
  });

  test('a malformed token does not verify', async () => {
    expect(await verifyToken('not-a-token', { secret: SECRET })).toBeNull();
    expect(await verifyToken('a.b.c', { secret: SECRET })).toBeNull();
    expect(await verifyToken('', { secret: SECRET })).toBeNull();
  });

  test('an expired token does not verify', async () => {
    const { token, expiresAt } = await signToken({ sub: '42' }, { secret: SECRET, expiresInMs: 20 });
    expect(expiresAt).toBeGreaterThan(Date.now());
    await Bun.sleep(40);
    expect(await verifyToken(token, { secret: SECRET })).toBeNull();
  });

  test('a token without an expiry never expires', async () => {
    const { token, expiresAt } = await signToken({ sub: '42' }, { secret: SECRET });
    expect(expiresAt).toBeUndefined();
    const payload = await verifyToken(token, { secret: SECRET, now: Date.now() + 10_000_000 });
    expect(payload?.sub).toBe('42');
  });

  test('the payload carries the issued-at claim', async () => {
    const { token } = await signToken({ sub: '42' }, { secret: SECRET });
    const payload = await verifyToken(token, { secret: SECRET });
    expect(typeof payload?.iat).toBe('number');
  });

  test('extra claims are merged into the payload', async () => {
    const { token } = await signToken(
      { sub: '42' },
      { secret: SECRET, claims: { role: 'admin' } },
    );
    const payload = await verifyToken(token, { secret: SECRET });
    expect(payload?.role).toBe('admin');
  });

  test('signing without a secret throws', async () => {
    expect(signToken({}, { secret: '' })).rejects.toThrow();
  });
});

describe('SecurityModule', () => {
  test('resolves the password hasher from the container', async () => {
    @Module({ imports: [SecurityModule] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const hasher = app.container.resolve<{
      hash(p: string): Promise<string>;
      verify(p: string, hash: string): Promise<boolean>;
    }>(PASSWORD_HASHER);
    const hash = await hasher.hash('secret');
    expect(await hasher.verify('secret', hash)).toBe(true);
    await app.close();
  });

  test('createSecurityModule registers the token signer', async () => {
    @Module({ imports: [createSecurityModule({ secret: SECRET, expiresInMs: 60_000 })] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const signer = app.container.resolve<{
      sign(payload: Record<string, unknown>): Promise<{ token: string }>;
      verify(token: string): Promise<Record<string, unknown> | null>;
    }>(TOKEN_SIGNER);
    const { token } = await signer.sign({ sub: '7' });
    const payload = await signer.verify(token);
    expect(payload?.sub).toBe('7');
    await app.close();
  });

  test('the signer of the module rejects a token of another secret', async () => {
    @Module({ imports: [createSecurityModule({ secret: SECRET })] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const signer = app.container.resolve<{
      verify(token: string): Promise<Record<string, unknown> | null>;
    }>(TOKEN_SIGNER);
    const foreign = await signToken({ sub: '7' }, { secret: 'another-secret' });
    expect(await signer.verify(foreign.token)).toBeNull();
    await app.close();
  });
});
