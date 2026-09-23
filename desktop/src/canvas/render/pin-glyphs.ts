/**
 * 端点形状：UE 蓝图里执行流端点是**箭头**，数据端点是圆环或实心圆，
 * 右缘接一枚朝右的小三角。
 *
 * 卡片仍然保留原来的 `<circle class="port port-in/out">` 作为几何与命中载体
 * （位置公式、半径、事件绑定、缩放分级都按它算），箭头只是紧跟其后的
 * `<path class="port-glyph">`。于是端点的布局与命中测试完全不变，
 * 变的只有「画出来是什么形状」。
 *
 * 画布的执行流自上而下（父节点底边 → 子节点顶边），所以箭头一律朝下：
 * 顶边的入口箭头指向卡内、底边的出口箭头指向卡外，方向和线的走向一致。
 */

/** 保留两位小数：几何常数乘出来是一串浮点尾巴，写进 `d` 只会让 DOM 变长。 */
function n(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 执行端点箭头：UE 使用的是很小的实心三角形，不是带柄的五边形。
 * 端点的圆仍作为命中载体保留，三角形只负责可见形状。
 */
export function execPinArrow(cx: number, cy: number, radius = 7): string {
  const halfWidth = n(radius * 0.58);
  const base = n(cy - radius * 0.38);
  const tip = n(cy + radius * 0.52);
  return `M ${n(cx - halfWidth)} ${base}`
    + ` L ${n(cx + halfWidth)} ${base}`
    + ` L ${n(cx)} ${tip} Z`;
}

/** 数据端点：在圆点外侧留一丝间距，接一枚轻巧的方向尖角。 */
export function dataPinArrow(cx: number, cy: number, radius = 5): string {
  const base = n(cx + radius + 0.35);
  const tip = n(cx + radius + Math.min(2.8, radius * 0.6));
  const halfHeight = n(Math.min(1.4, radius * 0.3));
  return `M ${base} ${n(cy - halfHeight)}`
    + ` L ${tip} ${n(cy)}`
    + ` L ${base} ${n(cy + halfHeight)} Z`;
}
