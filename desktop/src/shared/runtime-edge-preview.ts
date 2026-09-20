/** 运行态连线预览是编辑器级偏好，不写入工作流文件。 */
export const RUNTIME_EDGE_PREVIEW_STORAGE_KEY = 'onmyoji-studio.canvas.runtime-edge-preview';

/** 默认开启；只有明确保存为 false 时才关闭，兼容已有用户配置。 */
export function readRuntimeEdgePreview(storage: Pick<Storage, 'getItem'>): boolean {
  try {
    return storage.getItem(RUNTIME_EDGE_PREVIEW_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function writeRuntimeEdgePreview(storage: Pick<Storage, 'setItem'>, enabled: boolean): void {
  try {
    storage.setItem(RUNTIME_EDGE_PREVIEW_STORAGE_KEY, String(enabled));
  } catch {
    // 偏好保存失败不应影响画布操作；当前会话的 DOM 状态仍然有效。
  }
}
