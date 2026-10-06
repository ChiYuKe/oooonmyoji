import { createElement, Swords, Skull, HeartPulse, Shield, Ban, Gauge, Flame, Sparkles, CircleHelp, RotateCcw, Flag, Trophy } from 'lucide';
import { soulCatalog } from '../../../../shared/soul-catalog-data';
import { heroSkillsCatalog } from '../../../../shared/hero-skills-data';
import { appendPickerPortrait } from '../../souls/optimizer/picker';

type LogSide = 'blue' | 'red' | 'neutral';
export type BattleLogGroup = {
  phase: 'opening' | 'action' | 'ending';
  side: LogSide;
  action: number | null;
  actor: string;
  headline: string;
  lines: string[];
};

// Arrival information precedes the action header and belongs to that next action.
export function groupBattleLog(lines: string[]): BattleLogGroup[] {
  const groups: BattleLogGroup[] = [];
  let current: BattleLogGroup | undefined;
  let arrival: string | undefined;
  for (const source of lines) {
    const line = source.trim();
    if (line.startsWith('行动条到达顺序：')) { arrival = line; continue; }
    const action = /^行动\s+(\d+)｜(蓝方|红方)·(.+?)((?:使用|受|沉默中).*)$/.exec(line);
    if (action) {
      current = { phase: 'action', side: action[2] === '蓝方' ? 'blue' : 'red', action: Number(action[1]), actor: action[3], headline: action[4], lines: arrival ? [arrival] : [] };
      arrival = undefined; groups.push(current);
    } else if (line.startsWith('样例对局结束')) {
      current = { phase: 'ending', side: 'neutral', action: null, actor: '', headline: '对局结束', lines: [line] };
      groups.push(current);
    } else {
      if (!current) {
        current = { phase: 'opening', side: 'neutral', action: null, actor: '', headline: '开局信息', lines: [] };
        groups.push(current);
      }
      if (arrival) { current.lines.push(arrival); arrival = undefined; }
      current.lines.push(line);
    }
  }
  if (arrival) {
    if (current) current.lines.push(arrival);
    else groups.push({ phase: 'opening', side: 'neutral', action: null, actor: '', headline: '开局信息', lines: [arrival] });
  }
  return groups;
}

function eventKind(line: string): { kind: string; label: string; detail: boolean } {
  if (/剩余生命\s*0(?:[；。，]|$)/.test(line)) return { kind: 'defeat', label: '击败', detail: false };
  if (/点生命伤害|点伤害|反击|反伤/.test(line)) return { kind: 'damage', label: '伤害', detail: false };
  if (/复活/.test(line)) return { kind: 'heal', label: '复活', detail: false };
  if (/治疗|吸血/.test(line)) return { kind: 'heal', label: '治疗', detail: false };
  if (/控制生效|驱散/.test(line)) return { kind: 'control', label: line.startsWith('驱散') ? '驱散' : '控制', detail: false };
  if (/行动条到达顺序/.test(line)) return { kind: 'state', label: '行动条', detail: true };
  if (/行动条|额外行动/.test(line)) return { kind: 'gauge', label: '行动条', detail: false };
  if (/鬼火|自然回火/.test(line)) return { kind: 'resource', label: '鬼火', detail: true };
  if (/尚未建模/.test(line)) return { kind: 'state', label: '说明', detail: true };
  if (/状态变化/.test(line)) return { kind: 'state', label: '状态', detail: true };
  if (/护盾|庇护|共鸣之墙/.test(line)) return { kind: 'shield', label: '护盾', detail: false };
  return { kind: 'effect', label: '效果', detail: false };
}

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag); node.className = className; node.textContent = text; return node;
}

const eventIcons: Record<string, Parameters<typeof createElement>[0]> = {
  damage: Swords, defeat: Skull, heal: HeartPulse, shield: Shield, control: Ban,
  gauge: Gauge, resource: Flame, state: CircleHelp, effect: Sparkles,
};
function appendIcon(parent: HTMLElement, icon: Parameters<typeof createElement>[0]): void {
  const svg = createElement(icon, { width: 14, height: 14, 'stroke-width': 1.8, 'aria-hidden': 'true', focusable: 'false' });
  svg.classList.add('duel-log-icon'); parent.append(svg);
}

