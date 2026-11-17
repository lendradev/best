import { describe, expect, test } from 'bun:test';
import { compilePath, matchPath } from '../src/http/context.ts';

describe('path matching', () => {
  test('matches a static path', () => {
    expect(matchPath('/users', '/users')).toEqual({});
    expect(matchPath('/users', '/posts')).toBeNull();
  });

  test('extracts a named parameter', () => {
    expect(matchPath('/users/:id', '/users/42')).toEqual({ id: '42' });
  });

  test('extracts multiple parameters', () => {
    expect(matchPath('/users/:id/posts/:postId', '/users/7/posts/9')).toEqual({
      id: '7',
      postId: '9',
    });
  });

  test('supports an optional parameter', () => {
    expect(matchPath('/users/:id?', '/users')).toEqual({});
    expect(matchPath('/users/:id?', '/users/3')).toEqual({ id: '3' });
  });

  test('decodes URI components', () => {
    expect(matchPath('/users/:name', '/users/john%20doe')).toEqual({ name: 'john doe' });
  });

  test('matches a wildcard tail', () => {
    expect(matchPath('/files/*', '/files/a/b/c')).toEqual({ wildcard: 'a/b/c' });
  });

  test('does not match a deeper static path', () => {
    expect(matchPath('/users', '/users/1')).toBeNull();
  });

  test('compilePath returns the parameter names in order', () => {
    expect(compilePath('/a/:x/b/:y').paramNames).toEqual(['x', 'y']);
  });
});
