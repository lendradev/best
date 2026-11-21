import { describe, expect, test } from 'bun:test';
import { Database } from '../src/orm/client.ts';
import { SqliteDriver } from '../src/orm/driver.ts';
import { generateMigration } from '../src/orm/migrate.ts';
import { id, integer, relation, table, text } from '../src/orm/schema.ts';

const users = table('users', [
  id(),
  text('email', { notNull: true, unique: true }),
  text('name', { notNull: true }),
]);

const posts = table('posts', [
  id(),
  text('title', { notNull: true }),
  integer('userId'),
]);

const comments = table('comments', [
  id(),
  text('body', { notNull: true }),
  integer('postId', { notNull: true }),
]);

const tags = table('tags', [
  id(),
  text('label', { notNull: true }),
]);

const postTags = table('post_tags', [
  integer('postId', { notNull: true }),
  integer('tagId', { notNull: true }),
]);

const userPosts = relation({
  name: 'posts',
  fromTable: 'posts',
  fromColumn: 'userId',
  toTable: 'users',
  toColumn: 'id',
  kind: 'one-to-many',
});

const postAuthor = relation({
  name: 'author',
  fromTable: 'posts',
  fromColumn: 'userId',
  toTable: 'users',
  toColumn: 'id',
  kind: 'many-to-one',
});

const postComments = relation({
  name: 'comments',
  fromTable: 'comments',
  fromColumn: 'postId',
  toTable: 'posts',
  toColumn: 'id',
  kind: 'one-to-many',
});

const postTagsRelation = relation({
  name: 'tags',
  fromTable: 'posts',
  fromColumn: 'id',
  toTable: 'tags',
  toColumn: 'id',
  kind: 'many-to-many',
  through: { table: 'post_tags', fromColumn: 'postId', toColumn: 'tagId' },
});

async function makeDb(): Promise<Database> {
  const db = new Database(new SqliteDriver({ file: ':memory:' }));
  const migration = generateMigration({
    tables: [users, posts, comments, tags, postTags],
    relations: [],
  });
  for (const statement of migration.statements) {
    await db.executeRun(statement);
  }

  db.model({ name: 'user', table: users, relations: [userPosts] });
  db.model({ name: 'post', table: posts, relations: [postAuthor, postComments, postTagsRelation] });
  db.model({ name: 'comment', table: comments });
  db.model({ name: 'tag', table: tags });

  const user = db.model({ name: 'user2', table: users });
  await user.create({ data: { email: 'ada@example.com', name: 'Ada' } });
  await user.create({ data: { email: 'linus@example.com', name: 'Linus' } });

  const post = db.model({ name: 'post2', table: posts });
  await post.create({ data: { title: 'First', userId: 1 } });
  await post.create({ data: { title: 'Second', userId: 1 } });
  await post.create({ data: { title: 'Third', userId: 2 } });

  const comment = db.model({ name: 'comment2', table: comments });
  await comment.create({ data: { body: 'Nice', postId: 1 } });
  await comment.create({ data: { body: 'Also nice', postId: 1 } });
  await comment.create({ data: { body: 'Meh', postId: 2 } });

  const tag = db.model({ name: 'tag2', table: tags });
  await tag.create({ data: { label: 'bun' } });
  await tag.create({ data: { label: 'sql' } });

  await db.executeRun('INSERT INTO post_tags (postId, tagId) VALUES (?, ?)', [1, 1]);
  await db.executeRun('INSERT INTO post_tags (postId, tagId) VALUES (?, ?)', [1, 2]);
  await db.executeRun('INSERT INTO post_tags (postId, tagId) VALUES (?, ?)', [2, 1]);

  return db;
}

