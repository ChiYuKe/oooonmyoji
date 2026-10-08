import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const biganhuaIds = { hero: 288, basic: '2881', passive: '2882', ultimate: '2883',
  sea: 'status.hero.288.flower-sea', bloodShield: 'status.hero.288.blood-sea-shield' } as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const seaRatios = [.33, .35, .37, .39, .42] as const;
const ultimateCosts = [3, 3, 3, 3, 3, 2] as const;

export function registerBiganhua(registry: ContentRegistry): void {
  registry.registerStatus({ id: biganhuaIds.sea, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 6 } satisfies StatusDefinition);
  registry.registerStatus({ id: biganhuaIds.bloodShield, mechanicsCoverage: 'partial', category: 'shield', dispellable: false,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });

  const basic: SkillDefinition = { id: biganhuaIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    useClientDamageData: true, levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== biganhuaIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      return damageCommands(context, actor, target, Number(parameters.ratio ?? basicRatios[rank(actor, basic.id) - 1]), 1, basic.id);
    } };
  const ultimate: SkillDefinition = { id: biganhuaIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    resourceCostsByLevel: ultimateCosts.map(amount => ({ resourceId: 'fire', amount })), target: 'self', targetRelation: 'ally',
    levels: [1, 1, 1, 1, 1, 1].map(value => ({ value })),
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.heroId !== biganhuaIds.hero || actor.hp <= 0) return [];
      const flower = actor.statuses.find(status => status.statusId === biganhuaIds.sea);
      const cap = seaCap(actor);
      const current = flower?.stacks ?? 0;
      const gain = actor.hp / Math.max(1, actor.stats.hp) < .5 ? 3 : 2;
      const stacks = Math.min(cap, current + gain);
      const ref = biganhuaSource(ultimate.id, actor.unitId);
      const commands: EffectCommand[] = [{ type: 'add-status', source: ref, targetId: actor.unitId,
        instance: { instanceId: `${biganhuaIds.sea}:${actor.unitId}`, statusId: biganhuaIds.sea, source: ref,
          stacks: Math.max(1, stacks), duration: { kind: 'permanent' }, values: { thresholdCount: flower?.values?.thresholdCount ?? 0 } } }];
      if (actor.hp / Math.max(1, actor.stats.hp) < .75) {
        const shield = Math.max(0, actor.stats.hp - actor.hp) * (rank(actor, ultimate.id, 6) >= 6 ? .23 : .2);
        commands.push({ type: 'add-status', source: ref, targetId: actor.unitId, instance: {
          instanceId: `${biganhuaIds.bloodShield}:${actor.unitId}`, statusId: biganhuaIds.bloodShield,
          source: ref, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
          values: { shieldRemaining: shield },
        } });
      }
      return commands;
    } };

  const definition: HeroDefinition = { id: biganhuaIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入死亡之花等级伤害、开战3层花海、花海中敌方行动前按层数逐段造成33%至42%攻击伤害、彼岸花每自身回合花海衰减1层但至少保留1层、生命每下降25%获得花海层并限制层数上限、赤团华消耗3火（六级2火）获得2层或低于50%时3层以及低于75%时获得按已损生命计算的护盾。技能数据另有彼岸花造成伤害后施加5%生命间接伤害的2884状态行，但与英雄当前技能列表关系和持续结算窗口不清，尚未启用。生命阈值的等号边界、多次治疗后重复越线、血海层护盾是否叠加以及多名彼岸花的唯一结界归属仍待帧核。'],
    initialize(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.heroId !== biganhuaIds.hero || owner.hp <= 0 || !passivesEnabled(owner)) return [];
      const ref = biganhuaSource(biganhuaIds.passive, unitId);
      return [{ type: 'add-status', source: ref, targetId: unitId, instance: { instanceId: `${biganhuaIds.sea}:${unitId}`,
        statusId: biganhuaIds.sea, source: ref, stacks: 3, duration: { kind: 'permanent' }, values: { thresholdCount: 0 } } }];
    },
    handlers: {
      'turn-start': { priority: 47, handle(context, event) { return handleFlowerSeaTurn(context, event); } },
      hit: { priority: 47, handle(context, event) { return gainSeaAtHealthThreshold(context, event); } },
    },
  };
  registry.registerHero(definition);
}

