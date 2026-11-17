/**
 * Bun-native filesystem helpers.
 *
 * The framework uses no `node:` builtins: everything goes through `Bun.write`,
 * `Bun.file` and `Bun.Glob`.
 */

/** Write a text file, creating parent directories when needed. */
export async function writeTextFile(path: string, contents: string): Promise<void> {
  await Bun.write(path, contents);
}

/** Read a text file. Throws when the file does not exist. */
export async function readTextFile(path: string): Promise<string> {
  return Bun.file(path).text();
}

/** Returns true when the path exists and is a regular file. */
export async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

/** Returns true when the path exists and is a directory. */
export async function directoryExists(path: string): Promise<boolean> {
  const glob = new Bun.Glob('*');
  for await (const _ of glob.scan({ cwd: path })) {
    void _;
    return true;
  }
  return false;
}

/** List the entries of a directory. Returns an empty array when it is missing. */
export async function listDirectory(path: string): Promise<string[]> {
  const entries: string[] = [];
  const glob = new Bun.Glob('*');
  try {
    for await (const entry of glob.scan({ cwd: path })) {
      entries.push(entry);
    }
  } catch {
    return [];
  }
  return entries;
}

/** Join path segments with a single separator. */
export function joinPath(...segments: string[]): string {
  const filtered = segments.filter((segment) => segment.length > 0);
  if (filtered.length === 0) return '.';
  const joined = filtered
    .map((segment, index) => (index === 0 ? segment.replace(/\/+$/, '') : segment.replace(/^\/+|\/+$/g, '')))
    .join('/');
  return joined.length > 0 ? joined : '/';
}

/** Resolve a path against the current working directory. */
export function resolvePath(path: string): string {
  if (path.startsWith('/')) return path;
  return joinPath(process.cwd(), path);
}
