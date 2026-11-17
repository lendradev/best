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

const HELP = `best — NestJS-style framework and Prisma-style ORM for Bun

Commands:
  new <name>              Scaffold a new Best project in ./<name>
  generate <model>        Create src/models/<model>.ts from the template
  migrate <schema.ts>     Apply the schema DDL to a SQLite database
  dev                     Run src/main.ts with hot reload
  start                   Run src/main.ts

Options:
  --help, -h              Show this help
  --version, -v           Show the version
`;

const MODEL_TEMPLATE = `import { id, integer, table, text } from '../orm/schema.ts';

export const {TABLE} = table('{TABLE}', [
  id(),
  text('name', { notNull: true }),
  integer('createdAt', { notNull: true }),
]);

export type {TABLE}Row = {
  id: number;
  name: string;
  createdAt: number;
};
`;

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

  const root = joinPath(process.cwd(), name);
  if ((await listDirectory(root)).length > 0) {
    console.error(`Directory "${name}" already exists and is not empty.`);
    return 1;
  }

  await writeTextFile(
    joinPath(root, 'package.json'),
    `${JSON.stringify(
      {
        name,
        version: '0.1.0',
        type: 'module',
        private: true,
        scripts: {
          dev: 'bun run --watch src/main.ts',
          start: 'bun run src/main.ts',
          test: 'bun test',
        },
        dependencies: {},
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
    MODEL_TEMPLATE.replaceAll('{TABLE}', 'user'),
  );

  await writeTextFile(
    joinPath(root, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ESNext',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
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
  await writeTextFile(file, MODEL_TEMPLATE.replaceAll('{TABLE}', model));
  console.log(`Created ${file}`);
  return 0;
}

async function commandMigrate(args: string[]): Promise<number> {
  const schemaPath = args[0];
  if (!schemaPath) {
    console.error('Usage: best migrate <schema.ts> [--db file]');
    return 1;
  }

  const dbIndex = args.indexOf('--db');
  const dbFile = dbIndex >= 0 ? (args[dbIndex + 1] ?? 'best.db') : 'best.db';

  const absolute = resolvePath(schemaPath);
  if (!(await fileExists(absolute))) {
    console.error(`Schema file not found: ${schemaPath}`);
    return 1;
  }

  const module = await import(absolute);
  const schema = (module.schema ?? module.default) as { tables?: unknown[] };
  if (!schema?.tables) {
    console.error(`"${schemaPath}" must export a schema with a "tables" array.`);
    return 1;
  }

  const { generateMigration } = await import('../orm/migrate.ts');
  const { SqliteDriver } = await import('../orm/driver.ts');

  const migration = generateMigration(schema as never, 'manual');
  const driver = new SqliteDriver({ file: dbFile });
  for (const statement of migration.statements) {
    await driver.run(statement);
  }
  await driver.close();

  console.log(`Applied ${migration.statements.length} statements to ${dbFile}`);
  return 0;
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
