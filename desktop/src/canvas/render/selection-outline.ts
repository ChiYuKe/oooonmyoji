/** 预置卡片内侧描边，让后续只切换 selected 类的渲染也能显示金框。 */
export function appendSelectionOutline(
  group: SVGElement,
  svgEl: (tag: string, attrs: Record<string, unknown>, parent: SVGElement) => SVGElement,
  width: number,
  height: number,
  radius: number,
): void {
  svgEl('rect', {
    class: 'card-selection-outline',
    x: 1, y: 1, width: width - 2, height: height - 2, rx: radius - 1,
  }, group);
  // 端点仍需压在金框上方，且维持 circle + glyph 的相邻顺序以保留悬停反馈。
  group.querySelectorAll(':scope > .port, :scope > .port-glyph, :scope > .instance-variable-pin, :scope > .variable-port-hit')
    .forEach((port) => group.appendChild(port));
}