function appendSkillIcon(parent: HTMLElement, actor: string, headline: string): void {
  const hero = soulCatalog.heroes.find(profile => profile.name === actor);
  const name = /「([^」]+)」/.exec(headline)?.[1];
  const skills = hero ? heroSkillsCatalog.heroes[hero.id]?.skills ?? [] : [];
  const skill = [...skills, ...skills.flatMap(item => item.extraSkills)].find(item => item.name === name);
  const frame = element(parent.ownerDocument, 'span', 'duel-log-skill-icon');
  appendIcon(frame, /跳过行动/.test(headline) ? Ban : Swords);
  if (skill?.icon) {
    const image = parent.ownerDocument.createElement('img');
    image.src = `onmyoji-resource://project/assets/skill-icons/${skill.icon}.png`;
    image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
    image.addEventListener('error', () => image.remove(), { once: true });
    frame.append(image);
  }
  frame.setAttribute('aria-hidden', 'true'); parent.append(frame);
}

function appendHighlighted(node: HTMLElement, text: string): void {
  const pattern = /(蓝方|红方)|(\d+(?:\.\d+)?%?)/g;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    node.append(text.slice(offset, match.index));
    const className = match[1] ? `duel-log-${match[1] === '蓝方' ? 'blue' : 'red'}` : 'duel-event-number';
    node.append(element(node.ownerDocument, 'span', className, match[0]));
    offset = match.index! + match[0].length;
  }
  node.append(text.slice(offset));
}

export function renderBattleLog(doc: Document, lines: string[]): HTMLOListElement {
  const entries = element(doc, 'ol', 'duel-action-list');
  for (const group of groupBattleLog(lines)) {
    const card = element(doc, 'li', `duel-log-group duel-log-group-${group.side}`);
    card.dataset.logSide = group.side;
    const heading = element(doc, 'div', 'duel-action-heading');
    if (group.phase === 'action') {
      heading.append(element(doc, 'span', 'duel-action-number', `行动 ${group.action}`));
      heading.append(element(doc, 'span', `duel-action-side duel-log-${group.side}`, group.side === 'blue' ? '蓝方' : '红方'));
      const actor = element(doc, 'strong', 'duel-action-actor');
      const hero = soulCatalog.heroes.find(profile => profile.name === group.actor);
      if (hero) appendPickerPortrait(actor, 'hero', hero.id, hero.name);
      actor.append(group.actor); heading.append(actor);
      const action = element(doc, 'p', 'duel-action-skill');
      appendSkillIcon(action, group.actor, group.headline);
      const fire = /（鬼火[^）]*）/.exec(group.headline);
      const headline = group.headline.replace(/（鬼火[^）]*）/, '').replace(/。$/, '');
      const body = element(doc, 'span', 'duel-action-skill-body');
      appendHighlighted(body, headline);
      if (fire) {
        const resource = element(doc, 'small', 'duel-action-fire');
        appendIcon(resource, Flame); resource.append(fire[0].slice(1, -1)); body.append(resource);
      }
      action.append(body);
      card.append(heading, action);
    } else {
      appendIcon(heading, group.phase === 'opening' ? Flag : Trophy);
      heading.append(element(doc, 'strong', '', group.headline)); card.append(heading);
    }
    const details = element(doc, 'details', 'duel-action-details');
    const extra = element(doc, 'div', 'duel-action-extra');
    let detailCount = 0;
    for (const line of group.lines) {
      const event = eventKind(line);
      const row = element(doc, 'div', `duel-log-event duel-event-${event.kind}`);
      if (group.phase === 'action') {
        const badge = element(doc, 'span', 'duel-event-kind');
        appendIcon(badge, event.label === '复活' ? RotateCcw : event.label === '驱散' ? Sparkles : eventIcons[event.kind]);
        badge.append(event.label); row.append(badge);
        const trigger = /针女触发|狰反击|蝠翼吸血/.exec(line)?.[0];
        const soul = trigger && soulCatalog.suits.find(profile => trigger.startsWith(profile.name));
        if (soul) appendPickerPortrait(row, 'soul', soul.id, soul.name);
      }
      const content = element(doc, 'p', 'duel-event-text');
      // Long status inventories are still available under the action's details.
      const [main, status] = line.split('；状态：');
      appendHighlighted(content, main);
      row.append(content);
      if (event.detail || group.phase === 'opening') { extra.append(row); detailCount++; }
      else card.append(row);
      if (status) {
        const state = element(doc, 'p', 'duel-event-state');
        appendHighlighted(state, `${main.split('：')[0]} · 状态：${status}`);
        extra.append(state); detailCount++;
      }
    }
    if (detailCount) {
      details.append(element(doc, 'summary', '', group.phase === 'opening' ? `展开开局信息 · ${detailCount} 条` : `状态与补充信息 · ${detailCount} 条`), extra);
      card.append(details);
    }
    entries.append(card);
  }
  return entries;
}
