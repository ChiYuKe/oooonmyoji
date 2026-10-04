import fs from 'node:fs';
import path from 'node:path';

export const ICON_FOLDERS = ['hero-icons', 'skill-icons', 'soul-icons'] as const;
export const ICON_ARCHIVE = 'resources/onmyoji-icons.asar';

/** Application artwork is not an editable workflow template. */
export function isIconSourcePath(relative: string): boolean {
  const parts = relative.replace(/\\/g, '/').split('/');
  return parts[0] === 'assets' && ICON_FOLDERS.some(folder => folder === parts[1]);
}

/** Keep existing resource URLs and historical snapshots compatible. Electron reads ASAR natively. */
export function iconResourcePath(root: string, relative: string): string | undefined {
  if (!/^assets\/(hero|skill|soul)-icons\/\d+\.png$/.test(relative)) return undefined;
  const packed = path.join(root, ICON_ARCHIVE, ...relative.split('/').slice(1));
  return fs.existsSync(packed) ? packed : path.join(root, ...relative.split('/'));
}

export async function soulIconNames(root: string): Promise<Set<string>> {
  const packed = path.join(root, ICON_ARCHIVE, 'soul-icons');
  const entries = await fs.promises.readdir(packed, { withFileTypes: true }).catch(() =>
    fs.promises.readdir(path.join(root, 'assets', 'soul-icons'), { withFileTypes: true }).catch(() => []));
  return new Set(entries.filter(entry => entry.isFile()).map(entry => entry.name));
}
