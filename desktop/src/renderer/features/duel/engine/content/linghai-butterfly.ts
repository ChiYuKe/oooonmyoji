import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { soulSuppressionStatusId } from '../core/soul-eligibility';
import { attemptControl, attemptDebuff } from '../mechanics/control';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const linghaiButterflyIds = {
  hero: 382, basic: '3821', passive: '3822', heal: '3823', seaSpirit: 'status.hero.382.sea-spirit',
  attackDown: 'status.hero.382.attack-down', speedDown: 'status.hero.382.speed-down',
  defenseDown: 'status.hero.382.defense-down', freeze: 'status.hero.382.freeze', defenseBuff: 'status.hero.382.defense-buff',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const healRatios = [.12, .14, .14, .16, .16] as const;
const selfHealRatios = [0, 0, .16, .16, .16] as const;
const enemySide = (side: 'blue' | 'red'): 'blue' | 'red' => side === 'blue' ? 'red' : 'blue';
const isLinghai = (unit: Readonly<UnitState> | undefined): unit is Readonly<UnitState> => unit?.heroId === linghaiButterflyIds.hero;
const skillRank = (unit: Readonly<UnitState>, skillId: string): number => Math.max(1, Math.min(6,
  unit.skillLevels?.[skillId] ?? unit.skillLevel ?? 1));
const sourceFor = (skillId: string, unitId: string): SourceRef => ({ kind: 'skill', id: skillId, unitId });

export function registerLinghaiButterfly(registry: ContentRegistry): void {
  const ids = linghaiButterflyIds;
  const status = (id: string, category: StatusDefinition['category'], dispellable: boolean,
    preventsAction = false): StatusDefinition => ({ id, mechanicsCoverage: 'partial', category, dispellable,
    sealable: category === 'debuff' || category === 'control', durationOwner: 'target-turn', refreshPolicy: 'replace',
    ...(preventsAction ? { preventsAction } : {}) });
  registry.registerStatus(status(ids.seaSpirit, 'other', false));
  registry.registerStatus(status(ids.attackDown, 'debuff', true));
  registry.registerStatus(status(ids.speedDown, 'debuff', true));
  registry.registerStatus(status(ids.defenseDown, 'debuff', true));
  registry.registerStatus(status(ids.freeze, 'control', true, true));
  registry.registerStatus(status(ids.defenseBuff, 'buff', true));

  const basic = createBasicAttackSkill(ids.basic, basicRatios);
  const heal: SkillDefinition = {
    id: ids.heal, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'multi', targetRelation: 'ally', levels: healRatios.map((ratio, index) => ({ ratio, selfHealRatio: selfHealRatios[index]! })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || !isLinghai(owner) || owner.hp <= 0 || !passivesEnabled(owner)) return [];
      const rank = skillRank(owner, ids.heal);
      const ratio = Number(parameters?.ratio ?? healRatios[rank - 1]!);
      const attached = context.getLivingUnits(owner.side).filter(ally => ally.statuses.some(item => item.statusId === ids.seaSpirit)).length;
      const healMultiplier = 1 + attached * .1;
      const targets = intent.targetIds.map(targetId => context.getUnit(targetId)).filter((target): target is UnitState =>
        Boolean(target && target.hp > 0 && target.side === owner.side && target.unitKind !== 'summon'));
      const commands: EffectCommand[] = [];
      const source = sourceFor(ids.heal, owner.unitId);
      for (const target of targets) {
        commands.push({ type: 'heal', source, targetId: target.unitId, amount: target.stats.hp * ratio * healMultiplier });
        if (rank >= 5) commands.push({ type: 'add-status', source, targetId: target.unitId, instance: {
          instanceId: `${ids.defenseBuff}:${owner.unitId}:${target.unitId}`, statusId: ids.defenseBuff, source,
          stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
          modifiers: [{ stat: 'defense', operation: 'percent', amount: .2 }],
        } });
      }
      if (rank >= 3) commands.push({ type: 'heal', source, targetId: owner.unitId,
        amount: owner.stats.hp * Number(parameters?.selfHealRatio ?? selfHealRatios[rank - 1]!) });
      return commands;
    },
  };

  const definition: HeroDefinition = {
    id: ids.hero, skills: [basic, heal], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['按本地3821–3823技能行及3822海灵状态行接入波缀100%至125%普攻；灵巡按等级在回合结束附着海灵（觉醒后含自身、五级先机自身附着，四级增加至随机2个非召唤友方），海灵一回合持续、同一敌方回合多段攻击去重、三次触发移除，80%基础概率随机施加攻/速/防下降，二级加御魂封印、三级加冰冻；海心落耗2火，治疗最低2名非召唤友方12/14/14/16/16%最大生命，每个已有海灵使该次治疗增10%，三级起自疗16%，五级为治疗目标加20%防御。附着海灵的攻击回合归属、敌方多段/协战/间接伤害边界、随机效果的命中/抵抗顺序以及帧图未确认的持续窗口仍需验证。'],
    aiCoverageNotes: ['社区AI记录友方生命低于75%时使用3技能，普攻优先攻击生命比例低于20%的敌方；治疗技能不足2火时回退普攻，具体平局规则未知。'],
    initialize(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || !isLinghai(owner) || owner.hp <= 0 || !passivesEnabled(owner) || skillRank(owner, ids.passive) < 5) return [];
      return [seaSpiritCommand(owner, owner)];
    },
    policy(context, unitId): ActionIntent | undefined {
      const owner = context.getUnit(unitId);
      if (!owner || !isLinghai(owner) || owner.hp <= 0) return undefined;
      const allies = context.getLivingUnits(owner.side).filter(ally => ally.unitKind !== 'summon')
        .sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp));
      const enemies = context.getLivingUnits(enemySide(owner.side));
      if (!enemies.length) return undefined;
      const fire = context.state.resources[owner.side]?.fire ?? owner.resources.fire ?? 0;
      if (fire >= 2 && allies.some(ally => ally.hp / Math.max(1, ally.stats.hp) < .75)) {
        const targets = allies.slice(0, 2);
        return { actorId: unitId, skillId: ids.heal, targetIds: targets.map(ally => ally.unitId),
          selectedTargetId: targets[0]?.unitId, shape: 'multi', targetRelation: 'ally' };
      }
      const target = enemies.filter(enemy => enemy.hp / Math.max(1, enemy.stats.hp) < .2)
        .sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0]
        ?? enemies[0]!;
      return { actorId: unitId, skillId: ids.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    handlers: {
      'turn-start': { priority: 37, handle(context, event) { return recordAttackerTurn(context, event); } },
      'turn-end': { priority: 37, handle(context, event) { return attachSeaSpirits(context, event); } },
      hit: { priority: 37, handle(context, event) { return seaSpiritRetaliation(context, event); } },
    },
  };
  registry.registerHero(definition);
}

