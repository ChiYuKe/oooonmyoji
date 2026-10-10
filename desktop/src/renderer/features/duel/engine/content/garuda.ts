import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { isUnitBanished } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const garudaIds = {
  hero: 378, basic: '3781', passive: '3782', ultimate: '3783',
  xiyu: 'status.hero.378.xiyu', triggerFailures: 'status.hero.378.trigger-failures',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const procChance = [.07, .08, .09, .1, .1] as const;
const xiyuChance = [.4, .6, .8, 1, 1] as const;
const enemySide = (side: 'blue' | 'red'): 'blue' | 'red' => side === 'blue' ? 'red' : 'blue';
const isGaruda = (unit: Readonly<UnitState> | undefined): unit is Readonly<UnitState> => unit?.heroId === garudaIds.hero;
const rank = (unit: Readonly<UnitState>, skillId: string): number => Math.max(1, Math.min(6,
  unit.skillLevels?.[skillId] ?? unit.skillLevel ?? 1));
const sourceFor = (skillId: string, unitId: string): SourceRef => ({ kind: 'skill', id: skillId, unitId });

export function registerGaruda(registry: ContentRegistry): void {
  const ids = garudaIds;
  const xiyuStatus: StatusDefinition = {
    id: ids.xiyu, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
    durationOwner: 'permanent', refreshPolicy: 'replace',
    handlers: { 'effect-resolution': { priority: 44, handle(context, event) { return counterOnGaugeGain(context, event); } } },
  };
  registry.registerStatus(xiyuStatus);
  registry.registerStatus({ id: ids.triggerFailures, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });

  const basicTemplate = createBasicAttackSkill(ids.basic, basicRatios);
  const basic: SkillDefinition = { ...basicTemplate,
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || !isGaruda(owner) || owner.hp <= 0 || !target || target.hp <= 0 || target.side === owner.side) return [];
      const source = sourceFor(ids.basic, owner.unitId);
      const attack = context.getEffectiveStats(owner.unitId) ?? owner.stats;
      const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
      const hit = context.calculateDamage({ attack: attack.attack, defense, defenseIgnore: effectiveDefenseIgnore(owner),
        ratio: Number(parameters?.ratio ?? 1), critChance: attack.crit, critDamage: attack.critDamage }, owner, target);
      const commands: EffectCommand[] = [{ type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount,
        shieldDmgAddRate: passivesEnabled(owner) ? .2 : undefined,
        ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
      const mark = target.statuses.find(status => status.statusId === ids.xiyu && status.source.unitId === owner.unitId);
      // The passive counterattack consumes Xiyu only after its hit resolution decides whether it damaged HP.
      if (mark && intent.kind !== 'passive') commands.push(...consumeXiyu(context, owner, target, mark, source));
      return commands;
    },
  };
  const ultimate: SkillDefinition = {
    id: ids.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: [1, 2, 3, 4, 5].map(() => ({ ratio: 1.34 })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || !isGaruda(owner) || owner.hp <= 0 || !isFirstGaruda(context.state, owner)) return [];
      const source = sourceFor(ids.ultimate, owner.unitId);
      const ownerRank = rank(owner, ids.ultimate);
      const commands: EffectCommand[] = [];
      for (const targetId of intent.targetIds) {
        const target = context.getUnit(targetId);
        if (!target || target.hp <= 0 || target.side === owner.side) continue;
        const hit = garudaDamage(context, owner, target, source, Number(parameters?.ratio ?? 1.34));
        commands.push(hit);
        const applied = attemptDebuff(context, { source, targetId: target.unitId, statusId: ids.xiyu,
          baseChance: xiyuChance[ownerRank - 1]!, duration: { kind: 'permanent' } });
        commands.push(...applied);
      }
      return commands;
    },
  };
  const definition: HeroDefinition = {
    id: ids.hero, skills: [basic, ultimate], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['按本地3781–3783技能行及3782惜羽状态行接入普攻100%至125%、技能/普攻额外20%护盾伤害、敌方回合末7%至10%必定命中全体施加惜羽、惜羽目标获得行动条时迦楼罗反击普攻、直接攻击消耗惜羽并治疗最低生命友方10%迦楼罗最大生命；三技能3火/134%群伤/40%至100%附加惜羽、五级确保附加。觉醒后解锁惜羽消耗治疗；被动连续5次未触发且可行动时免费施放三技能。自动行动条增益由调度器统一发事件并驱动反击。惜羽抵抗/驱散细节、护盾伤害与吸收数字、同一群体推条上的逐目标反击次序、五级三技能“必定”的精确目标范围和反击触发御魂链仍需实战帧；本场无迦楼罗。'],
    aiCoverageNotes: ['社区AI记录为无条件使用3技能；策略在有3火时用三技能，火不足时明确选普攻。三技能选中目标只用于多目标完整阵列的技能输入，客户端目标选择顺序尚缺帧证据。'],
    handlers: {
      'turn-end': { priority: 44, handle(context, event) { return afterEnemyTurn(context, event, registry); } },
      hit: { priority: 44, handle(context, event) { return resolveCounterXiyu(context, event); } },
    },
    policy(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.hp <= 0 || !isGaruda(owner) || !isFirstGaruda(context.state, owner)) return undefined;
      const enemies = context.getLivingUnits(enemySide(owner.side));
      if (!enemies.length) return undefined;
      const skillId = (context.state.resources[owner.side]?.fire ?? owner.resources.fire ?? 0) >= 3 ? ids.ultimate : ids.basic;
      return { actorId: unitId, skillId, targetIds: skillId === ids.ultimate ? enemies.map(unit => unit.unitId) : [enemies[0]!.unitId],
        ...(skillId === ids.ultimate ? { selectedTargetId: enemies[0]!.unitId } : {}),
        shape: skillId === ids.ultimate ? 'all-enemies' : 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function isFirstGaruda(state: BattleContext['state'], owner: Readonly<UnitState>): boolean {
  return state.sides[owner.side].map(unitId => state.units[unitId]).find(unit => unit && isGaruda(unit))?.unitId === owner.unitId;
}

function garudaDamage(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, source: SourceRef,
  ratio: number): EffectCommand {
  const attack = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
  const hit = context.calculateDamage({ attack: attack.attack, defense, defenseIgnore: effectiveDefenseIgnore(owner),
    ratio, critChance: attack.crit, critDamage: attack.critDamage }, owner, target);
  return { type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount,
    shieldDmgAddRate: passivesEnabled(owner) ? .2 : undefined,
    ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical };
}

function afterEnemyTurn(context: BattleContext, event: BattleEvent, registry: ContentRegistry): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended' || !event.unitId) return;
  const unit = context.getUnit(event.unitId);
  if (!unit || unit.unitKind === 'summon') return;
  const owner = context.getLivingUnits(enemySide(unit.side)).find(candidate => isGaruda(candidate)
    && isFirstGaruda(context.state, candidate));
  if (!owner || !passivesEnabled(owner)) return;
  const source = sourceFor(garudaIds.passive, owner.unitId);
  const current = owner.statuses.find(status => status.statusId === garudaIds.triggerFailures && status.source.unitId === owner.unitId);
  const nextFailure = Number(current?.values?.count ?? 0) + 1;
  const succeeded = context.random() < procChance[rank(owner, garudaIds.passive) - 1]!;
  const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: owner.unitId, instance: {
    instanceId: `${garudaIds.triggerFailures}:${owner.unitId}`, statusId: garudaIds.triggerFailures, source, stacks: 1,
    duration: { kind: 'permanent' }, values: { count: succeeded ? 0 : nextFailure >= 5 ? 0 : nextFailure },
  }, parentEventId: event.eventId }];
  if (succeeded) {
    for (const enemy of context.getLivingUnits(enemySide(owner.side))) commands.push({ type: 'add-status', source,
      targetId: enemy.unitId, instance: { instanceId: `${garudaIds.xiyu}:${owner.unitId}:${enemy.unitId}`,
        statusId: garudaIds.xiyu, source, stacks: 1, duration: { kind: 'permanent' } }, parentEventId: event.eventId });
  } else if (nextFailure >= 5 && rank(owner, garudaIds.passive) >= 5 && !context.isUnitUnableToAct(owner.unitId)
    && !isUnitBanished(owner)) {
    const enemies = context.getLivingUnits(enemySide(owner.side));
    if (enemies.length) commands.push({ type: 'schedule-action', source, scheduling: 'counter', freeCast: true,
      parentEventId: event.eventId, intent: { actorId: owner.unitId, skillId: garudaIds.ultimate,
        targetIds: enemies.map(enemy => enemy.unitId), selectedTargetId: enemies[0]!.unitId,
        shape: 'all-enemies', targetRelation: 'enemy' } });
  }
  return commands;
}

