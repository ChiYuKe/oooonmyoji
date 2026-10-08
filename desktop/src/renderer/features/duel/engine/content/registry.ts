import type { HeroDefinition, SoulDefinition, StatusDefinition } from '../core/definitions';

export class ContentRegistry {
  private readonly heroes = new Map<number, HeroDefinition>();
  private readonly souls = new Map<string, SoulDefinition>();
  private readonly statuses = new Map<string, StatusDefinition>();

  registerHero(definition: HeroDefinition): void {
    if (this.heroes.has(definition.id)) throw new Error(`Duplicate hero definition: ${definition.id}`);
    for (const skill of definition.skills) {
      if (skill.resourceCost && (!Number.isFinite(skill.resourceCost.amount) || skill.resourceCost.amount < 0)) {
        throw new Error(`Invalid resource cost for skill: ${skill.id}`);
      }
      if (skill.resourceCostsByLevel?.some(cost => !Number.isFinite(cost.amount) || cost.amount < 0 || !cost.resourceId)) {
        throw new Error(`Invalid level-based resource cost for skill: ${skill.id}`);
      }
      if (skill.alternatePayment && (!Number.isInteger(skill.alternatePayment.minSkillLevel) || skill.alternatePayment.minSkillLevel < 1
        || !Number.isInteger(skill.alternatePayment.meterStepsPerMissing ?? 1) || (skill.alternatePayment.meterStepsPerMissing ?? 1) < 1)) {
        throw new Error(`Invalid alternate payment for skill: ${skill.id}`);
      }
    }
    this.heroes.set(definition.id, definition);
  }

  registerSoul(definition: SoulDefinition): void {
    if (this.souls.has(definition.id)) throw new Error(`Duplicate soul definition: ${definition.id}`);
    this.souls.set(definition.id, definition);
  }

  registerStatus(definition: StatusDefinition): void {
    if (this.statuses.has(definition.id)) throw new Error(`Duplicate status definition: ${definition.id}`);
    this.statuses.set(definition.id, definition);
  }

  getHero(id: number): HeroDefinition | undefined { return this.heroes.get(id); }
  getSoul(id: string): SoulDefinition | undefined { return this.souls.get(id); }
  getStatus(id: string): StatusDefinition | undefined { return this.statuses.get(id); }
  heroDefinitions(): readonly HeroDefinition[] { return [...this.heroes.values()]; }
  soulDefinitions(): readonly SoulDefinition[] { return [...this.souls.values()]; }
  statusDefinitions(): readonly StatusDefinition[] { return [...this.statuses.values()]; }
}
