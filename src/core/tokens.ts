/**
 * Injection tokens.
 *
 * A token is either a class constructor (used as its own token) or a string/symbol
 * used to register a provider under a named key.
 */

export type InjectionToken<T = unknown> =
  | (abstract new (...args: any[]) => T)
  | string
  | symbol;

export function isClassToken(
  token: InjectionToken,
): token is abstract new (...args: any[]) => any {
  return typeof token === 'function';
}

export function tokenToString(token: InjectionToken): string {
  if (typeof token === 'string') return token;
  if (typeof token === 'symbol') return token.toString();
  return token.name || 'anonymous';
}
