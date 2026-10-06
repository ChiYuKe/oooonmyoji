import { splitHeroSkillTerms } from '../../../shared/hero-skill-terms';
import type { HeroSkillTerm } from '../../../shared/hero-skill-terms';
import { appendEffectNumbers } from '../../ui/effect-text';

/** A single reusable top-layer tooltip, shared by all terms in the atlas. */
export function installShikigamiSkillTerms(root: HTMLElement): {
  append(parent: HTMLElement, text: string, terms: readonly HeroSkillTerm[]): void;
  close(): void;
  dispose(): void;
} {
  const doc = root.ownerDocument, view = doc.defaultView!;
  const popup = doc.createElement('div');
  popup.id = 'shikigami-skill-term-tooltip'; popup.className = 'shikigami-term-tooltip';
  popup.setAttribute('popover', 'manual'); popup.setAttribute('role', 'tooltip'); root.append(popup);
  const definitions = new WeakMap<HTMLElement, { term: HeroSkillTerm; terms: readonly HeroSkillTerm[] }>();
  let anchor: HTMLElement | undefined, timer = 0;
  const cancelClose = (): void => { view.clearTimeout(timer); timer = 0; };
  const close = (): void => {
    cancelClose(); anchor?.removeAttribute('aria-describedby'); anchor = undefined;
    if (popup.matches(':popover-open')) popup.hidePopover();
  };
  const later = (): void => { cancelClose(); timer = view.setTimeout(close, 120); };
  const termAt = (target: EventTarget | null): HTMLElement | undefined => {
    const node = target instanceof view.HTMLElement ? target.closest<HTMLElement>('.shikigami-skill-term') : null;
    return node && root.contains(node) ? node : undefined;
  };
  const add = (parent: HTMLElement, tag: string, text: string, className = ''): HTMLElement => {
    const node = doc.createElement(tag); node.className = className; node.textContent = text; parent.append(node); return node;
  };
  const open = (next: HTMLElement): void => {
    const entry = definitions.get(next); if (!entry || !next.isConnected) return;
    cancelClose(); anchor?.removeAttribute('aria-describedby'); anchor = next;
    popup.replaceChildren();
    const entries = [entry.term, ...(entry.term.related ?? []).flatMap(name => entry.terms.filter(term => term.name === name))];
    for (const term of entries) {
      const section = add(popup, 'section', '', 'shikigami-term-definition');
      const head = add(section, 'div', '', 'shikigami-term-heading');
      add(head, 'strong', term.name);
      if (term.category) add(head, 'span', term.category);
      appendEffectNumbers(add(section, 'p', ''), term.description);
    }
    if (!popup.matches(':popover-open')) popup.showPopover();
    next.setAttribute('aria-describedby', popup.id);
    const target = next.getBoundingClientRect(), rect = popup.getBoundingClientRect();
    const top = target.bottom + rect.height + 16 <= view.innerHeight ? target.bottom + 8 : target.top - rect.height - 8;
    popup.style.left = `${Math.max(8, Math.min(target.left, view.innerWidth - rect.width - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(top, view.innerHeight - rect.height - 8))}px`;
  };
  const over = (event: PointerEvent): void => { const term = termAt(event.target); if (term && event.pointerType !== 'touch') open(term); };
  const out = (event: PointerEvent): void => {
    const term = termAt(event.target);
    if (term && !(event.relatedTarget instanceof view.Node && (term.contains(event.relatedTarget) || popup.contains(event.relatedTarget)))) later();
  };
  const focus = (event: FocusEvent): void => { const term = termAt(event.target); if (term) open(term); };
  const blur = (event: FocusEvent): void => {
    if (termAt(event.target) && !(event.relatedTarget instanceof view.Node && popup.contains(event.relatedTarget))) later();
  };
  const click = (event: MouseEvent): void => { const term = termAt(event.target); if (term) open(term); };
  const leave = (event: PointerEvent): void => {
    if (!(event.relatedTarget instanceof view.Node && anchor?.contains(event.relatedTarget))) later();
  };
  const outside = (event: PointerEvent): void => {
    if (!(event.target instanceof view.Node && (popup.contains(event.target) || anchor?.contains(event.target)))) close();
  };
  const key = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && popup.matches(':popover-open')) { event.preventDefault(); event.stopPropagation(); close(); }
  };
  const scroll = (event: Event): void => { if (event.target !== popup && !(event.target instanceof view.Node && popup.contains(event.target))) close(); };
  const observer = new IntersectionObserver(entries => { if (!entries[0]?.isIntersecting) close(); }); observer.observe(root);
  root.addEventListener('pointerover', over); root.addEventListener('pointerout', out);
  root.addEventListener('focusin', focus); root.addEventListener('focusout', blur); root.addEventListener('click', click);
  root.addEventListener('scroll', scroll, true);
  popup.addEventListener('pointerenter', cancelClose); popup.addEventListener('pointerleave', leave);
  doc.addEventListener('pointerdown', outside, true); doc.addEventListener('keydown', key, true); view.addEventListener('resize', close);
  return {
    append(parent, text, terms): void {
      for (const part of splitHeroSkillTerms(text, terms)) {
        if (!part.term) { appendEffectNumbers(parent, part.text); continue; }
        const button = add(parent, 'button', part.text, 'shikigami-skill-term') as HTMLButtonElement;
        button.type = 'button'; button.setAttribute('aria-label', `${part.text}，查看解释`);
        definitions.set(button, { term: part.term, terms });
      }
    }, close,
    dispose(): void {
      close(); observer.disconnect();
      root.removeEventListener('pointerover', over); root.removeEventListener('pointerout', out);
      root.removeEventListener('focusin', focus); root.removeEventListener('focusout', blur); root.removeEventListener('click', click);
      root.removeEventListener('scroll', scroll, true);
      doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('keydown', key, true); view.removeEventListener('resize', close);
      popup.remove();
    },
  };
}
