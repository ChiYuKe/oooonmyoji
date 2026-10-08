import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const yijinzhentianIds = { hero: 286, basic: '2861', passive: '2862', ultimate: '2863',
  feathers: 'status.hero.286.feathers', featherMark: 'status.hero.286.feather-mark' } as const;

const basicRatios = [.6, .65, .7, .75, .85] as const;
const ultimateRatios = [.6, .63, .66, .69, .72] as const;
const featherMarkRates = [.05, .06, .07, .08, .09] as const;
const ultimateCosts = [3, 3, 3, 3, 3, 2] as const;

export function registerYijinzhentian(registry: ContentRegistry): void {
  registry.registerStatus({ id: yijinzhentianIds.feathers, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', stackScope: 'source-unit' } satisfies StatusDefinition);
  registry.registerStatus({ id: yijinzhentianIds.featherMark, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'permanent', refreshPolicy: 'add-stack', stackScope: 'source-unit', maxStacks: 3 });

  const basic: SkillDefinition = { id: yijinzhentianIds.basic, actionKind: 'basic', useClientDamageData: true,
    target: 'single', targetRelation: 'enemy', levels: basicRatios.map(ratio => ({ ratio, maxHits: 4 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.hp <= 0 || actor.heroId !== yijinzhentianIds.hero || !target || target.hp <= 0 || target.side === actor.side) return [];
      const ownFeathers = actor.statuses.find(status => status.statusId === yijinzhentianIds.feathers)?.stacks ?? 0;
      const targetFeathers = target.statuses.find(status => status.statusId === yijinzhentianIds.featherMark
        && status.source.unitId === actor.unitId)?.stacks ?? 0;
      const inTurn = intent.kind !== 'passive';
      const extraOwnFeathers = inTurn ? ownFeathers : 0;
      const hits = Math.min(4, 1 + extraOwnFeathers + targetFeathers);
      return makeHits(context, actor, target, Number(parameters.ratio ?? basicRatios[rank(actor, yijinzhentianIds.basic) - 1]), hits,
        yijinzhentianIds.basic);
    } };

  const ultimate: SkillDefinition = { id: yijinzhentianIds.ultimate, actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 3 }, resourceCostsByLevel: ultimateCosts.map(amount => ({ resourceId: 'fire', amount })),
    target: 'all-enemies', targetRelation: 'enemy', levels: ultimateRatios.map((ratio, index) => ({ ratio, hits: 2,
      featherRatio: index === 0 ? .3 : .3 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.hp <= 0 || actor.heroId !== yijinzhentianIds.hero) return [];
      const ratio = Number(parameters.ratio ?? ultimateRatios[rank(actor, yijinzhentianIds.ultimate) - 1]);
      const commands = intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId);
        if (!target || target.hp <= 0 || target.side === actor.side) return [];
        const feathers = target.statuses.find(status => status.statusId === yijinzhentianIds.featherMark
          && status.source.unitId === actor.unitId);
        const hits = makeHits(context, actor, target, ratio, 2, yijinzhentianIds.ultimate);
        const featherRatio = Number(parameters.featherRatio ?? .3);
        if (feathers && feathers.stacks > 0) {
          hits.push(...makeHits(context, actor, target, featherRatio, feathers.stacks, yijinzhentianIds.ultimate));
          hits.push({ type: 'remove-status-instances', source: yijinzhentianSource(yijinzhentianIds.ultimate, actor.unitId),
            targetId: target.unitId, instanceIds: [feathers.instanceId], reason: 'consumed' });
        }
        return hits;
      });
      return commands;
    } };

  const definition: HeroDefinition = { id: yijinzhentianIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入风之舞按等级60%至85%伤害、自身黄金羽和目标羽毛印记提高普攻段数（上限4段，反击/协战不计自身羽毛）、黄金羽每回合随机叠1至3层、受敌方伤害时转移1层至伤害来源、敌方每层羽毛提高5%至9%受伤并降低等额治疗且最多3层、友方普攻羽毛目标后以津真天50%概率协战、阵亡时按目标羽毛层数引爆、千羽风之舞3火（六级2火）群体两段并按羽毛层数追加伤害后清除印记。数据中的不同技能行对大招层伤比例、醒后被动反噬倍率存在差异；护盾吸收是否触发转移、多段受击逐段转羽毛、目标死亡/驱散及复活时羽毛清除、反击段数和御魂插入仍需帧核验。'],
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const marked = enemies.slice().sort((a, b) => (b.statuses.find(status => status.statusId === yijinzhentianIds.featherMark
        && status.source.unitId === actor.unitId)?.stacks ?? 0) - (a.statuses.find(status => status.statusId === yijinzhentianIds.featherMark
        && status.source.unitId === actor.unitId)?.stacks ?? 0))[0]!;
      const level = Math.min(6, Math.max(1, actor.skillLevels?.[yijinzhentianIds.ultimate] ?? actor.skillLevel));
      const cost = ultimateCosts[level - 1]!;
      if (enemies.length > 1 && (context.state.resources[actor.side]?.fire ?? 0) >= cost)
        return { actorId: actor.unitId, skillId: yijinzhentianIds.ultimate, targetIds: enemies.map(enemy => enemy.unitId),
          shape: 'all-enemies', targetRelation: 'enemy' };
      return { actorId: actor.unitId, skillId: yijinzhentianIds.basic, targetIds: [marked.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    handlers: {
      'turn-start': { priority: 45, handle(context, event) { return growFeathers(context, event); } },
      hit: { priority: 45, handle(context, event) { return transferFeatherOnDamage(context, event); } },
      'attack-end': { priority: 45, handle(context, event) { return assistOnFeatheredBasic(context, event); } },
      'unit-defeated': { priority: 45, handle(context, event) { return explodeFeathersOnDeath(context, event); } },
    },
  };
  registry.registerHero(definition);
}

function growFeathers(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || owner.heroId !== yijinzhentianIds.hero || owner.hp <= 0 || owner.unitKind === 'summon' || !passivesEnabled(owner)) return;
  const source = yijinzhentianSource(yijinzhentianIds.passive, owner.unitId);
  return [{ type: 'add-status', source, targetId: owner.unitId, parentEventId: event.eventId,
    instance: { instanceId: `${yijinzhentianIds.feathers}:${owner.unitId}`, statusId: yijinzhentianIds.feathers,
      source, stacks: 1 + Math.min(2, Math.floor(context.random() * 3)), duration: { kind: 'permanent' } } }];
}

function transferFeatherOnDamage(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.amount <= 0 || event.suppressTargetPassiveTriggers || !event.source.unitId) return;
  const owner = context.getUnit(event.targetId);
  const attacker = context.getUnit(event.source.unitId);
  if (!owner || owner.hp <= 0 || owner.heroId !== yijinzhentianIds.hero || !passivesEnabled(owner)
    || !attacker || attacker.side === owner.side) return;
  const feather = owner.statuses.find(status => status.statusId === yijinzhentianIds.feathers);
  if (!feather || feather.stacks <= 0) return;
  const attached = attacker.statuses.find(status => status.statusId === yijinzhentianIds.featherMark
    && status.source.unitId === owner.unitId);
  if ((attached?.stacks ?? 0) >= 3) return;
  const source = yijinzhentianSource(yijinzhentianIds.passive, owner.unitId);
  const rankIndex = rank(owner, yijinzhentianIds.passive) - 1;
  const rate = featherMarkRates[rankIndex]!;
  const commands: EffectCommand[] = [{ type: 'remove-status-instances', source, targetId: owner.unitId,
    instanceIds: [feather.instanceId], reason: 'consumed', parentEventId: event.eventId },
  { type: 'add-status', source, targetId: attacker.unitId, parentEventId: event.eventId,
    instance: { instanceId: `${yijinzhentianIds.featherMark}:${owner.unitId}:${attacker.unitId}`,
      statusId: yijinzhentianIds.featherMark, source, stacks: 1, duration: { kind: 'permanent' },
      modifiers: [{ stat: 'damageTaken', operation: 'percent', amount: rate, perStack: true },
        { stat: 'healingTaken', operation: 'percent', amount: -rate, perStack: true }] } }];
  return commands;
}

