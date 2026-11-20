/**
 * `best` CLI — project scaffolding, model generation, and migrations.
 *
 * Usage:
 *   best new <name>          scaffold a new Best project
 *   best generate <model>    scaffold a model file from the template
 *   best migrate <file>      apply DDL statements from a schema file
 *   best dev                 run src/main.ts with hot reload
 *   best start               run src/main.ts
 */

import {
  fileExists,
  joinPath,
  listDirectory,
  readTextFile,
  resolvePath,
  writeTextFile,
} from '../common/fs.ts';
import type { Driver } from '../orm/driver.ts';

const HELP = `best — an HTTP framework and a SQL ORM for Bun

Commands:
  new <name>              Scaffold a new Best project in ./<name>
  generate <model>        Create src/models/<model>.ts from the template
  migrate <schema.ts>     Apply the schema DDL to a database
  dev                     Run src/main.ts with hot reload
  start                   Run src/main.ts

Options:
  --db <file>             SQLite database file, used by \`migrate\`
  --url <connection>      Connection string for \`migrate\`
                           (postgres://, mysql://, mariadb://)
  --help, -h              Show this help
  --version, -v           Show the version
`;

const MIGRATE_USAGE = 'Usage: best migrate <schema.ts> (--db <file> | --url <connection-string>)';

/**
 * Model template. The table is imported from the package subpath so the
 * scaffolded project resolves it the same way the published package does.
 */
const MODEL_TEMPLATE = `import { id, integer, table, text } from 'best/orm';

export const {NAME} = table('{TABLE}', [
  id(),
  text('name', { notNull: true }),
  integer('createdAt', { notNull: true }),
]);

export type {ROW} = {
  id: number;
  name: string;
  createdAt: number;
};
`;

/**
 * Schema template — the file `best migrate` reads. `SchemaBuilder.table()`
 * returns the builder, so the calls chain and the schema is read off
 * `build()`.
 */
const SCHEMA_TEMPLATE = `import { SchemaBuilder } from 'best/orm';
import { {NAME} } from './models/{NAME}.ts';

export const schema = new SchemaBuilder()
  .table({NAME}.name, {NAME}.columns, { indexes: {NAME}.indexes })
  .build();
`;

/** `user` becomes `User`, for the generated row type. */
function pascalCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Derives a valid npm package name from the directory name. A path is reduced
 * to its last segment, and anything that is not allowed in a package name is
 * replaced with a dash.
 */
function packageName(name: string): string {
  const segment = name.split('/').filter(Boolean).pop() ?? 'app';
  const cleaned = segment.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[._-]+/, '');
  return cleaned.length > 0 ? cleaned.toLowerCase() : 'app';
}

/** Fills the placeholders of a model or schema template. */
function fillTemplate(template: string, name: string): string {
  return template
    .replaceAll('{NAME}', name)
    .replaceAll('{TABLE}', name)
    .replaceAll('{ROW}', `${pascalCase(name)}Row`);
}

export async function run(argv: string[]): Promise<number> {
  const [command, ...args] = argv;

  switch (command) {
    case undefined:
    case '--help':
    case '-h':
      console.log(HELP);
      return 0;
    case '--version':
    case '-v':
      console.log(await readVersion());
      return 0;
    case 'new':
      return commandNew(args);
    case 'generate':
    case 'g':
      return commandGenerate(args);
    case 'migrate':
      return commandMigrate(args);
    case 'dev':
    case 'start':
      return commandRun(command);
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      return 1;
  }
}

async function readVersion(): Promise<string> {
  try {
    const pkg = JSON.parse(await readTextFile(resolvePath('package.json'))) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function commandNew(args: string[]): Promise<number> {
  const name = args[0];
  if (!name) {
    console.error('Usage: best new <name>');
    return 1;
  }

  const root = name.startsWith('/') ? name : joinPath(process.cwd(), name);
  if ((await listDirectory(root)).length > 0) {
    console.error(`Directory "${name}" already exists and is not empty.`);
    return 1;
  }

  await writeTextFile(
    joinPath(root, 'package.json'),
    `${JSON.stringify(
      {
        name: packageName(name),
        version: '0.1.0',
        type: 'module',
        private: true,
        scripts: {
          dev: 'bun run --watch src/main.ts',
          start: 'bun run src/main.ts',
          test: 'bun test',
          typecheck: 'tsc --noEmit',
          migrate: 'bunx best migrate src/schema.ts --db app.db',
        },
        dependencies: {
          best: 'github:lendradev/best',
        },
        devDependencies: {
          '@types/bun': '1.4.4',
          typescript: '7.0.2',
        },
      },
      null,
      2,
    )}\n`,
  );

  await writeTextFile(
    joinPath(root, 'src', 'main.ts'),
    `import { createApp, Controller, Get, Module } from 'best';

@Controller('/')
class AppController {
  @Get('/')
  root() {
    return { status: 'ok' };
  }
}

@Module({ controllers: [AppController] })
class AppModule {}

const { listen } = createApp([AppModule]);
const server = await listen({ port: Number(process.env.PORT ?? 3000) });
console.log(\`Listening on \${server.url}\`);
`,
  );

  await writeTextFile(
    joinPath(root, 'src', 'models', 'user.ts'),
    fillTemplate(MODEL_TEMPLATE, 'user'),
  );

  await writeTextFile(
    joinPath(root, 'src', 'schema.ts'),
    fillTemplate(SCHEMA_TEMPLATE, 'user'),
  );

  await writeTextFile(
    joinPath(root, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          lib: ['ESNext'],
          target: 'ESNext',
          module: 'ESNext',
          moduleResolution: 'bundler',
          moduleDetection: 'force',
          allowImportingTsExtensions: true,
          strict: true,
          skipLibCheck: true,
          experimentalDecorators: true,
          types: ['bun'],
        },
        include: ['src'],
      },
      null,
      2,
    )}\n`,
  );

  await writeTextFile(joinPath(root, '.gitignore'), 'node_modules/\n.env\n*.log\ndist/\n');

  console.log(`Created ${name}/`);
  console.log(`  cd ${name} && bun install && bun run dev`);
  console.log('  The "best" dependency is installed from GitHub until the npm name is released.');
  return 0;
}

async function commandGenerate(args: string[]): Promise<number> {
  const model = args[0];
  if (!model) {
    console.error('Usage: best generate <model>');
    return 1;
  }
  const file = joinPath(process.cwd(), 'src', 'models', `${model}.ts`);
  if (await fileExists(file)) {
    console.error(`Model "${model}" already exists at ${file}`);
    return 1;
  }
  await writeTextFile(file, fillTemplate(MODEL_TEMPLATE, model));
  console.log(`Created ${file}`);
  return 0;
}

/** Matches a connection string such as `postgres://host/db`. */
function isConnectionUrl(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value);
}

