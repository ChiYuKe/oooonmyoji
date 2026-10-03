export function plainText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
      const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
      if (named[code.toLowerCase()] !== undefined) return named[code.toLowerCase()];
      const point = code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    })
    .replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function stableSearchId(source: string, url: string): string {
  let hash = 2166136261;
  for (const character of `${source}:${url}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `SRCH-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
