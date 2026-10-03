import { ClipboardItem, type NativeImage } from 'electron';

/** Validate before writing so an invalid render cannot erase the existing clipboard. */
export async function copyPngToClipboard(dataUrl: unknown, write: (items: ClipboardItem[]) => Promise<void>,
  decode: (dataUrl: string) => NativeImage): Promise<void> {
  if (typeof dataUrl !== 'string' || dataUrl.length > 64 * 1024 * 1024
    || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) throw new Error('复制失败：图片数据无效');
  const image = decode(dataUrl), size = image.getSize();
  if (image.isEmpty() || size.width <= 0 || size.height <= 0 || size.width * size.height > 64_000_000)
    throw new Error('复制失败：图片无法读取或尺寸过大');
  const png = new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' });
  await write([new ClipboardItem({ 'image/png': png })]);
}