function handleFlowerSeaTurn(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return;
  const commands: EffectCommand[] = [];
  const owner = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue').find(candidate =>
    candidate.heroId === biganhuaIds.hero && candidate.unitKind !== 'summon' && passivesEnabled(candidate)
    && candidate.statuses.some(status => status.statusId === biganhuaIds.sea && status.stacks > 0));
  if (owner) {
    const status = owner.statuses.find(item => item.statusId === biganhuaIds.sea);
    if (status) commands.push(...damageCommands(context, owner, actor,
      seaRatios[rank(owner, biganhuaIds.passive) - 1], status.stacks, biganhuaIds.passive, true));
  }
  if (actor.heroId === biganhuaIds.hero && passivesEnabled(actor)) {
    const status = actor.statuses.find(item => item.statusId === biganhuaIds.sea);
    if (status && status.stacks > 1) commands.push({ type: 'add-status', source: status.source, targetId: actor.unitId,
      instance: { ...status, stacks: status.stacks - 1 } });
  }
  return commands.length ? commands : undefined;
}

function gainSeaAtHealthThreshold(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.hpBefore || event.hpAfter === undefined) return;
  const owner = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== biganhuaIds.hero || owner.hp <= 0 || !passivesEnabled(owner)) return;
  const sea = owner.statuses.find(status => status.statusId === biganhuaIds.sea);
  if (!sea) return;
  const maxHp = Math.max(1, owner.stats.hp);
  const beforeThreshold = Math.floor((1 - event.hpBefore / maxHp) / .25 + 1e-9);
  const afterThreshold = Math.floor((1 - event.hpAfter / maxHp) / .25 + 1e-9);
  const recorded = Number(sea.values?.thresholdCount ?? 0);
  const crossed = Math.max(0, Math.min(3, afterThreshold) - Math.max(recorded, Math.min(3, beforeThreshold)));
  if (crossed <= 0) return;
  const currentHpRatio = owner.hp / maxHp;
  const cap = seaCap(owner);
  const stacks = Math.min(cap, sea.stacks + crossed);
  const ref = biganhuaSource(biganhuaIds.passive, owner.unitId);
  const commands: EffectCommand[] = [{ type: 'add-status', source: ref, targetId: owner.unitId,
    instance: { ...sea, source: ref, stacks, values: { ...sea.values, thresholdCount: Math.max(recorded, afterThreshold) } } }];
  if (currentHpRatio < .75) commands.push({ type: 'add-status', source: ref, targetId: owner.unitId,
    instance: { instanceId: `${biganhuaIds.bloodShield}:${owner.unitId}`, statusId: biganhuaIds.bloodShield,
      source: ref, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
      values: { shieldRemaining: Math.max(0, maxHp - owner.hp) * .2 } } });
  return commands;
}

function damageCommands(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, ratio: number, hits: number,
  skillId: string, indirect = false): EffectCommand[] {
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const source = biganhuaSource(skillId, actor.unitId);
  return Array.from({ length: Math.max(0, hits) }, () => {
    const hit = context.calculateDamage({ attack: offense.attack, defense: defense.defense, ratio,
      defenseIgnore: effectiveDefenseIgnore(actor), dmgFluctuation: .01, critChance: offense.crit, critDamage: offense.critDamage },
    actor as UnitState, target as UnitState);
    return { type: 'deal-damage' as const, source, targetId: target.unitId, amount: hit.amount,
      ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical,
      ...(indirect ? { suppressSoulTriggers: true, suppressTargetSoulTriggers: true,
        suppressSourcePassiveTriggers: true, suppressTargetPassiveTriggers: true } : {}) };
  });
}

function seaCap(owner: Readonly<UnitState>): number {
  const ratio = owner.hp / Math.max(1, owner.stats.hp);
  return ratio <= .25 ? 6 : ratio <= .5 ? 5 : ratio <= .75 ? 4 : 3;
}
function rank(owner: Readonly<UnitState>, skillId: string, max = 5): number { return Math.max(1, Math.min(max, owner.skillLevels?.[skillId] ?? owner.skillLevel)); }
function biganhuaSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