function attachSeaSpirits(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended' || !event.unitId) return;
  const owner = context.getUnit(event.unitId);
  if (!owner || !isLinghai(owner) || owner.hp <= 0 || !passivesEnabled(owner)) return;
  const rank = skillRank(owner, linghaiButterflyIds.passive);
  const source = sourceFor(linghaiButterflyIds.passive, owner.unitId);
  const candidates = context.getLivingUnits(owner.side).filter(ally => ally.unitKind !== 'summon' && ally.unitId !== owner.unitId);
  const targetCount = rank >= 4 ? 2 : 1;
  const chosen: UnitState[] = [];
  while (candidates.length > 0 && chosen.length < targetCount) {
    const index = Math.min(candidates.length - 1, Math.floor(context.random() * candidates.length));
    chosen.push(candidates.splice(index, 1)[0]!);
  }
  const commands = chosen.map(target => seaSpiritCommand(owner, target, event.eventId));
  if (owner.awakeFilter === 1) commands.push(seaSpiritCommand(owner, owner, event.eventId));
  return commands;
}

function seaSpiritCommand(owner: Readonly<UnitState>, target: Readonly<UnitState>, parentEventId?: string): EffectCommand {
  const source = sourceFor(linghaiButterflyIds.passive, owner.unitId);
  return { type: 'add-status', source, targetId: target.unitId, ...(parentEventId ? { parentEventId } : {}), instance: {
    instanceId: `${linghaiButterflyIds.seaSpirit}:${owner.unitId}:${target.unitId}`,
    statusId: linghaiButterflyIds.seaSpirit, source, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
    values: { triggerCount: 0 },
  } };
}

