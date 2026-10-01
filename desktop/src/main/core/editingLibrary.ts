import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { changeEditingLibrary, emptyEditingLibrary, parseEditingLibrary, type EditingLibraryChange } from '../../shared/editing-library';

export class ProjectEditingLibrary {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly file: string;
  constructor(root: string) { this.file = path.join(root, 'artifacts', 'editor-library.json'); }
  private async read() {
    try { return parseEditingLibrary(JSON.parse(await fs.readFile(this.file, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyEditingLibrary(); throw error; }
  }
  async list() { await this.queue.catch(() => {}); return this.read(); }
  update(change: EditingLibraryChange) {
    const run = this.queue.catch(() => {}).then(async () => {
      const library = changeEditingLibrary(await this.read(), change);
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      try { await fs.writeFile(temp, JSON.stringify(library), { encoding: 'utf8', flag: 'wx' }); await fs.rename(temp, this.file); }
      finally { await fs.rm(temp, { force: true }); }
      return library;
    });
    this.queue = run;
    return run;
  }
}
