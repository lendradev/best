/**
 * Security DI wiring.
 */

import { Module } from '../core/decorators.ts';
import { METADATA_KEY, defineMetadata } from '../core/metadata.ts';
import { hashPassword, signToken, verifyPassword, verifyToken } from './security.ts';

export const PASSWORD_HASHER = Symbol('best:password-hasher');
export const TOKEN_SIGNER = Symbol('best:token-signer');

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

export interface TokenSigner {
  sign(
    payload: Record<string, unknown>,
    options?: { expiresInMs?: number },
  ): Promise<{
    token: string;
    expiresAt: number | undefined;
  }>;
  verify(token: string): Promise<Record<string, unknown> | null>;
}

export interface SecurityModuleOptions {
  /** HMAC secret used by the token signer. Required. */
  secret: string;
  /** Default lifetime of a signed token in milliseconds. */
  expiresInMs?: number;
}

/**
 * Registers the password hasher as a singleton.
 *
 * The token signer needs a secret, so it is only available through
 * `createSecurityModule`.
 *
 *   @Module({ imports: [SecurityModule] })
 */
@Module({
  providers: [
    {
      provide: PASSWORD_HASHER,
      useFactory: (): PasswordHasher => ({
        hash: (password: string) => hashPassword(password),
        verify: (password: string, hash: string) => verifyPassword(password, hash),
      }),
    },
  ],
  exports: [PASSWORD_HASHER],
})
export class SecurityModule {}

/**
 * Builds a security module with a secret and a default token lifetime.
 *
 *   @Module({ imports: [createSecurityModule({ secret: process.env.SECRET! })] })
 */
export function createSecurityModule(options: SecurityModuleOptions): typeof SecurityModule {
  class ConfiguredSecurityModule {}
  Object.defineProperty(ConfiguredSecurityModule, 'name', { value: 'SecurityModule' });
  defineMetadata(
    METADATA_KEY.MODULE,
    {
      imports: [],
      controllers: [],
      providers: [
        {
          provide: PASSWORD_HASHER,
          useFactory: (): PasswordHasher => ({
            hash: (password: string) => hashPassword(password),
            verify: (password: string, hash: string) => verifyPassword(password, hash),
          }),
        },
        {
          provide: TOKEN_SIGNER,
          useFactory: (): TokenSigner => ({
            sign: (payload, signOptions) =>
              signToken(payload, {
                secret: options.secret,
                expiresInMs: signOptions?.expiresInMs ?? options.expiresInMs,
              }),
            verify: (token: string) => verifyToken(token, { secret: options.secret }),
          }),
        },
      ],
      exports: [PASSWORD_HASHER, TOKEN_SIGNER],
    },
    ConfiguredSecurityModule,
  );
  return ConfiguredSecurityModule;
}
