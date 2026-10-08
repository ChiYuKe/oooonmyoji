import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { battleSkillRow, skillNumber } from '../../../../../shared/game-skill-data';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const lanternSpiritIds = {
  hero: 266,
  basic: '2661',
  passive: '2662',
  ultimate: '2663',
  lanternLight: 'status.hero.266.lantern-light',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.2] as const;
const ultimateRatios = [1.58, 1.65, 1.72, 1.8, 1.9] as const;

export function registerLanternSpirit(registry: ContentRegistry): void {
  registry.registerStatus({ id: lanternSpiritIds.lanternLight, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace',
    modifyResourceCost(_state, _actor, skill, cost) { return skill.actionKind === 'skill' ? 0 : cost.amount; } });
  registry.registerHero(createLanternSpiritDefinition());
}

export function createLanternSpiritDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(lanternSpiritIds.basic, basicRatios);
  const ultimate: SkillDefinition = {
    id: lanternSpiritIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: ultimateRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.hp <= 0) return [];
      const stats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const source = lanternSource(lanternSpiritIds.ultimate, actor.unitId);
      const commands: EffectCommand[] = intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId);
        if (!target || target.hp <= 0) return [];
        const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
        const hit = context.calculateDamage({ attack: stats.attack, defense, defenseIgnore: effectiveDefenseIgnore(actor),
          ratio: Number(parameters.ratio ?? ultimateRatios[0]), critChance: stats.crit, critDamage: stats.critDamage }, actor, target);
        return [{ type: 'deal-damage' as const, source, targetId, amount: hit.amount,
          ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
          ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, stats.critDamage) } : {}),
          isCritical: hit.isCritical }];
      });
      if (skillRank(actor, lanternSpiritIds.ultimate) >= 5) {
        const allies = context.getLivingUnits(actor.side).filter(unit => unit.unitKind !== 'summon' && unit.unitKind !== 'onmyoji');
        const recipient = highestAttack(allies, context);
        if (recipient) commands.unshift({ type: 'add-status', source, targetId: recipient.unitId,
          instance: freeSkillStatus(actor, recipient, true, context.state.counters.action) });
      }
      return commands;
    },
  };

  return {
    id: lanternSpiritIds.hero,
    skills: [basic, ultimate],
    aiCoverage: 'partial', mechanicsCoverage: 'partial',
    aiCoverageNotes: ['鬼火不少于3时使用吸魂灯，否则使用幽光；目标权重和免火效果下的选招仍需校准'],
    mechanicsCoverageNotes: ['幽光按等级造成100%至120%攻击伤害，命中后以30%概率转移1点鬼火；吸魂灯消耗3火、按等级攻击敌方全体，每个目标独立以30%概率吸取1火。技能结算后，若己方鬼火多于敌方，则差额每1火使每个非怪物目标受到一次5%最大生命真实伤害，单目标总额不超过青行灯攻击力。明灯在其他非召唤友方式神回合开始时按技能等级判定，成功后该友方本回合下一次技能免火，并按触发时每点己方鬼火增伤5%；五级吸魂灯另给攻击最高的友方免火状态。免火与真实伤害的逐击御魂联动、同速插队、免火状态被驱散和多青行灯叠加仍需录像核验'],
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 3) return { actorId: unitId, skillId: lanternSpiritIds.ultimate,
        targetIds: enemies.map(unit => unit.unitId), shape: 'all-enemies', targetRelation: 'enemy' };
      const target = enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      return { actorId: unitId, skillId: lanternSpiritIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    handlers: {
      'turn-start': { priority: 28, handle(context, event) { return grantLanternLight(context, event); } },
      'attack-end': { priority: 28, handle(context, event) { return stealFireAndResolveDifference(context, event); } },
      'action-end': { priority: 28, handle(context, event) { return consumeLanternLight(context, event); } },
      'unit-defeated': { priority: 28, handle(context, event) { return clearOwnerLanternLight(context, event); } },
    },
  };
}

function grantLanternLight(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const target = context.getUnit(event.unitId);
  if (!target || target.hp <= 0 || target.unitKind === 'summon' || target.unitKind === 'onmyoji') return;
  const commands: EffectCommand[] = [];
  for (const owner of context.getLivingUnits(target.side).filter(unit => unit.heroId === lanternSpiritIds.hero
    && unit.unitId !== target.unitId && passivesEnabled(unit))) {
    const row = battleSkillRow(lanternSpiritIds.passive, skillRank(owner, lanternSpiritIds.passive), owner.awakeFilter,
      owner.unitKind === 'monster' || owner.unitKind === 'summon');
    const baseChance = skillNumber(row, 'param1') ?? .1;
    const firePenalty = skillNumber(row, 'param2') ?? 0;
    const fire = Math.max(0, context.state.resources[owner.side]?.fire ?? 0);
    const chance = Math.max(0, Math.min(1, baseChance + firePenalty * fire));
    if (context.random() >= chance) continue;
    const source = lanternSource(lanternSpiritIds.passive, owner.unitId);
    commands.push({ type: 'add-status', source, targetId: target.unitId, parentEventId: event.eventId,
      instance: freeSkillStatus(owner, target, false, undefined, fire * .05) });
  }
  return commands;
}

