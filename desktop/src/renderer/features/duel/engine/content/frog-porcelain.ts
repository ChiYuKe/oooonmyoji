import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const frogPorcelainIds = {
  hero: 250,
  basic: '2501',
  passive: '2502',
  ultimate: '2503',
  reviveCooldown: 'status.hero.250.revive-cooldown',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [.49, .52, .54, .57, .59] as const;

export function registerFrogPorcelain(registry: ContentRegistry): void {
  registry.registerStatus({ id: frogPorcelainIds.reviveCooldown, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'source-turn', refreshPolicy: 'replace' });
  registry.registerHero(createFrogPorcelainDefinition());
}

export function createFrogPorcelainDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(frogPorcelainIds.basic, basicRatios);
  const ultimate: SkillDefinition = {
    id: frogPorcelainIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 1 },
    target: 'single', targetRelation: 'enemy', useClientDamageData: true,
    levels: ultimateRatios.map(ratio => ({ ratio, dice: true })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0]!);
      if (!actor || !target || target.hp <= 0) return [];
      return throwDice(context, actor, target, Number(parameters.ratio ?? .49));
    },
  };
  return {
    id: frogPorcelainIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入出千技能倍率、岭上开花1火/掷1至6点并按点数造成等段伤害，以及转运阵亡时对每名敌方分别掷点、出现重复点数即复活并按最小重复点数恢复生命且冷却取最大重复点数；冷却的抵抗/封印边界、实际骰面分布与各段御魂交互仍需录像核验'],
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0) return undefined;
      const enemy = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue')[0];
      if (!enemy) return undefined;
      return context.state.resources[actor.side]?.fire >= 1
        ? frogIntent(actor.unitId, frogPorcelainIds.ultimate, enemy.unitId)
        : frogIntent(actor.unitId, frogPorcelainIds.basic, enemy.unitId);
    },
    handlers: { 'unit-defeated': { priority: 42, handle(context, event) { return resolveFortune(context, event); } } },
  };
}

function throwDice(context: BattleContext, actor: Readonly<import('../core/types').UnitState>, target: Readonly<import('../core/types').UnitState>,
  ratio: number, parentEventId?: string): EffectCommand[] {
  const pips = Math.floor(context.random() * 6) + 1;
  const attack = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
  const source = frogSource(frogPorcelainIds.ultimate, actor.unitId);
  return Array.from({ length: pips }, (_, index) => {
    const hit = context.calculateDamage({ attack: attack.attack, defense, defenseIgnore: effectiveDefenseIgnore(actor),
      ratio, critChance: attack.crit, critDamage: attack.critDamage }, actor, target);
    return { type: 'deal-damage' as const, source, targetId: target.unitId,
      amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
      ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, attack.critDamage) } : {}),
      isCritical: hit.isCritical, ...(parentEventId ? { parentEventId } : {}) };
  });
}

function resolveFortune(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const frog = context.getUnit(event.unitId);
  if (!frog || frog.hp > 0 || frog.heroId !== frogPorcelainIds.hero || frog.unitKind === 'summon' || !passivesEnabled(frog)
    || frog.statuses.some(status => status.statusId === frogPorcelainIds.reviveCooldown)) return;
  const enemies = context.getLivingUnits(frog.side === 'blue' ? 'red' : 'blue');
  if (enemies.length === 0) return;

  const rolls = enemies.map(() => Math.floor(context.random() * 6) + 1);
  const commands: EffectCommand[] = [];
  for (let index = 0; index < enemies.length; index += 1) {
    const target = enemies[index]!;
    commands.push(...throwDice(context, frog, target, ultimateRatios[Math.max(0, Math.min(4, frog.skillLevel - 1))]!,
      event.eventId));
  }

  const counts = new Map<number, number>();
  for (const roll of rolls) counts.set(roll, (counts.get(roll) ?? 0) + 1);
  const repeats = [...counts].filter(([, count]) => count >= 2).map(([roll]) => roll);
  if (repeats.length === 0) return commands;

  const minimumRepeat = Math.min(...repeats), maximumRepeat = Math.max(...repeats);
  const source = frogSource(frogPorcelainIds.passive, frog.unitId);
  const cooldown: StatusInstance = { instanceId: `${frogPorcelainIds.reviveCooldown}:${frog.unitId}:${event.eventId}`,
    statusId: frogPorcelainIds.reviveCooldown, source, stacks: 1,
    duration: { kind: 'count', remaining: maximumRepeat, owner: 'source-turn' },
    values: { cooldown: maximumRepeat, repeatedPips: minimumRepeat } };
  commands.push({ type: 'revive', source, targetId: frog.unitId,
    hp: frog.stats.hp * .1 * minimumRepeat, parentEventId: event.eventId });
  commands.push({ type: 'add-status', source, targetId: frog.unitId, instance: cooldown, parentEventId: event.eventId });
  return commands;
}

function frogIntent(actorId: string, skillId: string, targetId: string): ActionIntent {
  return { actorId, skillId, targetIds: [targetId], shape: 'single', targetRelation: 'enemy' };
}

function frogSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
