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

/** 请求值优先，其次使用工作区记忆值，最后回退到第一个配置实例。 */
export function chooseRuntimeInstance(
  instances: RuntimeInstanceInfo[],
  requested?: string,
  persisted?: string,
): string {
  const ids = new Set(instances.map((item) => item.id));
  if (requested && ids.has(requested)) return requested;
  if (persisted && ids.has(persisted)) return persisted;
  return instances[0]?.id ?? 'mumu-0';
}