async function commandMigrate(args: string[]): Promise<number> {
  const schemaPath = args[0];
  if (!schemaPath || schemaPath.startsWith('--')) {
    console.error(MIGRATE_USAGE);
    return 1;
  }

  const dbIndex = args.indexOf('--db');
  const urlIndex = args.indexOf('--url');
  const dbFile = dbIndex >= 0 ? args[dbIndex + 1] : undefined;
  const url = urlIndex >= 0 ? args[urlIndex + 1] : undefined;

  if (dbIndex >= 0 && (dbFile === undefined || dbFile.startsWith('--'))) {
    console.error('--db needs a SQLite file path.');
    console.error(MIGRATE_USAGE);
    return 1;
  }
  if (urlIndex >= 0 && (url === undefined || url.startsWith('--'))) {
    console.error('--url needs a connection string.');
    console.error(MIGRATE_USAGE);
    return 1;
  }
  if (!dbFile && !url) {
    console.error(
      'Choose a target: --db <file> for SQLite, --url <connection-string> for PostgreSQL, MySQL or MariaDB.',
    );
    console.error(MIGRATE_USAGE);
    return 1;
  }
  if (dbFile && isConnectionUrl(dbFile)) {
    console.error(`"--db ${dbFile}" is a connection string. SQLite needs a file path.`);
    console.error('Use --url for PostgreSQL, MySQL or MariaDB.');
    return 1;
  }
  if (url && url.startsWith('sqlite://')) {
    console.error('SQLite is a local file. Use --db <file> instead of --url.');
    return 1;
  }

  const absolute = resolvePath(schemaPath);
  if (!(await fileExists(absolute))) {
    console.error(`Schema file not found: ${schemaPath}`);
    return 1;
  }

  let schema: { tables?: unknown[] };
  try {
    const module = await import(absolute);
    schema = (module.schema ?? module.default) as { tables?: unknown[] };
  } catch (error) {
    console.error(`Could not load "${schemaPath}": ${errorMessage(error)}`);
    if (errorMessage(error).includes("Cannot find package 'best'")) {
      console.error('Run "bun install" in the project first.');
    }
    return 1;
  }
  if (!schema?.tables) {
    console.error(`"${schemaPath}" must export a schema with a "tables" array.`);
    return 1;
  }

  const { generateMigration } = await import('../orm/migrate.ts');
  const { createDriver } = await import('../orm/driver.ts');

  let driver: Driver;
  try {
    driver = url ? createDriver({ url }) : createDriver({ file: dbFile! });
  } catch (error) {
    console.error(`Could not open the database: ${errorMessage(error)}`);
    return 1;
  }

  const dialect = driver.kind;
  const migration = generateMigration(schema as never, 'manual', dialect);

  try {
    for (const statement of migration.statements) {
      await driver.run(statement);
    }
  } catch (error) {
    console.error(`Migration failed on ${dialect}: ${errorMessage(error)}`);
    await driver.close();
    return 1;
  }
  await driver.close();

  const target = url ?? dbFile!;
  console.log(
    `Applied ${migration.statements.length} statement${migration.statements.length === 1 ? '' : 's'} to ${target} (${dialect})`,
  );
  return 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function commandRun(mode: 'dev' | 'start'): Promise<number> {
  const entry = joinPath(process.cwd(), 'src', 'main.ts');
  if (!(await fileExists(entry))) {
    console.error(`No entry file at ${entry}. Create src/main.ts first.`);
    return 1;
  }
  const proc = Bun.spawn(
    [process.execPath, 'run', ...(mode === 'dev' ? ['--watch'] : []), entry],
    { stdio: ['inherit', 'inherit', 'inherit'] },
  );
  return await proc.exited;
}

if (import.meta.main) {
  process.exit(await run(process.argv.slice(2)));
}
