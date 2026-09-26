/** `.owf` 二元数组与图文档坐标对象之间的转换。 */
import { isNumber, isRecord, setKey } from './support';
import { POSITION_KEYS, SIZE_KEYS } from './syntax';

export function decodePosition(value: any): any {
  if (Array.isArray(value) && value.length === 2 && value.every((item) => isNumber(item))) {
    return { x: value[0], y: value[1] };
  }
  return value;
}

export function decodeSize(value: any): any {
  if (Array.isArray(value) && value.length === 2 && value.every((item) => isNumber(item))) {
    return { w: value[0], h: value[1] };
  }
  return value;
}

/** 把映射中的位置和尺寸字段从数组表示转换成图文档对象。 */
export function decodePositions(mapping: Record<string, any>): Record<string, any> {
  for (const key of POSITION_KEYS) {
    const value = mapping[key];
    if (Array.isArray(value) && value.length === 2 && value.every((item) => isNumber(item))) {
      setKey(mapping, key, decodePosition(value));
    }
  }
  for (const key of SIZE_KEYS) {
    const value = mapping[key];
    if (Array.isArray(value) && value.length === 2 && value.every((item) => isNumber(item))) {
      setKey(mapping, key, decodeSize(value));
    }
  }
  return mapping;
}

/** 把图文档折点对象转换成适合行内输出的坐标对。 */
export function pointsToPairs(waypoints: any): number[][] | null {
  if (!Array.isArray(waypoints)) return null;
  const pairs: number[][] = [];
  for (const point of waypoints) {
    if (
      !isRecord(point) ||
      Object.keys(point).length !== 2 ||
      !Object.hasOwn(point, 'x') ||
      !Object.hasOwn(point, 'y') ||
      !isNumber(point.x) ||
      !isNumber(point.y)
    ) {
      return null;
    }
    pairs.push([point.x, point.y]);
  }
  return pairs;
}

/** 把文本中的折点坐标对恢复成图文档对象；形状不匹配时保留原值。 */
export function pairsToPoints(value: any): any {
  if (!Array.isArray(value)) return value;
  const points: Array<{ x: number; y: number }> = [];
  for (const pair of value) {
    if (!(Array.isArray(pair) && pair.length === 2 && pair.every((item) => isNumber(item)))) return value;
    points.push({ x: pair[0], y: pair[1] });
  }
  return points;
}
