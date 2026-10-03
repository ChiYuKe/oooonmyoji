/** Emphasize effect values without interpreting catalog text as HTML. */
export function appendEffectNumbers(parent: HTMLElement, text: string, className = 'effect-number'): void {
  const doc = parent.ownerDocument;
  let offset = 0;
  for (const match of text.matchAll(/[+-]?\d+(?:\.\d+)?[%％]?/g)) {
    parent.append(doc.createTextNode(text.slice(offset, match.index)));
    const number = doc.createElement('strong');
    number.className = className; number.textContent = match[0]; parent.append(number);
    offset = match.index + match[0].length;
  }
  parent.append(doc.createTextNode(text.slice(offset)));
}
