import type { DamageInterception, HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const blazingPeachIds = { hero: 598, basic: '5981', budSkill: '5982', reviveSkill: '5983', bud: 'status.hero.598.new-bud',
  bloom: 'status.hero.598.in-bloom', autoRevives: 'status.hero.598.auto-revives' } as const;
const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const reviveRatios = [.5, .5, .5, .5, .5] as const;

export function registerBlazingPeach(registry: ContentRegistry): void {
  registry.registerStatus({ id: blazingPeachIds.bud, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: blazingPeachIds.bloom, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: blazingPeachIds.autoRevives, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });

  const basic = createBasicAttackSkill(blazingPeachIds.basic, basicRatios);
  const budSkill: SkillDefinition = { id: blazingPeachIds.budSkill, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single', targetRelation: 'ally', levels: [1, 1, 1, 1, 1].map(value => ({ value })),
    execute(context, intent) {
      const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || owner.hp <= 0 || !target || target.hp <= 0 || target.side !== owner.side) return [];
      return applyBud(owner, target, blazingPeachIds.budSkill, target.stats.hp * .15, true);
    } };
  const reviveSkill: SkillDefinition = { id: blazingPeachIds.reviveSkill, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'ally', allowDefeatedTargets: true, useClientDamageData: false,
    levels: reviveRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || owner.hp <= 0 || !target || target.hp > 0 || target.side !== owner.side || target.unitKind === 'summon') return [];
      return reviveCommands(owner, target, Number(parameters.ratio ?? .5), rank(owner, reviveSkill.id));
    } };

  const definition: HeroDefinition = { id: blazingPeachIds.hero, skills: [basic, budSkill, reviveSkill], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    aiCoverageNotes: ['有死亡友方且鬼火不少于3时复活；否则优先为低血友方施加新蕊；更完整的治疗目标、复活优先级仍需录像核对。'],
    mechanicsCoverageNotes: ['已接入回春舞等级倍率；携芳意消耗2火，为目标治疗生命上限15%并施加新蕊；醒时花消耗3火、以50%生命复活非召唤友方并施加新蕊，二级起复活后额外治疗桃花妖生命上限10%，三级起推目标50%行动条；自身初始暴击至少100%时减伤35%；三级起身上存在新蕊时抵挡致命伤并清除全队新蕊；五级先机为最低生命友方施加新蕊，敌方回合结束时最多额外复活3次。新蕊到期/驱散时序、花蕾被动免死范围与额外复活目标次序仍需帧核。'],
    modifyIncomingDamage(attacker, target, amount) {
      if (target.heroId === blazingPeachIds.hero && target.stats.crit >= 1 && passivesEnabled(target)) return amount * .65;
      return amount;
    },
    interceptIncomingDamage(state, _attacker, target, amount) {
      if (target.heroId !== blazingPeachIds.hero || !passivesEnabled(target) || rank(target, blazingPeachIds.reviveSkill) < 3
        || target.hp > amount) return;
      const allies = state.sides[target.side].map(id => state.units[id]).filter((unit): unit is UnitState => Boolean(unit && unit.hp > 0));
      const buds = allies.flatMap(ally => ally.statuses.filter(status => status.statusId === blazingPeachIds.bud));
      if (!buds.length) return;
      return { amount: 0, effects: allies.flatMap(ally => {
        const owned = ally.statuses.filter(status => status.statusId === blazingPeachIds.bud);
        return owned.length ? [{ type: 'remove-status-instances' as const, source: peachSource(blazingPeachIds.reviveSkill, target.unitId),
          targetId: ally.unitId, instanceIds: owned.map(status => status.instanceId), reason: 'consumed' as const }] : [];
      }) };
    },
    handlers: {
      'status-expiration': { priority: 66, handle(context, event) { return budRemoved(context, event); } },
      'turn-end': { priority: 66, handle(context, event) { return autoRevive(context, event); } },
    },
    initialize(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.heroId !== blazingPeachIds.hero || owner.hp <= 0 || rank(owner, blazingPeachIds.budSkill) < 5) return [];
      const ally = context.getLivingUnits(owner.side).filter(unit => unit.unitKind !== 'summon')
        .slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0];
      return ally ? applyBud(owner, ally, blazingPeachIds.budSkill, 0, false) : [];
    },
    policy(context, unitId) {
      const owner = context.getUnit(unitId); if (!owner || owner.hp <= 0 || owner.unitKind === 'summon') return;
      const allies = context.getLivingUnits(owner.side).filter(unit => unit.unitKind !== 'summon');
      const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return;
      const fire = context.state.resources[owner.side]?.fire ?? 0;
      const defeated = context.state.sides[owner.side].map(id => context.state.units[id]).filter((unit): unit is UnitState => Boolean(unit
        && unit.hp <= 0 && unit.unitKind !== 'summon'));
      if (fire >= 3 && defeated.length) return { actorId: unitId, skillId: blazingPeachIds.reviveSkill,
        targetIds: [defeated[0]!.unitId], shape: 'single', targetRelation: 'ally' };
      if (fire >= 2) {
        const target = allies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
        if (target && !target.statuses.some(status => status.statusId === blazingPeachIds.bud))
          return { actorId: unitId, skillId: blazingPeachIds.budSkill, targetIds: [target.unitId], shape: 'single', targetRelation: 'ally' };
      }
      const enemy = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      return { actorId: unitId, skillId: blazingPeachIds.basic, targetIds: [enemy.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function applyBud(owner: Readonly<UnitState>, target: Readonly<UnitState>, skillId: string, healAmount: number, heal: boolean): EffectCommand[] {
  const source = peachSource(skillId, owner.unitId);
  const commands: EffectCommand[] = [];
  if (heal && healAmount > 0) commands.push({ type: 'heal', source, targetId: target.unitId, amount: healAmount });
  commands.push({ type: 'add-status', source, targetId: target.unitId, instance: { instanceId: `${blazingPeachIds.bud}:${owner.unitId}:${target.unitId}`,
    statusId: blazingPeachIds.bud, source, stacks: 1, duration: { kind: 'permanent' } } });
  return commands;
}

function reviveCommands(owner: Readonly<UnitState>, target: Readonly<UnitState>, ratio: number, skillRank: number): EffectCommand[] {
  const source = peachSource(blazingPeachIds.reviveSkill, owner.unitId);
  const commands: EffectCommand[] = [{ type: 'revive', source, targetId: target.unitId, hp: Math.max(1, target.stats.hp * ratio) },
    ...applyBud(owner, target, blazingPeachIds.reviveSkill, 0, false),
    { type: 'add-status', source, targetId: target.unitId, instance: { instanceId: `${blazingPeachIds.bloom}:${owner.unitId}:${target.unitId}`,
      statusId: blazingPeachIds.bloom, source, stacks: 1,
      duration: { kind: 'count', remaining: skillRank >= 4 ? 3 : 2, owner: 'target-turn' } } }];
  if (skillRank >= 2) commands.push({ type: 'heal', source, targetId: target.unitId, amount: owner.stats.hp * .1 });
  if (skillRank >= 3) commands.push({ type: 'change-action-gauge', source, targetId: target.unitId, amount: 50 });
  return commands;
}

function budRemoved(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-removed' || event.statusId !== blazingPeachIds.bud || !event.removedSource?.unitId) return;
  const owner = context.getUnit(event.removedSource.unitId);
  if (!owner || owner.heroId !== blazingPeachIds.hero || owner.hp <= 0 || rank(owner, blazingPeachIds.budSkill) < 2) return;
  return [{ type: 'change-action-gauge', source: peachSource(blazingPeachIds.budSkill, owner.unitId), targetId: owner.unitId,
    amount: 30, parentEventId: event.eventId }];
}

function autoRevive(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const enemy = context.getUnit(event.unitId); if (!enemy || enemy.hp <= 0) return;
  const owner = context.getLivingUnits(enemy.side === 'blue' ? 'red' : 'blue').find(unit => unit.heroId === blazingPeachIds.hero
    && unit.hp > 0 && unit.unitKind !== 'summon' && passivesEnabled(unit) && rank(unit, blazingPeachIds.reviveSkill) >= 5);
  if (!owner) return;
  const used = Number(owner.statuses.find(status => status.statusId === blazingPeachIds.autoRevives)?.values?.count ?? 0);
  if (used >= 3) return;
  const target = context.state.sides[owner.side].map(id => context.state.units[id]).find(unit => unit && unit.hp <= 0 && unit.unitKind !== 'summon');
  if (!target) return;
  const source = peachSource(blazingPeachIds.reviveSkill, owner.unitId);
  return [...reviveCommands(owner, target, .5, rank(owner, blazingPeachIds.reviveSkill)),
    { type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${blazingPeachIds.autoRevives}:${owner.unitId}`,
      statusId: blazingPeachIds.autoRevives, source, stacks: 1, duration: { kind: 'permanent' }, values: { count: used + 1 } } }];
}
function rank(owner: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(5, owner.skillLevels?.[skillId] ?? owner.skillLevel)); }
function peachSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