describe('relation loading', () => {
  test('a to-one relation is loaded on the parent row', async () => {
    const db = await makeDb();
    const post = db.model({ name: 'post', table: posts, relations: [postAuthor] });
    const rows = await post.findMany({ include: { author: true } });
    expect(rows.length).toBe(3);
    expect(rows[0].author).toBeDefined();
    expect((rows[0].author as { name: string }).name).toBe('Ada');
  });

  test('a to-one relation is null when no row matches', async () => {
    const db = await makeDb();
    const post = db.model({ name: 'post', table: posts, relations: [postAuthor] });
    await db.executeRun('INSERT INTO posts (title, userId) VALUES (?, ?)', ['Orphan', 999]);
    const row = await post.findFirst({ where: { title: 'Orphan' }, include: { author: true } });
    expect(row?.author).toBeNull();
  });

  test('a to-many relation is loaded as an array', async () => {
    const db = await makeDb();
    const post = db.model({ name: 'post', table: posts, relations: [postComments] });
    const rows = await post.findMany({ include: { comments: true } });
    const first = rows.find((row) => row.title === 'First');
    expect(Array.isArray(first?.comments)).toBe(true);
    expect((first?.comments as unknown[]).length).toBe(2);
  });

  test('the reverse relation is loaded on the other side', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users, relations: [userPosts] });
    const rows = await user.findMany({ include: { posts: true } });
    const ada = rows.find((row) => row.name === 'Ada');
    expect((ada?.posts as unknown[]).length).toBe(2);
  });

  test('a many-to-many relation is loaded through the join table', async () => {
    const db = await makeDb();
    const post = db.model({ name: 'post', table: posts, relations: [postTagsRelation] });
    const rows = await post.findMany({ include: { tags: true } });
    const first = rows.find((row) => row.title === 'First');
    expect((first?.tags as unknown[]).length).toBe(2);
  });

  test('the columns of a relation are picked', async () => {
    const db = await makeDb();
    const post = db.model({ name: 'post', table: posts, relations: [postAuthor] });
    const row = await post.findFirst({
      where: { title: 'First' },
      include: { author: { select: { name: true } } },
    });
    const author = row?.author as Record<string, unknown>;
    expect(author.name).toBe('Ada');
    expect(author.email).toBeUndefined();
  });

  test('the parent columns are picked', async () => {
    const db = await makeDb();
    const post = db.model({ name: 'post', table: posts, relations: [postAuthor] });
    const row = await post.findFirst({ where: { title: 'First' }, select: { title: true } });
    expect(row?.title).toBe('First');
    expect(row?.userId).toBeUndefined();
  });

  test('a relation is filtered', async () => {
    const db = await makeDb();
    const post = db.model({ name: 'post', table: posts, relations: [postComments] });
    const rows = await post.findMany({
      include: { comments: { where: { body: 'Nice' } } },
    });
    const first = rows.find((row) => row.title === 'First');
    expect((first?.comments as unknown[]).length).toBe(1);
  });

  test('take counts the parent rows, not the joined rows', async () => {
    const db = await makeDb();
    const post = db.model({ name: 'post', table: posts, relations: [postComments] });
    const rows = await post.findMany({ take: 2, include: { comments: true } });
    expect(rows.length).toBe(2);
  });

  test('an unknown relation is reported', async () => {
    const db = await makeDb();
    const post = db.model({ name: 'post', table: posts, relations: [postAuthor] });
    expect(post.findMany({ include: { nope: true } })).rejects.toThrow(/no relation named/);
  });

  test('a relation whose key was not selected is reported', async () => {
    const db = await makeDb();
    const post = db.model({ name: 'post', table: posts, relations: [postAuthor] });
    expect(
      post.findMany({ select: { title: true }, include: { author: true } }),
    ).rejects.toThrow(/was not selected/);
  });

  test('the relation load uses one query per relation', async () => {
    const db = await makeDb();
    const post = db.model({ name: 'post', table: posts, relations: [postComments] });
    const statements: string[] = [];
    const original = db.executeAll.bind(db);
    db.executeAll = async <T>(sql: string, params: unknown[] = []) => {
      statements.push(sql);
      return original<T>(sql, params as never);
    };
    await post.findMany({ include: { comments: true } });
    expect(statements.length).toBe(2);
  });
});