function recordAttackerTurn(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started' || !event.unitId) return;
  const attacker = context.getUnit(event.unitId);
  if (!attacker || attacker.hp <= 0) return;
  const commands: EffectCommand[] = [];
  for (const target of context.getLivingUnits(enemySide(attacker.side))) {
    for (const mark of target.statuses.filter(item => item.statusId === linghaiButterflyIds.seaSpirit)) {
      const tokenKey = `turn:${attacker.unitId}`;
      if (Number(mark.values?.[tokenKey] ?? -1) === event.actionId) continue;
      commands.push({ type: 'add-status', source: mark.source, targetId: target.unitId, parentEventId: event.eventId,
        instance: { ...mark, values: { ...mark.values, [tokenKey]: event.actionId ?? context.state.counters.action + 1 } } });
    }
  }
  return commands;
}

function seaSpiritRetaliation(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.source.unitId || !event.actionKind) return;
  const target = context.getUnit(event.targetId), attacker = context.getUnit(event.source.unitId);
  if (!target || !attacker || target.side === attacker.side) return;
  const commands: EffectCommand[] = [];
  for (const mark of target.statuses.filter(item => item.statusId === linghaiButterflyIds.seaSpirit)) {
    const owner = mark.source.unitId ? context.getUnit(mark.source.unitId) : undefined;
    if (!owner || !isLinghai(owner) || !passivesEnabled(owner)) continue;
    const token = Number(mark.values?.[`turn:${attacker.unitId}`] ?? event.actionId ?? 0);
    const seenKey = `seen:${attacker.unitId}`;
    if (token > 0 && Number(mark.values?.[seenKey] ?? -1) === token) continue;
    const nextCount = Number(mark.values?.triggerCount ?? 0) + 1;
    const parentEventId = event.eventId;
    const source = sourceFor(linghaiButterflyIds.passive, owner.unitId);
    if (nextCount >= 3) commands.push({ type: 'remove-status-instances', source, targetId: target.unitId,
      instanceIds: [mark.instanceId], reason: 'consumed', parentEventId });
    else commands.push({ type: 'add-status', source, targetId: target.unitId, parentEventId,
      instance: { ...mark, values: { ...mark.values, triggerCount: nextCount, [seenKey]: token } } });

    if (context.random() >= .8) continue;
    const options: Array<'attack' | 'speed' | 'defense' | 'soul' | 'freeze'> = ['attack', 'speed', 'defense'];
    if (skillRank(owner, linghaiButterflyIds.passive) >= 2) options.push('soul');
    if (skillRank(owner, linghaiButterflyIds.passive) >= 3) options.push('freeze');
    const chosen = options[Math.min(options.length - 1, Math.floor(context.random() * options.length))]!;
    const duration = { kind: 'count' as const, remaining: 1, owner: 'target-turn' as const };
    if (chosen === 'freeze') {
      const control = attemptControl(context, { attemptId: `${linghaiButterflyIds.freeze}:${event.eventId}:${owner.unitId}`,
        source, targetId: attacker.unitId, statusId: linghaiButterflyIds.freeze, controlType: '冰冻', baseChance: 1,
        duration, parentEventId });
      if (control) commands.push(control);
    } else {
      const statusId = chosen === 'attack' ? linghaiButterflyIds.attackDown
        : chosen === 'speed' ? linghaiButterflyIds.speedDown
          : chosen === 'defense' ? linghaiButterflyIds.defenseDown : soulSuppressionStatusId;
      const stat = chosen === 'attack' ? 'attack' : chosen === 'speed' ? 'speed' : chosen === 'defense' ? 'defense' : undefined;
      const amount = chosen === 'attack' ? -.3 : chosen === 'speed' ? -.25 : -.3;
      commands.push(...attemptDebuff(context, { source, targetId: attacker.unitId, statusId, baseChance: 1, duration,
        parentEventId, ...(stat ? { modifiers: [{ stat, operation: 'percent' as const, amount }] } : {}) }));
    }
  }
  return commands.length ? commands : undefined;
}
