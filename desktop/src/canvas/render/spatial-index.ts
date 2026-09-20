/**
 * 画布空间索引：固定网格，用于可见性判定、框选与连线命中测试的粗筛。
 *
 * 网格按世界坐标切分，格子大小固定；每个占用格子只存条目 id，条目矩形单独保存。
 * 查询返回的是**候选** id（可能落在格子边缘之外），调用方仍需做一次精确相交/距离判断。
 *
 * 索引不是渲染真值来源：渲染层始终以节点真实几何为准，索引只负责把 O(全部条目)
 * 的遍历降成 O(视口内条目)。
 */

export interface SpatialRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpatialPoint {
  x: number;
  y: number;
}

export interface SpatialEntry {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasSpatialIndex {
  /** 用当前条目重建索引（布局或结构变化时调用）。 */
  rebuild(entries: Iterable<SpatialEntry>): void;
  /** 与矩形相交的条目标识（粗筛）。 */
  candidates(rect: SpatialRect): string[];
  /** 与矩形精确相交的条目标识。 */
  queryRect(rect: SpatialRect): string[];
  /** 点命中的条目标识（粗筛，按条目顺序）。 */
  candidatesAt(x: number, y: number): string[];
  size(): number;
  isEmpty(): boolean;
  /** 索引占用的格子数（测试与基准统计用）。 */
  cellCount(): number;
}

export const DEFAULT_CELL_SIZE = 512;

export function rectsIntersect(
  a: SpatialRect,
  b: SpatialRect,
): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width
    && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

export function pointInRect(x: number, y: number, rect: SpatialRect): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function cellRange(min: number, max: number, cell: number): [number, number] {
  return [Math.floor(min / cell), Math.floor(max / cell)];
}

export function createSpatialIndex(cellSize: number = DEFAULT_CELL_SIZE): CanvasSpatialIndex {
  const cell = Math.max(1, cellSize);
  let cells = new Map<string, string[]>();
  let rects = new Map<string, SpatialRect>();
  let count = 0;

  function key(cx: number, cy: number): string {
    return `${cx}:${cy}`;
  }

  function rebuild(entries: Iterable<SpatialEntry>): void {
    cells = new Map();
    rects = new Map();
    count = 0;
    for (const entry of entries) {
      const rect: SpatialRect = { x: entry.x, y: entry.y, width: entry.width, height: entry.height };
      rects.set(entry.id, rect);
      count += 1;
      const [cx0, cx1] = cellRange(rect.x, rect.x + Math.max(0, rect.width), cell);
      const [cy0, cy1] = cellRange(rect.y, rect.y + Math.max(0, rect.height), cell);
      // 超大条目（跨越很多格子）直接放进「全局」桶，避免一次索引写入撑爆内存。
      if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 256) {
        add('*', entry.id);
        continue;
      }
      for (let cx = cx0; cx <= cx1; cx += 1) {
        for (let cy = cy0; cy <= cy1; cy += 1) add(key(cx, cy), entry.id);
      }
    }
  }

  function add(bucket: string, id: string): void {
    const list = cells.get(bucket);
    if (list) {
      if (!list.includes(id)) list.push(id);
      return;
    }
    cells.set(bucket, [id]);
  }

  function collect(rect: SpatialRect): string[] {
    const seen = new Set<string>();
    const [cx0, cx1] = cellRange(rect.x, rect.x + Math.max(0, rect.width), cell);
    const [cy0, cy1] = cellRange(rect.y, rect.y + Math.max(0, rect.height), cell);
    for (let cx = cx0; cx <= cx1; cx += 1) {
      for (let cy = cy0; cy <= cy1; cy += 1) {
        for (const id of cells.get(key(cx, cy)) || []) seen.add(id);
      }
    }
    for (const id of cells.get('*') || []) seen.add(id);
    return [...seen];
  }

  function candidates(rect: SpatialRect): string[] {
    return collect(rect);
  }

  function queryRect(rect: SpatialRect): string[] {
    const result: string[] = [];
    for (const id of collect(rect)) {
      const own = rects.get(id);
      if (own && rectsIntersect(rect, own)) result.push(id);
    }
    return result;
  }

  function candidatesAt(x: number, y: number): string[] {
    return collect({ x, y, width: 0, height: 0 });
  }

  return {
    rebuild,
    candidates,
    queryRect,
    candidatesAt,
    size: () => count,
    isEmpty: () => count === 0,
    cellCount: () => cells.size,
  };
}
