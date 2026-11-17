/**
 * Example application used by the integration test.
 */

import {
  Body,
  BodyPiped,
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  Post,
  ValidationPipe,
} from '../../src/index.ts';
import { Database } from '../../src/orm/index.ts';
import { id, integer, table, text } from '../../src/orm/schema.ts';

export const DATABASE = Symbol('test:database');

export const users = table('users', [
  id(),
  text('email', { notNull: true, unique: true }),
  text('name', { notNull: true }),
  integer('age'),
]);

@Injectable()
export class UserRepository {
  constructor(@Inject(DATABASE) readonly db: Database) {}

  model() {
    return this.db.model({ name: 'user', table: users });
  }

  list() {
    return this.model().findMany({ orderBy: { column: 'id', direction: 'asc' } });
  }
}

@Controller('/users')
export class UserController {
  constructor(@Inject(UserRepository) private readonly repository: UserRepository) {}

  @Get('/')
  async list() {
    return this.repository.list();
  }

  @Post('/')
  async create(
    @BodyPiped(
      new ValidationPipe({
        email: { type: 'email', required: true },
        name: { type: 'string', required: true },
        age: { type: 'integer', min: 0 },
      }),
    )
    body: { email: string; name: string; age?: number },
  ) {
    return this.repository.model().create({ data: body });
  }
}

export function createAppModule(db: Database): any {
  @Module({
    controllers: [UserController],
    providers: [UserRepository, { provide: DATABASE, useValue: db }],
  })
  class TestModule {}
  return TestModule;
}