function assistOnFeatheredBasic(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || event.actionKind !== 'basic' || event.suppressSourcePassiveTriggers
    || !event.source.unitId || !event.targetHealthChanges?.length) return;
  const attacker = context.getUnit(event.source.unitId);
  if (!attacker) return;
  const targets = event.targetHealthChanges.map(change => context.getUnit(change.targetId))
    .filter((unit): unit is UnitState => Boolean(unit && unit.hp > 0 && unit.side !== attacker.side
      && unit.statuses.some(status => status.statusId === yijinzhentianIds.featherMark)));
  if (!targets.length) return;
  return context.getLivingUnits(attacker.side).filter(owner => owner.heroId === yijinzhentianIds.hero
    && owner.unitId !== attacker.unitId && owner.unitKind !== 'summon' && passivesEnabled(owner)).flatMap(owner => {
      const target = targets.find(unit => unit.statuses.some(status => status.statusId === yijinzhentianIds.featherMark
        && status.source.unitId === owner.unitId));
      if (!target || context.random() >= .5) return [];
      return [{ type: 'schedule-action' as const, source: yijinzhentianSource(yijinzhentianIds.passive, owner.unitId),
        scheduling: 'assist' as const, freeCast: true, parentEventId: event.eventId,
        intent: { actorId: owner.unitId, skillId: yijinzhentianIds.basic, targetIds: [target.unitId], shape: 'single' as const,
          targetRelation: 'enemy' as const, kind: 'passive' as const } }];
    });
}

function explodeFeathersOnDeath(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || owner.heroId !== yijinzhentianIds.hero || owner.unitKind === 'summon') return;
  const attack = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const ratio = owner.awakeFilter === 1 ? .3 : .4;
  const commands: EffectCommand[] = [];
  for (const target of context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue')) {
    const feather = target.statuses.find(status => status.statusId === yijinzhentianIds.featherMark
      && status.source.unitId === owner.unitId);
    if (!feather) continue;
    commands.push(...makeHits(context, owner, target, ratio, feather.stacks, yijinzhentianIds.passive));
    commands.push({ type: 'remove-status-instances', source: yijinzhentianSource(yijinzhentianIds.passive, owner.unitId),
      targetId: target.unitId, instanceIds: [feather.instanceId], reason: 'consumed', parentEventId: event.eventId });
  }
  return commands.length ? commands : undefined;
}

function makeHits(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, ratio: number,
  hits: number, skillId: string): EffectCommand[] {
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const source = yijinzhentianSource(skillId, actor.unitId);
  return Array.from({ length: Math.max(0, hits) }, () => {
    const calculated = context.calculateDamage({ attack: offense.attack, defense: defense.defense,
      defenseIgnore: effectiveDefenseIgnore(actor), ratio, dmgFluctuation: .01,
      critChance: offense.crit, critDamage: offense.critDamage }, actor as UnitState, target as UnitState);
    return { type: 'deal-damage' as const, source, targetId: target.unitId, amount: calculated.amount,
      ...(calculated.damageOptions ? { damageOptions: calculated.damageOptions } : {}), isCritical: calculated.isCritical };
  });
}

function rank(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
function yijinzhentianSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