describe('nested writes', () => {
  test('a nested create writes the relation', async () => {
    const db = await makeDb();
    const post = db.model({ name: 'post', table: posts, relations: [postComments] });
    const created = await post.create({
      data: { title: 'With comments', userId: 1, comments: { create: [{ body: 'Fresh' }] } },
    });
    expect(created.title).toBe('With comments');
    const comment = db.model({ name: 'comment', table: comments });
    const rows = await comment.findMany({ where: { body: 'Fresh' } });
    expect(rows.length).toBe(1);
    expect(rows[0].postId).toBe(created.id);
  });

  test('a nested create of a to-one relation links the parent', async () => {
    const db = await makeDb();
    const post = db.model({ name: 'post', table: posts, relations: [postAuthor] });
    const created = await post.create({
      data: { title: 'By author', author: { create: [{ email: 'new@example.com', name: 'New' }] } },
    });
    const author = created.author as { name: string; id: number };
    expect(author.name).toBe('New');
    expect(created.userId).toBe(author.id);
  });

  test('a nested connect links an existing row', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users, relations: [userPosts] });
    await user.update({
      where: { id: 1 },
      data: { posts: { connect: [{ id: 3 }] } },
    });
    const post = db.model({ name: 'post', table: posts });
    const row = await post.findUnique({ where: { id: 3 } });
    expect(row?.userId).toBe(1);
  });

  test('a nested disconnect unlinks a row without deleting it', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users, relations: [userPosts] });
    await user.update({
      where: { id: 1 },
      data: { posts: { disconnect: [{ id: 1 }] } },
    });
    const post = db.model({ name: 'post', table: posts });
    const row = await post.findUnique({ where: { id: 1 } });
    expect(row).not.toBeNull();
    expect(row?.userId).toBeNull();
  });

  test('a nested create of a many-to-many relation writes the join table', async () => {
    const db = await makeDb();
    const post = db.model({ name: 'post', table: posts, relations: [postTagsRelation] });
    const created = await post.create({
      data: { title: 'Tagged', userId: 1, tags: { create: [{ label: 'new-tag' }] } },
    });
    const rows = await db.executeAll<{ label: string }>(
      'SELECT t.label FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = ?',
      [created.id],
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.label).toBe('new-tag');
  });

  test('a failing nested write rolls the parent write back', async () => {
    const db = await makeDb();
    const post = db.model({ name: 'post', table: posts, relations: [postComments] });
    await post
      .create({
        data: {
          title: 'Rolled back',
          userId: 1,
          comments: { connect: [{ id: 9999 }] },
        },
      })
      .catch(() => undefined);
    const rows = await post.findMany({ where: { title: 'Rolled back' } });
    expect(rows.length).toBe(0);
  });

  test('a nested create on an unknown relation is reported', async () => {
    const db = await makeDb();
    const post = db.model({ name: 'post', table: posts, relations: [postComments] });
    expect(
      post.create({ data: { title: 'X', userId: 1, nope: { create: [] } } }),
    ).rejects.toThrow();
  });
});

describe('groupBy', () => {
  test('the rows are grouped by the column', async () => {
    const db = await makeDb();
    const post = db.model({ name: 'post', table: posts });
    const groups = await post.groupBy({ by: 'userId' });
    expect(groups.length).toBe(2);
    const ada = groups.find((group) => group.group.userId === 1);
    expect(ada?._count).toBe(2);
  });

  test('the aggregate is computed per group', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    await user.create({ data: { email: 'grace@example.com', name: 'Grace' } });
    const groups = await user.groupBy({ by: 'name', _count: true });
    expect(groups.length).toBe(3);
    expect(groups.every((group) => group._count === 1)).toBe(true);
  });

  test('the sum is computed per group', async () => {
    const db = await makeDb();
    const post = db.model({ name: 'post', table: posts });
    const groups = await post.groupBy({ by: 'userId', _sum: { userId: true } });
    const ada = groups.find((group) => group.group.userId === 1);
    expect(ada?._sum.userId).toBe(2);
  });

  test('the group is filtered by the where clause', async () => {
    const db = await makeDb();
    const post = db.model({ name: 'post', table: posts });
    const groups = await post.groupBy({ by: 'userId', where: { userId: 1 } });
    expect(groups.length).toBe(1);
  });

  test('an unknown group column is reported', async () => {
    const db = await makeDb();
    const post = db.model({ name: 'post', table: posts });
    expect(post.groupBy({ by: 'nope' })).rejects.toThrow(/does not have/);
  });

  test('an empty group column list is reported', async () => {
    const db = await makeDb();
    const post = db.model({ name: 'post', table: posts });
    expect(post.groupBy({ by: [] })).rejects.toThrow(/empty list/);
  });
});
