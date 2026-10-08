import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { attemptDebuff } from '../mechanics/control';
import { ContentRegistry } from './registry';

export const redShadowYotoIds = { hero: 328, basic: '3281', passive: '3282', ultimate: '3283', isolated: 'status.debuff.isolated',
  lockedTarget: 'status.hero.328.locked-target', lowHealthAura: 'status.hero.328.low-health-aura', redBreath: 'status.hero.328.red-breath',
  freeUltimate: 'status.hero.328.free-ultimate', extraTurnUltimate: 'status.hero.328.extra-turn-ultimate' } as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const lockedTargetRatios = [0, .05, .1, .15, .15] as const;
const ultimateRatio = 2.95;

export function registerRedShadowYoto(registry: ContentRegistry): void {
  const statuses: StatusDefinition[] = [
    { id: redShadowYotoIds.isolated, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'replace', protectsFromDirectTargeting: true, preventsDamageSharing: true,
      mechanicsCoverageNotes: ['客户端孤立状态：携带者不能被其他友方选中，受到的伤害不能由友方分担或代替承受。'] },
    { id: redShadowYotoIds.lockedTarget, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: redShadowYotoIds.lowHealthAura, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: redShadowYotoIds.redBreath, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 6 },
    { id: redShadowYotoIds.freeUltimate, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'event', refreshPolicy: 'replace' },
    { id: redShadowYotoIds.extraTurnUltimate, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: false,
      durationOwner: 'event', refreshPolicy: 'replace' },
  ];
  for (const status of statuses) registry.registerStatus(status);

  const basic: SkillDefinition = { id: redShadowYotoIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })), execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target || !validEnemy(actor, target)) return [];
      const ratio = Number(parameters.ratio ?? basicRatios[rank(actor, basic.id) - 1]!);
      const commands = [hit(context, actor, target, basic.id, ratio)];
      if (lockedTarget(actor)?.values?.targetUnitId === target.unitId && rank(actor, redShadowYotoIds.passive) >= 5) {
        commands.push(...attemptDebuff(context, { source: source(redShadowYotoIds.passive, actor.unitId), targetId: target.unitId,
          statusId: redShadowYotoIds.isolated, baseChance: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }));
      }
      return commands;
    } };

  const ultimate: SkillDefinition = { id: redShadowYotoIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    resolveResourceCost(state, actor, scheduling) {
      if (scheduling === 'extra-turn' && actor.statuses.some(status => status.statusId === redShadowYotoIds.freeUltimate))
        return { resourceId: 'fire', amount: 0 };
      return { resourceId: 'fire', amount: 3 };
    },
    target: 'single', targetRelation: 'enemy', levels: [1, 2, 3, 4, 5].map(() => ({ ratio: ultimateRatio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target || !validEnemy(actor, target)) return [];
      const extraTurnBoost = rank(actor, ultimate.id) >= 5
        && actor.statuses.some(status => status.statusId === redShadowYotoIds.extraTurnUltimate);
      const baseRatio = Number(parameters.ratio ?? ultimateRatio) * (extraTurnBoost ? 1.3 : 1);
      const command = hit(context, actor, target, ultimate.id, baseRatio);
      if (extraTurnBoost) Object.assign(command, { cannotBeShared: true, suppressTargetPassiveTriggers: true, suppressTargetSoulTriggers: true });
      const commands: EffectCommand[] = [command];
      if (lockedTarget(actor)?.values?.targetUnitId === target.unitId && rank(actor, redShadowYotoIds.passive) >= 5) {
        commands.push(...attemptDebuff(context, { source: source(redShadowYotoIds.passive, actor.unitId), targetId: target.unitId,
          statusId: redShadowYotoIds.isolated, baseChance: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }));
      }
      return commands;
    } };

  const hero: HeroDefinition = { id: redShadowYotoIds.hero, skills: [basic, ultimate], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['已按客户端行实现炎刃100%至125%；穷追不舍在自身回合结束锁定当前生命比例最低的非召唤敌方，并在下次回合开始消耗印记造成100%攻击且不触发目标御魂/被动或伤害分担；按最低敌方已损生命比例增加伤害与速度，锁定目标的伤害随被动等级提高5%至15%，五级命中锁定目标附加1回合孤立。赤影一瞬耗3火、295%单体伤害；二级起击败非召唤敌人叠赤影之息，每层增伤15%最多6层；三级起大招击杀获新回合，四级新回合大招免火，五级该次大招增伤30%、不可分担且不触发目标御魂/被动。孤立已阻止直接选中与伤害分担。状态行未清楚描述的被动印记与多段攻击时序、连续击杀插队、御魂交互及帧实战仍待核。'],
    modifyOutgoingDamage(attacker, target, amount, kind, state) {
      if (attacker.heroId !== redShadowYotoIds.hero || attacker.unitKind === 'summon' || !passivesEnabled(attacker)) return amount;
      const enemies = (attacker.side === 'blue' ? state.sides.red : state.sides.blue).map(id => state.units[id])
        .filter((unit): unit is UnitState => Boolean(unit && unit.hp > 0 && unit.unitKind !== 'summon'));
      const lowest = [...enemies].sort((left, right) => hpRatio(left) - hpRatio(right))[0];
      const lowHealthBonus = lowest ? 1 - hpRatio(lowest) : 0;
      const locked = lockedTarget(attacker);
      const targetBonus = locked?.values?.targetUnitId === target.unitId ? lockedTargetRatios[rank(attacker, redShadowYotoIds.passive) - 1]! : 0;
      return amount * (1 + lowHealthBonus + targetBonus);
    },
    handlers: {
      'turn-end': { priority: 91, handle(context, event) { return lockLowestEnemy(context, event); } },
      'turn-start': { priority: 91, handle(context, event) { return triggerLockedStrike(context, event); } },
      'unit-defeated': { priority: 91, handle(context, event) { return onUltimateKill(context, event); } },
      'action-end': { priority: 91, handle(context, event) { return clearExtraTurnMarks(context, event); } },
      'effect-resolution': { priority: 91, handle(context, event) { return refreshLowHealthAura(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.heroId !== redShadowYotoIds.hero || actor.hp <= 0) return;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue').filter(enemy => enemy.unitKind !== 'summon');
      if (!enemies.length) return;
      const locked = lockedTarget(actor)?.values?.targetUnitId;
      const target = enemies.find(enemy => enemy.unitId === locked) ?? [...enemies].sort((a, b) => hpRatio(a) - hpRatio(b))[0]!;
      const freeUltimate = actor.statuses.some(status => status.statusId === redShadowYotoIds.freeUltimate);
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      const useUltimate = freeUltimate || fire >= 3;
      return { actorId: unitId, skillId: useUltimate ? ultimate.id : basic.id, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(hero);
}

function lockLowestEnemy(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended' || event.scheduling === 'extra-turn' || !event.unitId) return;
  const owner = context.getUnit(event.unitId);
  if (!owner || owner.heroId !== redShadowYotoIds.hero || owner.unitKind === 'summon' || !passivesEnabled(owner)) return;
  const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue').filter(unit => unit.unitKind !== 'summon');
  const target = [...enemies].sort((left, right) => hpRatio(left) - hpRatio(right))[0];
  if (!target) return;
  const sourceRef = source(redShadowYotoIds.passive, owner.unitId);
  return [{ type: 'add-status', source: sourceRef, targetId: owner.unitId, parentEventId: event.eventId,
    instance: { instanceId: `${redShadowYotoIds.lockedTarget}:${owner.unitId}`, statusId: redShadowYotoIds.lockedTarget,
      source: sourceRef, stacks: 1, duration: { kind: 'permanent' }, values: { targetUnitId: target.unitId, pendingStrike: true } } }];
}

function triggerLockedStrike(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started' || !event.unitId) return;
  const owner = context.getUnit(event.unitId), mark = owner && lockedTarget(owner);
  if (!owner || owner.heroId !== redShadowYotoIds.hero || !mark?.values?.pendingStrike || !passivesEnabled(owner)) return;
  const targetId = String(mark.values.targetUnitId ?? ''), target = context.getUnit(targetId);
  const sourceRef = source(redShadowYotoIds.passive, owner.unitId);
  const commands: EffectCommand[] = [{ type: 'add-status', source: sourceRef, targetId: owner.unitId, parentEventId: event.eventId,
    instance: { ...mark, values: { ...mark.values, pendingStrike: false } } }];
  if (!target || target.hp <= 0 || target.side === owner.side) return commands;
  const strike = hit(context, owner, target, redShadowYotoIds.passive, 1);
  Object.assign(strike, { cannotBeShared: true, suppressTargetPassiveTriggers: true, suppressTargetSoulTriggers: true });
  commands.unshift(strike);
  if (rank(owner, redShadowYotoIds.passive) >= 5) commands.push(...attemptDebuff(context, { source: sourceRef, targetId,
    statusId: redShadowYotoIds.isolated, baseChance: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }));
  return commands;
}

function onUltimateKill(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated' || event.defeatedBy?.id !== redShadowYotoIds.ultimate || !event.defeatedBy.unitId) return;
  const owner = context.getUnit(event.defeatedBy.unitId), defeated = context.getUnit(event.unitId);
  if (!owner || owner.heroId !== redShadowYotoIds.hero || owner.hp <= 0 || !passivesEnabled(owner)
    || defeated?.unitKind === 'summon') return;
  const sourceRef = source(redShadowYotoIds.ultimate, owner.unitId), commands: EffectCommand[] = [];
  if (rank(owner, redShadowYotoIds.ultimate) >= 2) commands.push({ type: 'add-status', source: sourceRef, targetId: owner.unitId,
    parentEventId: event.eventId, instance: { instanceId: `${redShadowYotoIds.redBreath}:${owner.unitId}`,
      statusId: redShadowYotoIds.redBreath, source: sourceRef, stacks: 1, duration: { kind: 'permanent' },
      modifiers: [{ stat: 'damage', operation: 'percent', amount: .15, perStack: true }] } });
  if (rank(owner, redShadowYotoIds.ultimate) >= 3) {
    if (rank(owner, redShadowYotoIds.ultimate) >= 4) commands.push({ type: 'add-status', source: sourceRef, targetId: owner.unitId,
      parentEventId: event.eventId, instance: { instanceId: `${redShadowYotoIds.freeUltimate}:${owner.unitId}`,
        statusId: redShadowYotoIds.freeUltimate, source: sourceRef, stacks: 1, duration: { kind: 'permanent' },
        values: { grantedActionId: event.actionId ?? 0 } } });
    if (rank(owner, redShadowYotoIds.ultimate) >= 5) commands.push({ type: 'add-status', source: sourceRef, targetId: owner.unitId,
      parentEventId: event.eventId, instance: { instanceId: `${redShadowYotoIds.extraTurnUltimate}:${owner.unitId}`,
        statusId: redShadowYotoIds.extraTurnUltimate, source: sourceRef, stacks: 1, duration: { kind: 'permanent' },
        values: { grantedActionId: event.actionId ?? 0 } } });
    commands.push({ type: 'schedule-turn', source: sourceRef, unitId: owner.unitId, scheduling: 'extra-turn', selection: 'action-gauge',
      parentEventId: event.eventId });
  }
  return commands.length ? commands : undefined;
}

function clearExtraTurnMarks(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if ((event.type !== 'action-ended' && event.type !== 'turn-ended') || event.scheduling !== 'extra-turn') return;
  const ownerId = event.type === 'turn-ended' ? event.unitId : event.source.unitId;
  if (!ownerId) return;
  const owner = context.getUnit(ownerId);
  if (!owner || owner.heroId !== redShadowYotoIds.hero) return;
  const ids: readonly string[] = [redShadowYotoIds.freeUltimate, redShadowYotoIds.extraTurnUltimate];
  const instances = owner.statuses.filter(status => ids.includes(status.statusId)
    && Number(status.values?.grantedActionId ?? 0) !== Number(event.actionId ?? 0)).map(status => status.instanceId);
  return instances.length ? [{ type: 'remove-status-instances', source: source(redShadowYotoIds.ultimate, owner.unitId),
    targetId: owner.unitId, instanceIds: instances, reason: 'consumed', parentEventId: event.eventId }] : undefined;
}

function refreshLowHealthAura(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (!['damage', 'healing', 'health-restored', 'life-lost', 'unit-revived', 'max-health-changed', 'status-added', 'status-removed'].includes(event.type)) return;
  if (event.type === 'status-removed' && event.statusId === redShadowYotoIds.lowHealthAura) return;
  if (event.type === 'status-added' && event.instance.statusId === redShadowYotoIds.lowHealthAura) return;
  const commands: EffectCommand[] = [];
  for (const owner of [...context.getLivingUnits('blue'), ...context.getLivingUnits('red')]
    .filter(unit => unit.heroId === redShadowYotoIds.hero)) {
    const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue').filter(unit => unit.unitKind !== 'summon');
    const lowest = [...enemies].sort((left, right) => hpRatio(left) - hpRatio(right))[0];
    const speed = lowest && passivesEnabled(owner) ? Math.max(0, Math.floor((1 - hpRatio(lowest)) * 100 + 1e-9)) : 0;
    const existing = owner.statuses.find(status => status.statusId === redShadowYotoIds.lowHealthAura);
    const prior = Number(existing?.modifiers?.find(modifier => modifier.stat === 'speed')?.amount ?? 0);
    if (existing && prior === speed || !existing && speed === 0) continue;
    const sourceRef = source(redShadowYotoIds.passive, owner.unitId);
    if (existing) commands.push({ type: 'remove-status-instances', source: sourceRef, targetId: owner.unitId,
      instanceIds: [existing.instanceId], reason: 'replaced', parentEventId: event.eventId });
    if (speed > 0) commands.push({ type: 'add-status', source: sourceRef, targetId: owner.unitId, parentEventId: event.eventId,
      instance: { instanceId: `${redShadowYotoIds.lowHealthAura}:${owner.unitId}`, statusId: redShadowYotoIds.lowHealthAura,
        source: sourceRef, stacks: 1, duration: { kind: 'permanent' }, modifiers: [{ stat: 'speed', operation: 'flat', amount: speed }] } });
  }
  return commands.length ? commands : undefined;
}

function hit(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, skillId: string, ratio: number): EffectCommand {
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const result = context.calculateDamage({ attack: offense.attack, defense: defense.defense, defenseIgnore: effectiveDefenseIgnore(actor),
    ratio, dmgFluctuation: .01, critChance: offense.crit, critDamage: offense.critDamage }, actor as UnitState, target as UnitState);
  return { type: 'deal-damage', source: source(skillId, actor.unitId), targetId: target.unitId, amount: result.amount,
    ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}), isCritical: result.isCritical,
    ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, offense.critDamage) } : {}) };
}

function validEnemy(actor: Readonly<UnitState>, target: Readonly<UnitState>): boolean {
  return actor.heroId === redShadowYotoIds.hero && actor.hp > 0 && target.hp > 0 && target.side !== actor.side;
}
function hpRatio(unit: Readonly<UnitState>): number { return unit.hp / Math.max(1, unit.stats.hp); }
function rank(unit: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel)); }
function lockedTarget(unit: Readonly<UnitState>): StatusInstance | undefined { return unit.statuses.find(status => status.statusId === redShadowYotoIds.lockedTarget); }
function source(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
