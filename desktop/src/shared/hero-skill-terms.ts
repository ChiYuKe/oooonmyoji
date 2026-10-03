import { skillDescriptionText } from './hero-skills';
import type { HeroSkill } from './hero-skills';

export interface HeroSkillTerm {
  name: string;
  description: string;
  category?: string;
  related?: string[];
}

// The supplied in-game skill panel provides these mark definitions.
const COMMON_TERMS: readonly HeroSkillTerm[] = [
  { name: '唯一效果', description: '若是有多个同名式神在场，只有其中一个式神的此技能会生效。' },
];
const HERO_TERMS: Readonly<Record<number, readonly HeroSkillTerm[]>> = {
  354: [
    { name: '羽授', category: '通用 · 印记', description: '队友每回合首次普攻时，待宵姑获鸟必然协战并消耗1层羽授。协战后，该队友获得1层羽念。', related: ['羽念'] },
    { name: '羽念', category: '增益 · 印记', description: '永久提升自身攻击力的10%，最多叠加5层。' },
  ],
};

/** Names are scoped to the hero: identical skill names can have different effects. */
export function heroSkillTerms(heroId: number, skills: readonly HeroSkill[]): HeroSkillTerm[] {
  const terms = new Map<string, HeroSkillTerm>();
  const collect = (items: readonly HeroSkill[]): void => {
    for (const skill of items) {
      if (skill.name && skill.description) terms.set(skill.name, { name: skill.name, description: skillDescriptionText(skill.description), category: '技能' });
      collect(skill.extraSkills);
    }
  };
  collect(skills);
  for (const term of [...COMMON_TERMS, ...(HERO_TERMS[heroId] ?? [])]) terms.set(term.name, term);
  return [...terms.values()].sort((a, b) => b.name.length - a.name.length);
}

export interface HeroSkillTextPart { text: string; term?: HeroSkillTerm }

/** Match literally, prefer longer names, and preserve every original character. */
export function splitHeroSkillTerms(text: string, terms: readonly HeroSkillTerm[]): HeroSkillTextPart[] {
  const names = new Map(terms.filter(term => term.name).map(term => [term.name, term]));
  if (!names.size) return [{ text }];
  const pattern = [...names.keys()].sort((a, b) => b.length - a.length)
    .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const parts: HeroSkillTextPart[] = [];
  let offset = 0;
  for (const match of text.matchAll(new RegExp(pattern, 'g'))) {
    if (match.index > offset) parts.push({ text: text.slice(offset, match.index) });
    parts.push({ text: match[0], term: names.get(match[0]) });
    offset = match.index + match[0].length;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset) });
  return parts.length ? parts : [{ text }];
}