function counterOnGaugeGain(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-gauge-changed' || event.after <= event.before) return;
  const target = context.getUnit(event.unitId);
  if (!target || target.hp <= 0) return;
  const mark = target.statuses.find(status => status.statusId === garudaIds.xiyu);
  if (!mark?.source.unitId) return;
  const owner = context.getUnit(mark.source.unitId);
  if (!owner || owner.hp <= 0 || !isGaruda(owner) || owner.side === target.side || !isFirstGaruda(context.state, owner)
    || !passivesEnabled(owner) || context.isUnitUnableToAct(owner.unitId) || isUnitBanished(owner)) return;
  return [{ type: 'schedule-action', source: sourceFor(garudaIds.passive, owner.unitId), scheduling: 'counter', freeCast: true,
    parentEventId: event.eventId, intent: { actorId: owner.unitId, skillId: garudaIds.basic,
      targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy', kind: 'passive' } }];
}

function resolveCounterXiyu(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.actionKind !== 'passive' || event.source.id !== garudaIds.basic || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId);
  const target = context.getUnit(event.targetId);
  const mark = target?.statuses.find(status => status.statusId === garudaIds.xiyu && status.source.unitId === event.source.unitId);
  if (!owner || !isGaruda(owner) || !target || !mark) return;
  const source = sourceFor(garudaIds.passive, owner.unitId);
  if (event.hpLost > 0) return consumeXiyu(context, owner, target, mark, source, event.eventId);
  if ((event.shieldConsumed ?? 0) <= 0) return [{ type: 'remove-status-instances', source, targetId: target.unitId,
    instanceIds: [mark.instanceId], reason: 'consumed', parentEventId: event.eventId }];
  const hits = Number(mark.values?.shieldHits ?? 0) + 1;
  return hits >= 10
    ? [{ type: 'remove-status-instances', source, targetId: target.unitId, instanceIds: [mark.instanceId],
      reason: 'consumed', parentEventId: event.eventId }]
    : [{ type: 'add-status', source, targetId: target.unitId, instance: { ...mark,
      values: { ...mark.values, shieldHits: hits } }, parentEventId: event.eventId }];
}

function consumeXiyu(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, mark: UnitState['statuses'][number], source: SourceRef,
  parentEventId?: string): EffectCommand[] {
  const commands: EffectCommand[] = [{ type: 'remove-status-instances', source, targetId: target.unitId,
    instanceIds: [mark.instanceId], reason: 'consumed', ...(parentEventId ? { parentEventId } : {}) }];
  if (owner.awakeFilter !== 1 || !passivesEnabled(owner)) return commands;
  const allies = [...context.getLivingUnits(owner.side)];
  const lowest = allies.sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0];
  return lowest ? [...commands, { type: 'heal', source, targetId: lowest.unitId, amount: owner.stats.hp * .1,
    ...(parentEventId ? { parentEventId } : {}) }] : commands;
}
