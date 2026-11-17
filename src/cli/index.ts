#!/usr/bin/env bun
import { run } from './main.ts';

process.exit(await run(process.argv.slice(2)));
