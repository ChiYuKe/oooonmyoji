import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptControl, attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const rukiaIds = {
  hero: 336,
  basic: '3361',
  passive: '3362',
  ultimate: '3363',
  form: 'status.hero.336.form',
  freeze: 'status.hero.336.freeze',
  frostBurn: 'status.hero.336.frost-burn',
  slow: 'status.hero.336.slow',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.2] as const;
const ultimateRatios = [1.16, 1.27, 1.27, 1.34, 1.34] as const;
const freezeChances = [.2, .2, .25, .25, .3] as const;
const frostBurnRatios = [.12, .14, .14, .14, .14] as const;

export function registerRukia(registry: ContentRegistry): void {
  registry.registerStatus({ id: rukiaIds.form, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' });
  registry.registerStatus({ id: rukiaIds.freeze, mechanicsCoverage: 'partial', category: 'control',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  registry.registerStatus({ id: rukiaIds.frostBurn, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: rukiaIds.slow, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerHero(createDefinition());
}

function createDefinition(): HeroDefinition {
  const basic: SkillDefinition = { id: rukiaIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })),
    canUse(_state, actor) { return isRukia(actor) && actor.hp > 0; },
    execute(context, intent, parameters) { return attackCommands(context, intent, Number(parameters.ratio ?? 1), rukiaIds.basic); } };
  const passive: SkillDefinition = { id: rukiaIds.passive, actionKind: 'passive', target: 'self', targetRelation: 'ally',
    levels: [{}], canUse() { return false; }, execute() { return []; } };
  const ultimate: SkillDefinition = { id: rukiaIds.ultimate, actionKind: 'skill', target: 'all-enemies', targetRelation: 'enemy',
    resourceCost: { resourceId: 'fire', amount: 3 }, levels: ultimateRatios.map(ratio => ({ ratio })),
    canUse(_state, actor) { return isRukia(actor) && actor.hp > 0; },
    execute(context, intent, parameters) { return attackCommands(context, intent, Number(parameters.ratio ?? 1.16), rukiaIds.ultimate); } };
  return {
    id: rukiaIds.hero,
    skills: [basic, passive, ultimate],
    aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['按客户端等级数据接入普攻倍率、3火群攻倍率与冰冻概率；被动在任意己方或敌方行动结束时生命比例低于50%（五级60%）触发一次，解除全部控制并永久获得三舞·白刀。形态状态加速度，攻击时按等级忽视15%/20%效果抵抗、附加冻伤间接伤害（14%上限生命，封顶攻击240%）并在未冰冻目标上附加减速。技能表与buff行对三舞·白刀二级速度数值有冲突；本实现遵循技能升级说明，二级仍20速、三级起30速。她不在10点场阵容中；冻伤抵抗/护盾结算窗口和三舞·白刀状态可否驱散仍需实战帧校准。'],
    handlers: {
      hit: { priority: 36, handle(context, event) { return onRukiaHit(context, event); } },
      'action-end': { priority: 36, handle(context, event) { return transformAtThreshold(context, event); } },
      'turn-start': { priority: 36, handle(context, event) { return tickFrostBurn(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 3) return { actorId: unitId, skillId: rukiaIds.ultimate,
        targetIds: enemies.map(enemy => enemy.unitId), shape: 'all-enemies', targetRelation: 'enemy' };
      return { actorId: unitId, skillId: rukiaIds.basic, targetIds: [enemies[0]!.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
}

function attackCommands(context: BattleContext, intent: ActionIntent, ratio: number, skillId: string): EffectCommand[] {
  const actor = context.getUnit(intent.actorId);
  if (!actor || actor.hp <= 0) return [];
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  return intent.targetIds.flatMap(targetId => {
    const target = context.getUnit(targetId);
    if (!target || target.hp <= 0) return [];
    const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
    const hit = context.calculateDamage({ attack: offense.attack, defense: defense.defense,
      defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: offense.crit, critDamage: offense.critDamage }, actor, target);
    return [{ type: 'deal-damage' as const, source: rukiaSource(skillId, actor.unitId), targetId: target.unitId,
      amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical,
      ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, offense.critDamage) } : {}) }];
  });
}

function transformAtThreshold(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended') return;
  const rukias = Object.values(context.state.units).filter(unit => isRukia(unit) && unit.hp > 0 && passivesEnabled(unit));
  const commands: EffectCommand[] = [];
  for (const owner of rukias) {
    if (findStatus(owner, rukiaIds.form)) continue;
    const rank = skillRank(owner, rukiaIds.passive);
    const threshold = rank >= 5 ? .6 : .5;
    if (owner.hp / Math.max(1, owner.stats.hp) >= threshold) continue;
    const source = rukiaSource(rukiaIds.passive, owner.unitId);
    for (const status of owner.statuses) {
      if (context.getStatusCategory(status.statusId) === 'control' || status.values?.controlType !== undefined) {
        commands.push({ type: 'remove-status-instances', source, targetId: owner.unitId,
          instanceIds: [status.instanceId], reason: 'consumed', parentEventId: event.eventId });
      }
    }
    const speed = rank >= 3 ? 30 : 20;
    const ignoreResistance = rank >= 4 ? .2 : .15;
    commands.push({ type: 'add-status', source, targetId: owner.unitId, parentEventId: event.eventId,
      instance: { instanceId: `${rukiaIds.form}:${owner.unitId}`, statusId: rukiaIds.form, source,
        stacks: 1, duration: { kind: 'permanent' }, values: { ignoreResistance },
        modifiers: [{ stat: 'speed', operation: 'flat', amount: speed }] } });
  }
  return commands.length ? commands : undefined;
}

function onRukiaHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.amount <= 0 || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId);
  const target = context.getUnit(event.targetId);
  if (!owner || !isRukia(owner) || !target || target.hp <= 0) return;
  const commands: EffectCommand[] = [];
  const form = findStatus(owner, rukiaIds.form);
  const ignoreResistance = Number(form?.values?.ignoreResistance ?? 0);
  let freezeApplied = isFrozen(context, target);
  if (event.source.id === rukiaIds.ultimate) {
    const chance = freezeChances[Math.max(0, Math.min(4, skillRank(owner, rukiaIds.ultimate) - 1))]!;
    const control = attemptControl(context, { attemptId: `${rukiaIds.freeze}:${event.eventId}`, source: rukiaSource(rukiaIds.ultimate, owner.unitId),
      targetId: target.unitId, statusId: rukiaIds.freeze, controlType: '冰冻', baseChance: chance,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, ignoreResistance, parentEventId: event.eventId });
    if (control) commands.push(control);
    freezeApplied = freezeApplied || control?.type === 'apply-control';
  }
  if (!form) return commands.length ? commands : undefined;
  const rank = skillRank(owner, rukiaIds.passive);
  const dotRatio = frostBurnRatios[Math.max(0, Math.min(4, rank - 1))]!;
  commands.push(...attemptDebuff(context, { source: rukiaSource(rukiaIds.passive, owner.unitId), targetId: target.unitId,
    statusId: rukiaIds.frostBurn, baseChance: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
    ignoreResistance, values: { ratio: dotRatio, attackCapRatio: 2.4 } }));
  if (!freezeApplied) commands.push(...attemptDebuff(context, { source: rukiaSource(rukiaIds.passive, owner.unitId), targetId: target.unitId,
    statusId: rukiaIds.slow, baseChance: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, ignoreResistance,
    modifiers: [{ stat: 'speed', operation: 'flat', amount: -30 }] }));
  return commands;
}

function tickFrostBurn(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const target = context.getUnit(event.unitId);
  if (!target || target.hp <= 0) return;
  return target.statuses.filter(status => status.statusId === rukiaIds.frostBurn).flatMap(status => {
    const owner = context.getUnit(String(status.source.unitId ?? ''));
    const ratio = Math.max(0, Number(status.values?.ratio ?? .12));
    const capRatio = Math.max(0, Number(status.values?.attackCapRatio ?? 2.4));
    const cap = (owner ? context.getEffectiveStats(owner.unitId)?.attack ?? owner.stats.attack : 0) * capRatio;
    const amount = Math.min(target.stats.hp * ratio, cap);
    return amount > 0 ? [{ type: 'lose-life' as const, source: status.source, targetId: target.unitId, amount,
      lifeLossKind: 'indirect' as const, parentEventId: event.eventId }] : [];
  });
}

function isFrozen(context: BattleContext, target: Readonly<UnitState>): boolean {
  return target.statuses.some(status => status.statusId === rukiaIds.freeze || status.values?.controlType === '冰冻'
    || context.getStatusCategory(status.statusId) === 'control' && status.values?.controlType === '冰冻');
}
function findStatus(unit: Readonly<UnitState>, statusId: string): StatusInstance | undefined {
  return unit.statuses.find(status => status.statusId === statusId);
}
function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
function isRukia(unit: Readonly<UnitState>): boolean { return unit.heroId === rukiaIds.hero && unit.unitKind !== 'summon'; }
function rukiaSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
