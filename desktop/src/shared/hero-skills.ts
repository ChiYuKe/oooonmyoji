export interface HeroSkill {
  id: number;
  name: string;
  icon: string;
  description: string;
  cost: number;
  type: number;
  upgrades: string[];
  extraSkills: HeroSkill[];
}

export interface HeroSkillsCatalog {
  updated: string;
  source: string;
  heroes: Record<number, { skills: HeroSkill[]; awakening: string }>;
}

/**
 * The in-game panel starts a skill description with the "唯一效果" marker on its own
 * line, but the catalog only carries that break for part of the heroes. Keep the
 * existing breaks and add the missing one after a leading marker.
 */
export function skillDescriptionText(description: string): string {
  const text = description.replace(/\r\n?/g, '\n').replace(/^\s+/, '').replace(/[ \t]+\n/g, '\n');
  if (/^[（(]?唯一效果[）)]?[。，,]?\n/.test(text)) return text;
  const lead = /^([（(]?唯一效果[）)]?[。，,]?)[ \t]*/.exec(text);
  if (!lead || lead[1].length === text.length) return text;
  return `${lead[1]}\n${text.slice(lead[0].length)}`;
}
