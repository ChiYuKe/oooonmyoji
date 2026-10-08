import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import { calculateIndirectDamage } from '../mechanics/indirect-damage';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const twoFacedBuddhaIds = {
  hero: 258,
  basic: '2581',
  passive: '2582',
  ultimate: '2583',
  defenseDown: 'status.hero.258.defense-down',
  attackDown: 'status.hero.258.attack-down',
  basicWind: 'status.hero.258.basic-wind-damage',
  ultimateWind: 'status.hero.258.ultimate-wind-damage',
} as const;

const thunderBasic = [1, 1.05, 1.1, 1.15, 1.25] as const;
const windBasic = [.25, .27, .28, .29, .32] as const;
const basicWindDamage = [1.25, 1.32, 1.38, 1.44, 1.57] as const;
const thunderUltimate = [.44, .47, .49, .51, .55] as const;
const windUltimate = [.11, .12, .13, .14, .15] as const;
const ultimateWindDamage = [.55, .59, .61, .64, .69] as const;
const passiveReduction = [.1, .12, .14, .16, .18] as const;
const gaugeRate = .08;

export function registerTwoFacedBuddha(registry: ContentRegistry): void {
  registry.registerStatus({ id: twoFacedBuddhaIds.defenseDown, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: twoFacedBuddhaIds.attackDown, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus(createWindDamageStatus(twoFacedBuddhaIds.basicWind));
  registry.registerStatus(createWindDamageStatus(twoFacedBuddhaIds.ultimateWind));
  registry.registerHero(createTwoFacedBuddhaDefinition());
}

export function createTwoFacedBuddhaDefinition(): HeroDefinition {
  return {
    id: twoFacedBuddhaIds.hero,
    skills: [createBasic(), createUltimate()],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已按客户端技能数据接入雷神/风神逐次随机、普攻与群攻倍率、风神回合后间接伤害、被动攻防降低及五级条件行动条变化；伤害与减益的精确先后、抵抗规则和行动条实际帧仍需核对'],
    policy(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const skillId = (context.state.resources[owner.side]?.fire ?? 0) >= 3
        ? twoFacedBuddhaIds.ultimate : twoFacedBuddhaIds.basic;
      const targets = skillId === twoFacedBuddhaIds.ultimate ? enemies.map(enemy => enemy.unitId)
        : [enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!.unitId];
      return { actorId: unitId, skillId, targetIds: targets,
        shape: skillId === twoFacedBuddhaIds.ultimate ? 'all-enemies' : 'single', targetRelation: 'enemy' };
    },
  };
}

function createBasic(): SkillDefinition {
  return { id: twoFacedBuddhaIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: thunderBasic.map((ratio, index) => ({ thunderRatio: ratio, windRatio: windBasic[index]!, dotRatio: basicWindDamage[index]! })),
    execute(context, intent, parameters) {
      const target = intent.targetIds.map(id => context.getUnit(id)).find(unit => unit && unit.hp > 0);
      if (!target) return [];
      const isThunder = context.random() < .5;
      return faceHit(context, intent.actorId, target, twoFacedBuddhaIds.basic,
        isThunder ? Number(parameters.thunderRatio ?? 1) : Number(parameters.windRatio ?? .25),
        isThunder ? 'thunder' : 'wind', Number(parameters.dotRatio ?? 1.25));
    } };
}

function createUltimate(): SkillDefinition {
  return { id: twoFacedBuddhaIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy',
    levels: thunderUltimate.map((ratio, index) => ({ thunderRatio: ratio, windRatio: windUltimate[index]!, dotRatio: ultimateWindDamage[index]! })),
    execute(context, intent, parameters) {
      const commands: EffectCommand[] = [];
      for (const targetId of intent.targetIds) {
        for (let hit = 0; hit < 3; hit++) {
          const target = context.getUnit(targetId);
          if (!target || target.hp <= 0 || target.side === context.getUnit(intent.actorId)?.side) break;
          const isThunder = context.random() < .5;
          commands.push(...faceHit(context, intent.actorId, target, twoFacedBuddhaIds.ultimate,
            isThunder ? Number(parameters.thunderRatio ?? .44) : Number(parameters.windRatio ?? .11),
            isThunder ? 'thunder' : 'wind', Number(parameters.dotRatio ?? .55)));
        }
      }
      return commands;
    } };
}

function faceHit(context: BattleContext, actorId: string, target: Readonly<UnitState>, skillId: string,
  ratio: number, face: 'thunder' | 'wind', dotRatio: number): EffectCommand[] {
  const owner = context.getUnit(actorId);
  const attack = context.getEffectiveStats(actorId);
  const defense = context.getEffectiveStats(target.unitId);
  if (!owner || !attack || !defense) return [];
  const hit = context.calculateDamage({ attack: attack.attack, defense: defense.defense,
    defenseIgnore: effectiveDefenseIgnore(owner), ratio, critChance: attack.crit, critDamage: attack.critDamage }, owner, target);
  const skillSource = twoFaceSource(skillId, actorId);
  const commands: EffectCommand[] = [{ type: 'deal-damage', source: skillSource, targetId: target.unitId,
    amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];

  if (face === 'wind') {
    const dotStatus = skillId === twoFacedBuddhaIds.basic ? twoFacedBuddhaIds.basicWind : twoFacedBuddhaIds.ultimateWind;
    const mark = attemptDebuff(context, { source: skillSource, targetId: target.unitId, statusId: dotStatus,
      baseChance: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
      values: { indirectDamageRatio: dotRatio },
      parentEventId: undefined });
    commands.push(...mark);
  }

  if (passivesEnabled(owner)) {
    const passiveLevel = skillRank(owner, twoFacedBuddhaIds.passive);
    const isThunder = face === 'thunder';
    const debuff = attemptDebuff(context, { source: twoFaceSource(twoFacedBuddhaIds.passive, actorId), targetId: target.unitId,
      statusId: isThunder ? twoFacedBuddhaIds.defenseDown : twoFacedBuddhaIds.attackDown,
      baseChance: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
      modifiers: [{ stat: isThunder ? 'defense' : 'attack', operation: 'percent', amount: -passiveReduction[passiveLevel - 1]! }] });
    commands.push(...debuff);
    if (passiveLevel >= 5 && isThunder && attack.attack > defense.attack) {
      commands.push({ type: 'change-action-gauge', source: twoFaceSource(twoFacedBuddhaIds.passive, actorId),
        targetId: target.unitId, amount: -100 * gaugeRate });
    }
  }
  return commands;
}

function createWindDamageStatus(id: string): StatusDefinition {
  return { id, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace',
    handlers: { 'turn-end': { priority: 78, handle(context, event) { return tickWindDamage(context, event, id); } } } };
}

function tickWindDamage(context: BattleContext, event: BattleEvent, statusId: string): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const target = context.getUnit(event.unitId);
  if (!target || target.hp <= 0) return;
  const commands: EffectCommand[] = [];
  for (const mark of target.statuses.filter(status => status.statusId === statusId)) {
    const owner = mark.source.unitId ? context.getUnit(mark.source.unitId) : undefined;
    const ownerStats = owner && context.getEffectiveStats(owner.unitId);
    if (!owner || !ownerStats) continue;
    const targetStats = context.getEffectiveStats(target.unitId);
    if (!targetStats) continue;
    const attack = ownerStats.attack;
    const ratio = Number(mark.values?.indirectDamageRatio ?? (statusId === twoFacedBuddhaIds.basicWind ? 1.25 : .55));
    const hit = calculateIndirectDamage({ attack, defense: targetStats.defense, ratio, critDamage: ownerStats.critDamage }, context.random);
    commands.push({ type: 'lose-life', source: mark.source, targetId: target.unitId,
      amount: hit.amount, lifeLossKind: 'indirect', parentEventId: event.eventId });
    if (owner.heroId === twoFacedBuddhaIds.hero
      && skillRank(owner, twoFacedBuddhaIds.passive) >= 5 && passivesEnabled(owner)
      && targetStats.defense < ownerStats.defense) {
      commands.push({ type: 'change-action-gauge', source: twoFaceSource(twoFacedBuddhaIds.passive, owner.unitId),
        targetId: owner.unitId, amount: 100 * gaugeRate, parentEventId: event.eventId });
    }
  }
  return commands;
}

function skillRank(owner: Readonly<UnitState> | undefined, skillId: string): number {
  return Math.max(1, Math.min(5, owner?.skillLevels?.[skillId] ?? owner?.skillLevel ?? 1));
}
function twoFaceSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
