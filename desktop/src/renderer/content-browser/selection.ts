/** Shift uses the visible order and a stable anchor; Ctrl toggles individual items. */
export function contentSelectionGesture(order: readonly string[], current: ReadonlySet<string>, anchor: string,
  target: string, modifiers: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {},
): { paths: Set<string>; anchor: string } {
  const additive = modifiers.ctrlKey || modifiers.metaKey;
  const index = order.indexOf(target);
  if (index < 0) return { paths: new Set(current), anchor };
  if (modifiers.shiftKey) {
    const start = order.indexOf(anchor);
    const range = order.slice(Math.min(start < 0 ? index : start, index), Math.max(start < 0 ? index : start, index) + 1);
    return { paths: new Set(additive ? [...current, ...range] : range), anchor: start < 0 ? target : anchor };
  }
  const paths = additive ? new Set(current) : new Set<string>();
  if (paths.has(target)) paths.delete(target);
  else paths.add(target);
  return { paths, anchor: target };
}
