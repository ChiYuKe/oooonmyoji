import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import { calculateIndirectDamage } from '../mechanics/indirect-damage';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const kiyohimeIds = {
  hero: 260,
  basic: '2601',
  passive: '2602',
  ultimate: '2603',
  poison: 'status.hero.260.poison',
  permanentDefenseLoss: 'status.hero.260.permanent-defense-loss',
  burningFire: 'status.hero.260.burning-fire',
} as const;

const basicRatios = [.86, .9, .94, .98, 1.02, 1.02] as const;
const basicBurnRatios = [.22, .22, .22, .22, .22, .33] as const;
const ultimateRatios = [.36, .38, .4, .42, .42] as const;
const ultimateBurnRatios = [.66, .66, .66, .66, .99] as const;
const defenseLossPerPoison = 10;
const maxPoisonStacks = 9;

export function registerKiyohime(registry: ContentRegistry): void {
  registry.registerStatus({ id: kiyohimeIds.poison, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'add-stack',
    stackScope: 'source-unit', maxStacks: maxPoisonStacks,
  });
  registry.registerStatus({ id: kiyohimeIds.permanentDefenseLoss, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus(createBurningFireStatus());
  registry.registerHero(createKiyohimeDefinition());
}

export function createKiyohimeDefinition(): HeroDefinition {
  return {
    id: kiyohimeIds.hero,
    skills: [createBasic(), createUltimate()],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已按客户端数据接入6级普攻倍率/3级中毒5回合/焚火间接伤害，淬毒按每次中毒应用永久降低防御且共享上限，以及3火三段群攻逐击施毒并附加焚火；毒层对速度与受击防御的层数解释、焚火结算与御魂联动仍需连续帧核验'],
    handlers: {
      'effect-resolution': { priority: 118, handle(context, event) { return reduceDefenseOnPoison(context, event); } },
    },
    policy(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if ((context.state.resources[owner.side]?.fire ?? 0) >= 3) return { actorId: unitId, skillId: kiyohimeIds.ultimate,
        targetIds: enemies.map(enemy => enemy.unitId), shape: 'all-enemies', targetRelation: 'enemy' };
      const target = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      return { actorId: unitId, skillId: kiyohimeIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
}

function createBasic(): SkillDefinition {
  return { id: kiyohimeIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map((ratio, index) => ({ ratio, burnRatio: basicBurnRatios[index]!, poisonChance: 1 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = intent.targetIds.map(id => context.getUnit(id)).find(unit => unit && unit.hp > 0);
      if (!actor || !target) return [];
      const commands = damage(context, actor, target, kiyohimeIds.basic, Number(parameters.ratio ?? .86));
      commands.push(...applyPoison(context, actor, target, kiyohimeIds.basic, Number(parameters.poisonChance ?? 1)));
      commands.push(...applyBurningFire(context, actor, target, Number(parameters.burnRatio ?? .22)));
      return commands;
    } };
}

function createUltimate(): SkillDefinition {
  return { id: kiyohimeIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy',
    levels: ultimateRatios.map((ratio, index) => ({ ratio, burnRatio: ultimateBurnRatios[index]!, poisonChance: 1, hits: 3 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const commands: EffectCommand[] = [];
      const targets = intent.targetIds.map(id => context.getUnit(id)).filter((unit): unit is UnitState => Boolean(unit && unit.hp > 0 && unit.side !== actor.side));
      for (const target of targets) {
        for (let hit = 0; hit < Number(parameters.hits ?? 3); hit++) {
          const liveTarget = context.getUnit(target.unitId);
          if (!liveTarget || liveTarget.hp <= 0) break;
          commands.push(...damage(context, actor, liveTarget, kiyohimeIds.ultimate, Number(parameters.ratio ?? .36)));
          commands.push(...applyPoison(context, actor, liveTarget, kiyohimeIds.ultimate, Number(parameters.poisonChance ?? 1)));
        }
        const liveTarget = context.getUnit(target.unitId);
        if (liveTarget && liveTarget.hp > 0)
          commands.push(...applyBurningFire(context, actor, liveTarget, Number(parameters.burnRatio ?? .66)));
      }
      return commands;
    } };
}

function damage(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, skillId: string, ratio: number): EffectCommand[] {
  const attack = context.getEffectiveStats(actor.unitId), defense = context.getEffectiveStats(target.unitId);
  if (!attack || !defense) return [];
  const hit = context.calculateDamage({ attack: attack.attack, defense: defense.defense,
    defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: attack.crit, critDamage: attack.critDamage }, actor, target);
  return [{ type: 'deal-damage', source: kiyohimeSource(skillId, actor.unitId), targetId: target.unitId,
    amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
}

function applyPoison(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, skillId: string,
  chance: number): EffectCommand[] {
  return attemptDebuff(context, { source: kiyohimeSource(skillId, actor.unitId), targetId: target.unitId,
    statusId: kiyohimeIds.poison, baseChance: chance, duration: { kind: 'count', remaining: 5, owner: 'target-turn' },
    stacks: 3, modifiers: [{ stat: 'speed', operation: 'percent', amount: -.1, perStack: true },
      { stat: 'defense', operation: 'flat', amount: -defenseLossPerPoison, perStack: true }] });
}

function applyBurningFire(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, ratio: number): EffectCommand[] {
  return attemptDebuff(context, { source: kiyohimeSource(kiyohimeIds.burningFire, actor.unitId), targetId: target.unitId,
    statusId: kiyohimeIds.burningFire, baseChance: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
    values: { indirectDamageRatio: ratio } });
}

function reduceDefenseOnPoison(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-added' || event.instance.statusId !== kiyohimeIds.poison
    || ![kiyohimeIds.basic, kiyohimeIds.ultimate].includes(event.source.id as typeof kiyohimeIds.basic)) return;
  const owner = event.source.unitId ? context.getUnit(event.source.unitId) : undefined;
  const target = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== kiyohimeIds.hero || owner.hp <= 0 || !passivesEnabled(owner) || !target || target.hp <= 0) return;
  const unawakened = owner.awakeFilter === 0;
  const lossPerApplication = unawakened ? 10 : 20;
  const cap = unawakened ? 150 : 300;
  const existing = target.statuses.find(status => status.statusId === kiyohimeIds.permanentDefenseLoss);
  const currentLoss = Math.max(0, Number(existing?.values?.defenseReduced ?? 0));
  const additionalLoss = Math.min(lossPerApplication, cap - currentLoss);
  if (additionalLoss <= 0) return;
  const total = currentLoss + additionalLoss;
  const source = kiyohimeSource(kiyohimeIds.passive, owner.unitId);
  const instance: StatusInstance = { instanceId: `${kiyohimeIds.permanentDefenseLoss}:${target.unitId}`,
    statusId: kiyohimeIds.permanentDefenseLoss, source, stacks: 1, duration: { kind: 'permanent' },
    values: { defenseReduced: total }, modifiers: [{ stat: 'defense', operation: 'flat', amount: -total }] };
  return [
    ...(existing ? [{ type: 'remove-statuses' as const, source, targetId: target.unitId,
      statusIds: [kiyohimeIds.permanentDefenseLoss], reason: 'replaced' as const, parentEventId: event.eventId }] : []),
    { type: 'add-status', source, targetId: target.unitId, instance, parentEventId: event.eventId },
  ];
}

function createBurningFireStatus(): StatusDefinition {
  return { id: kiyohimeIds.burningFire, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace',
    handlers: { 'turn-end': { priority: 82, handle(context, event) { return tickBurningFire(context, event); } } } };
}

function tickBurningFire(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const target = context.getUnit(event.unitId);
  if (!target || target.hp <= 0) return;
  return target.statuses.filter(status => status.statusId === kiyohimeIds.burningFire).flatMap(status => {
    const owner = status.source.unitId ? context.getUnit(status.source.unitId) : undefined;
    const attack = owner && context.getEffectiveStats(owner.unitId);
    const defense = context.getEffectiveStats(target.unitId);
    if (!owner || owner.heroId !== kiyohimeIds.hero || !attack || !defense) return [];
    const ratio = Number(status.values?.indirectDamageRatio ?? .22);
    const hit = calculateIndirectDamage({ attack: attack.attack, defense: defense.defense,
      defenseIgnore: effectiveDefenseIgnore(owner), ratio, critDamage: attack.critDamage }, context.random);
    return [{ type: 'lose-life' as const, source: status.source, targetId: target.unitId,
      amount: hit.amount, lifeLossKind: 'indirect' as const, parentEventId: event.eventId }];
  });
}

function kiyohimeSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
