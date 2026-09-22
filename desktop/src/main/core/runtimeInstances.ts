import fs from 'node:fs';
import path from 'node:path';

export interface RuntimeInstanceInfo {
  id: string;
  backend?: string;
  adbSerial?: string;
  mumuIndex?: number;
  displayName?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Force machine-readable Python CLI output to use the UTF-8 decoding expected by Node. */
export function pythonUtf8Environment(
  environment: NodeJS.ProcessEnv,
  projectRoot?: string,
): NodeJS.ProcessEnv {
  const runtimeEnvironment: NodeJS.ProcessEnv = {
    ...environment,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    PYTHONNOUSERSITE: '1',
  };
  if (projectRoot) {
    const runtimeRoot = typeof environment.ONMYOJI_RUNTIME_ROOT === 'string'
      ? environment.ONMYOJI_RUNTIME_ROOT.trim()
      : '';
    const bundledModelCache = path.join(runtimeRoot || projectRoot, '.paddlex');
    if (fs.existsSync(bundledModelCache)) runtimeEnvironment.PADDLE_PDX_CACHE_HOME = bundledModelCache;
  }
  return runtimeEnvironment;
}

/**
 * 运行器优先使用项目随包携带的嵌入式 Python。这样发布目录不依赖接收者安装 Python，
 * 开发环境仍可回落到普通 venv / PATH。`ONMYOJI_PYTHON` 只作为明确的高级覆盖入口。
 */
export function resolvePythonRuntime(projectRoot: string, environment: NodeJS.ProcessEnv = process.env): string {
  const configured = typeof environment.ONMYOJI_PYTHON === 'string' ? environment.ONMYOJI_PYTHON.trim() : '';
  if (configured) return path.resolve(configured);
  const runtimeRoot = typeof environment.ONMYOJI_RUNTIME_ROOT === 'string'
    ? environment.ONMYOJI_RUNTIME_ROOT.trim()
    : '';
  if (runtimeRoot) {
    const downloaded = path.join(path.resolve(runtimeRoot), 'tools', 'python312-embed', 'python.exe');
    if (fs.existsSync(downloaded)) return downloaded;
  }
  const bundled = path.join(projectRoot, 'tools', 'python312-embed', 'python.exe');
  if (fs.existsSync(bundled)) return bundled;
  const venv = path.join(projectRoot, '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(venv)) return venv;
  return 'python';
}

/** 从运行配置中提取可供编辑器选择的实例，忽略空 ID 和重复项。 */
export function parseRuntimeInstances(raw: unknown): RuntimeInstanceInfo[] {
  const source = asRecord(raw).instances;
  if (!Array.isArray(source)) return [];
  const seen = new Set<string>();
  const instances: RuntimeInstanceInfo[] = [];
  for (const value of source) {
    const item = asRecord(value);
    if (item.enabled === false) continue;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const instance: RuntimeInstanceInfo = { id };
    if (typeof item.backend === 'string' && item.backend.trim()) instance.backend = item.backend.trim();
    if (typeof item.adb_serial === 'string' && item.adb_serial.trim()) instance.adbSerial = item.adb_serial.trim();
    if (typeof item.mumu_index === 'number' && Number.isInteger(item.mumu_index) && item.mumu_index >= 0) instance.mumuIndex = item.mumu_index;
    if (typeof item.display_name === 'string' && item.display_name.trim()) instance.displayName = item.display_name.trim();
    instances.push(instance);
  }
  return instances;
}

/** 请求值优先，其次使用工作区记忆值；没有在线设备时保持空值。 */
export function chooseRuntimeInstance(
  instances: RuntimeInstanceInfo[],
  requested?: string,
  persisted?: string,
): string {
  const ids = new Set(instances.map((item) => item.id));
  if (requested && ids.has(requested)) return requested;
  if (persisted && ids.has(persisted)) return persisted;
  return instances[0]?.id ?? '';
}
