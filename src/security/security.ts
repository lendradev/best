/**
 * Password hashing and token signing.
 *
 * The hashing uses `Bun.password`, which runs argon2 by default. The token
 * signer uses HMAC-SHA-256 from the Web Crypto API, so there is no
 * third-party library in the path.
 */

export type PasswordAlgorithm = 'argon2id' | 'argon2i' | 'argon2d' | 'bcrypt';

export interface HashPasswordOptions {
  /** Algorithm and its parameters. Default `{ algorithm: 'argon2id' }`. */
  algorithm?: PasswordAlgorithm | Record<string, unknown>;
}

export interface TokenPayload {
  [claim: string]: unknown;
}

export interface SignTokenOptions {
  /** HMAC secret. Required — there is no default. */
  secret: string;
  /** Lifetime of the token in milliseconds. Omit for a token that never expires. */
  expiresInMs?: number;
  /** Extra claims merged into the payload. */
  claims?: TokenPayload;
}

export interface SignTokenResult {
  /** The signed token. */
  token: string;
  /** Unix milliseconds the token expires at, or `undefined` when it never does. */
  expiresAt: number | undefined;
}

export interface VerifyTokenOptions {
  /** HMAC secret. Required — there is no default. */
  secret: string;
  /** Overrides the clock, in unix milliseconds. Used by the tests. */
  now?: number;
}

/** Hashes a password with argon2. */
export async function hashPassword(
  password: string,
  options: HashPasswordOptions = {},
): Promise<string> {
  const algorithm = options.algorithm ?? 'argon2id';
  return Bun.password.hash(password, algorithm as never);
}

/**
 * Checks a password against a hash.
 *
 * A hash that cannot be read returns `false` rather than throwing, so a
 * corrupt row in the database cannot crash the login route.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(password, hash);
  } catch {
    return false;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function base64UrlDecode(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function sign(data: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return base64UrlEncode(new Uint8Array(signature));
}

/**
 * Signs a payload into a token.
 *
 * The token is `base64url(payload).base64url(signature)`. The signature covers
 * the payload, so a tampered payload does not verify.
 */
export async function signToken(
  payload: TokenPayload,
  options: SignTokenOptions,
): Promise<SignTokenResult> {
  if (!options.secret) throw new Error('a secret is required to sign a token');

  const issuedAt = Date.now();
  const expiresAt = options.expiresInMs === undefined ? undefined : issuedAt + options.expiresInMs;

  const claims: TokenPayload = {
    ...options.claims,
    ...payload,
    iat: issuedAt,
    ...(expiresAt === undefined ? {} : { exp: expiresAt }),
  };

  const body = base64UrlEncode(encoder.encode(JSON.stringify(claims)));
  const signature = await sign(body, options.secret);

  return { token: `${body}.${signature}`, expiresAt };
}

/**
 * Verifies a token and returns its payload.
 *
 * Returns `null` when the token is malformed, the signature does not match,
 * or the token is expired.
 */
export async function verifyToken(
  token: string,
  options: VerifyTokenOptions,
): Promise<TokenPayload | null> {
  if (!options.secret) throw new Error('a secret is required to verify a token');

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [body, signature] = parts;
  if (!body || !signature) return null;

  const expected = await sign(body, options.secret);
  if (expected.length !== signature.length) return null;

  // A byte-by-byte comparison keeps the timing independent of the position
  // of the first difference.
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  if (difference !== 0) return null;

  let claims: TokenPayload;
  try {
    claims = JSON.parse(decoder.decode(base64UrlDecode(body))) as TokenPayload;
  } catch {
    return null;
  }

  const exp = claims.exp;
  if (typeof exp === 'number') {
    const now = options.now ?? Date.now();
    if (now >= exp) return null;
  }

  return claims;
}