function freeSkillStatus(owner: Readonly<UnitState>, recipient: Readonly<UnitState>, permanent: boolean,
  grantedActionId?: number, damageBonus = 0): StatusInstance {
  const source = lanternSource(permanent ? lanternSpiritIds.ultimate : lanternSpiritIds.passive, owner.unitId);
  return { instanceId: `${lanternSpiritIds.lanternLight}:${owner.unitId}:${recipient.unitId}`,
    statusId: lanternSpiritIds.lanternLight, source, stacks: 1,
    duration: permanent ? { kind: 'permanent' } : { kind: 'count', remaining: 1, owner: 'target-turn' },
    ...(damageBonus > 0 ? { modifiers: [{ stat: 'damage' as const, operation: 'percent' as const, amount: damageBonus }] } : {}),
    values: { ownerUnitId: owner.unitId, keepOnOwnerDeath: permanent,
      ...(grantedActionId !== undefined ? { grantedActionId } : {}), ...(damageBonus > 0 ? { fireDamageBonus: damageBonus } : {}) } };
}

function consumeLanternLight(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || event.actionKind !== 'skill' || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor) return;
  const instances = actor.statuses.filter(status => status.statusId === lanternSpiritIds.lanternLight
    && status.values?.grantedActionId !== event.actionId).map(status => status.instanceId);
  return instances.length ? [{ type: 'remove-status-instances', source: lanternSource(lanternSpiritIds.passive, actor.unitId),
    targetId: actor.unitId, instanceIds: instances, reason: 'consumed', parentEventId: event.eventId }] : [];
}

function clearOwnerLanternLight(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || owner.heroId !== lanternSpiritIds.hero) return;
  const source = lanternSource(lanternSpiritIds.passive, owner.unitId);
  return context.getLivingUnits(owner.side).flatMap(ally => {
    const instances = ally.statuses.filter(status => status.statusId === lanternSpiritIds.lanternLight
      && status.source.unitId === owner.unitId && status.values?.keepOnOwnerDeath !== true).map(status => status.instanceId);
    return instances.length ? [{ type: 'remove-status-instances' as const, source, targetId: ally.unitId,
      instanceIds: instances, reason: 'expired' as const, parentEventId: event.eventId }] : [];
  });
}

function stealFireAndResolveDifference(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || !event.source.unitId || !event.targetHealthChanges?.length
    || ![lanternSpiritIds.basic, lanternSpiritIds.ultimate].includes(event.source.id as typeof lanternSpiritIds.basic)) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.heroId !== lanternSpiritIds.hero || actor.hp <= 0) return;
  const targetChanges = event.targetHealthChanges.filter(change => context.getUnit(change.targetId)?.side !== actor.side);
  if (!targetChanges.length) return;
  const skillId = event.source.id === lanternSpiritIds.basic ? lanternSpiritIds.basic : lanternSpiritIds.ultimate;
  const rank = skillRank(actor, skillId);
  const row = battleSkillRow(skillId, rank, actor.awakeFilter, actor.unitKind === 'monster' || actor.unitKind === 'summon');
  const chance = Math.max(0, Math.min(1, skillNumber(row, 'param1') ?? .3));
  let ownFire = Math.max(0, context.state.resources[actor.side]?.fire ?? 0);
  const enemySide = actor.side === 'blue' ? 'red' : 'blue';
  let enemyFire = Math.max(0, context.state.resources[enemySide]?.fire ?? 0);
  const ownCap = context.state.resourceMeters?.[actor.side]?.fire?.resourceCap ?? 8;
  const source = lanternSource(skillId, actor.unitId);
  const commands: EffectCommand[] = [];
  for (const change of targetChanges) {
    if (context.random() >= chance || enemyFire <= 0 || ownFire >= ownCap) continue;
    enemyFire--;
    ownFire++;
    commands.push({ type: 'change-resource', source, side: enemySide, resourceId: 'fire', amount: -1, parentEventId: event.eventId },
      { type: 'change-resource', source, side: actor.side, resourceId: 'fire', amount: 1, parentEventId: event.eventId });
  }
  if (skillId !== lanternSpiritIds.ultimate) return commands;
  let fireAdvantage = Math.max(0, ownFire - enemyFire);
  if (fireAdvantage <= 0) return commands;
  const attack = context.getEffectiveStats(actor.unitId)?.attack ?? actor.stats.attack;
  for (const change of targetChanges) {
    const target = context.getUnit(change.targetId);
    if (!target || target.hp <= 0 || target.unitKind === 'monster') continue;
    let remainingCap = attack;
    for (let hit = 0; hit < fireAdvantage && remainingCap > 0; hit++) {
      const amount = Math.min(target.stats.hp * .05, remainingCap);
      if (amount <= 0) break;
      commands.push({ type: 'deal-damage', source, targetId: target.unitId, amount, damageKind: 'true', parentEventId: event.eventId });
      remainingCap -= amount;
    }
  }
  return commands;
}

function highestAttack(units: readonly UnitState[], context: BattleContext): UnitState | undefined {
  return units.slice().sort((left, right) => (context.getEffectiveStats(right.unitId)?.attack ?? right.stats.attack)
    - (context.getEffectiveStats(left.unitId)?.attack ?? left.stats.attack)
    || left.unitId.localeCompare(right.unitId))[0];
}

function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}

function lanternSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
