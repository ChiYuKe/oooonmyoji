import { promises as fs } from 'node:fs';
import path from 'node:path';
import { aiTemplatePath } from '../shared/ai-context';
import { isPathInside } from './core/contentPaths';
import type { NativeImage } from 'electron';

export async function loadAiImage(projectRoot: string, relative: string, createImage: (bytes: Buffer) => NativeImage): Promise<string> {
  let image = createImage(await readAiImage(projectRoot, relative));
  if (image.isEmpty()) throw new Error(`AI 模板图片无法解析：${relative}。请关闭“附带模板图片”后重试。`);
  const { width, height } = image.getSize();
  if (Math.max(width, height) > 1024) image = image.resize(width >= height ? { width: 1024 } : { height: 1024 });
  const bytes = image.toPNG();
  if (!bytes.length || bytes.length > 1024 * 1024) throw new Error(`AI 模板图片过大：${relative}。请关闭“附带模板图片”后重试。`);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

/** Resolve real paths too: a symlink inside assets must not expose files outside it. */
export async function readAiImage(projectRoot: string, relative: string): Promise<Buffer> {
  if (typeof relative !== 'string' || aiTemplatePath(relative) !== relative) throw new Error('AI 模板路径无效');
  try {
    const root = await fs.realpath(projectRoot);
    const assets = path.join(root, 'assets');
    const file = await fs.realpath(path.resolve(root, relative));
    if (!isPathInside(assets, file)) throw new Error();
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error();
    const bytes = await fs.readFile(file);
    if (bytes.length > 8 * 1024 * 1024) throw new Error();
    return bytes;
  } catch { throw new Error(`AI 模板图片无法读取：${relative}。请检查图片，或关闭“附带模板图片”后重试。`); }
}
