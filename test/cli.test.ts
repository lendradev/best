import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { run } from '../src/cli/main.ts';

let workdir: string;
let previousCwd: string;

/** The repository root, so the scaffold's `best` imports resolve in tests. */
const repoRoot = new URL('..', import.meta.url).pathname;

beforeEach(async () => {
  previousCwd = process.cwd();
  workdir = `/tmp/best-cli-${crypto.randomUUID()}`;
  await Bun.write(`${workdir}/.keep`, '');
  // The scaffold imports `best` and `best/orm`; link the repository in so the
  // generated files resolve exactly as they would in an installed project.
  Bun.spawnSync(['mkdir', '-p', `${workdir}/node_modules`]);
  Bun.spawnSync(['ln', '-s', repoRoot, `${workdir}/node_modules/best`]);
  process.chdir(workdir);
});

afterEach(() => {
  process.chdir(previousCwd);
  Bun.spawnSync(['rm', '-rf', workdir]);
});

/** Runs the CLI and captures what it printed. */
async function cli(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...parts: unknown[]) => out.push(parts.join(' '));
  console.error = (...parts: unknown[]) => err.push(parts.join(' '));
  try {
    const code = await run(args);
    return { code, out: out.join('\n'), err: err.join('\n') };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

describe('CLI', () => {
  test('help lists the commands and the migrate options', async () => {
    const { code, out } = await cli('--help');
    expect(code).toBe(0);
    expect(out).toContain('new <name>');
    expect(out).toContain('migrate <schema.ts>');
    expect(out).toContain('--url');
  });

  test('new writes a project whose imports resolve to real files', async () => {
    const target = `${workdir}/demo`;
    const { code, out } = await cli('new', target);
    expect(code).toBe(0);
    expect(out).toContain('Created');

    const pkg = JSON.parse(await Bun.file(`${target}/package.json`).text()) as {
      name: string;
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.name).toBe('demo');
    expect(pkg.dependencies.best).toBe('github:lendradev/best');
    expect(pkg.scripts.migrate).toContain('migrate src/schema.ts --db app.db');

    const main = await Bun.file(`${target}/src/main.ts`).text();
    expect(main).toContain("from 'best'");

    const model = await Bun.file(`${target}/src/models/user.ts`).text();
    expect(model).toContain("from 'best/orm'");
    expect(model).not.toContain('../orm/schema.ts');

    const schema = await Bun.file(`${target}/src/schema.ts`).text();
    expect(schema).toContain("from 'best/orm'");
    expect(schema).toContain("from './models/user.ts'");
  });

  test('new refuses to overwrite a directory that has files', async () => {
    const target = `${workdir}/demo`;
    await Bun.write(`${target}/keep.txt`, 'x');
    const { code, err } = await cli('new', target);
    expect(code).toBe(1);
    expect(err).toContain('already exists');
  });

  test('generate writes a model that imports from the package subpath', async () => {
    await Bun.write(`${workdir}/src/models/placeholder.txt`, '');
    const { code, out } = await cli('generate', 'post');
    expect(code).toBe(0);
    expect(out).toContain('post.ts');

    const model = await Bun.file(`${workdir}/src/models/post.ts`).text();
    expect(model).toContain("from 'best/orm'");
    expect(model).toContain("table('post'");
  });

  test('migrate applies the schema to a SQLite file', async () => {
    const target = `${workdir}/demo`;
    await cli('new', target);
    const dbFile = `${workdir}/out.db`;

    const { code, out } = await cli('migrate', `${target}/src/schema.ts`, '--db', dbFile);
    expect(code).toBe(0);
    expect(out).toContain('Applied 1 statement');
    expect(out).toContain('sqlite');

    const db = new Database(dbFile, { readonly: true });
    const tables = db
      .query("select name from sqlite_master where type='table'")
      .all() as { name: string }[];
    expect(tables.map((row) => row.name)).toContain('user');
    db.close();
  });

  test('migrate explains itself when no target is given', async () => {
    const { code, err } = await cli('migrate', 'schema.ts');
    expect(code).toBe(1);
    expect(err).toContain('--db');
    expect(err).toContain('--url');
  });

  test('migrate rejects a connection string passed to --db', async () => {
    const { code, err } = await cli('migrate', 'schema.ts', '--db', 'postgres://localhost/app');
    expect(code).toBe(1);
    expect(err).toContain('connection string');
  });

  test('migrate reports a missing schema file', async () => {
    const { code, err } = await cli('migrate', `${workdir}/nope.ts`, '--db', `${workdir}/x.db`);
    expect(code).toBe(1);
    expect(err).toContain('not found');
  });
});
