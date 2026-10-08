import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const qingfangzhuIds = {
  hero: 273,
  basic: '2731',
  passive: '2732',
  ultimate: '2733',
  light: 'status.hero.273.buddha-light',
  lightAura: 'status.hero.273.buddha-light-aura',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [1.85, 1.95, 2.04, 2.13, 2.22] as const;
const maxLightStacks = 6;

/** 青坊主's client skill 2731–2733 and buff 2732 rows. */
export function registerQingfangzhu(registry: ContentRegistry): void {
  registry.registerStatus({ id: qingfangzhuIds.light, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack',
    stackScope: 'source-unit', maxStacks: maxLightStacks });
  registry.registerStatus({ id: qingfangzhuIds.lightAura, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerHero(createQingfangzhuDefinition());
}

export function createQingfangzhuDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(qingfangzhuIds.basic, basicRatios);
  const ultimate: SkillDefinition = {
    id: qingfangzhuIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', useClientDamageData: true,
    levels: ultimateRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), attack = context.getEffectiveStats(intent.actorId);
      if (!actor || !attack) return [];
      const stacks = actor.statuses.find(status => status.statusId === qingfangzhuIds.light)?.stacks ?? 0;
      const baseRatio = Number(parameters.ratio ?? 1.85);
      const suppression = Math.max(0, 1 - stacks * .1);
      const source = qingfangzhuSource(qingfangzhuIds.ultimate, actor.unitId);
      return intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId), defense = context.getEffectiveStats(targetId);
        if (!target || target.hp <= 0 || target.side === actor.side || !defense) return [];
        const summonMultiplier = target.unitKind === 'summon' ? 2 : 1;
        const hit = context.calculateDamage({ attack: attack.attack, defense: defense.defense,
          defenseIgnore: effectiveDefenseIgnore(actor), ratio: baseRatio * suppression * summonMultiplier,
          critChance: attack.crit, critDamage: attack.critDamage }, actor, target);
        return [{ type: 'deal-damage' as const, source, targetId, amount: hit.amount,
          ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
      });
    },
  };
  return {
    id: qingfangzhuIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入摩诃等级倍率、开战1层佛光/上限6层/最低保留1层、任一友方成功受控时叠层、青坊主自己回合结束减1层；佛光每层令青坊主效果抵抗+30%、其他友方+15%，禅心3火并按等级造成185%至222%伤害、每层佛光降低10%伤害、对召唤物伤害翻倍。客户端“回合结束”未明确计时对象，按本人回合结束处理；额外回合计时、多青坊主唯一效果归属、佛光驱散/封印交互及帧实战仍待核验'],
    handlers: {
      'battle-start': { priority: 45, handle(context, event) { return initializeBuddhaLight(context, event); } },
      'control-application': { priority: 45, handle(context, event) { return gainLightWhenAllyControlled(context, event); } },
      'unit-defeated': { priority: 45, handle(context, event) {
        if (event.type !== 'unit-defeated') return;
        const owner = context.getUnit(event.unitId);
        if (!owner || owner.heroId !== qingfangzhuIds.hero) return;
        const source = qingfangzhuSource(qingfangzhuIds.passive, owner.unitId);
        const commands: EffectCommand[] = [];
        if (owner.statuses.some(status => status.statusId === qingfangzhuIds.light)) commands.push({
          type: 'remove-statuses', source, targetId: owner.unitId, statusIds: [qingfangzhuIds.light],
          reason: 'consumed', parentEventId: event.eventId,
        });
        for (const ally of context.getLivingUnits(owner.side)) if (ally.statuses.some(status => status.statusId === qingfangzhuIds.lightAura
          && status.source.unitId === owner.unitId)) commands.push({ type: 'remove-statuses', source, targetId: ally.unitId,
          statusIds: [qingfangzhuIds.lightAura], reason: 'consumed', parentEventId: event.eventId });
        return commands;
      } },
      'effect-resolution': { priority: 45, handle(context, event) {
        if (event.type === 'status-added' && event.instance.statusId === qingfangzhuIds.light)
          return syncLightAura(context, event.targetId, event.eventId);
        if (event.type === 'status-removed' && event.statusId === qingfangzhuIds.light && event.reason !== 'replaced')
          return removeLightAura(context, event.targetId, event.eventId);
      } },
      'turn-end': { priority: 45, handle(context, event) { return loseLightAtOwnerTurnEnd(context, event); } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const skillId = (context.state.resources[actor.side]?.fire ?? 0) >= 3 ? qingfangzhuIds.ultimate : qingfangzhuIds.basic;
      return { actorId: unitId, skillId,
        targetIds: skillId === qingfangzhuIds.ultimate ? enemies.map(enemy => enemy.unitId)
          : [enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!.unitId],
        shape: skillId === qingfangzhuIds.ultimate ? 'all-enemies' : 'single', targetRelation: 'enemy' };
    },
  };
}

function initializeBuddhaLight(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'battle-started') return;
  const owners = (['blue', 'red'] as const).flatMap(side => context.getLivingUnits(side))
    .filter(unit => unit.heroId === qingfangzhuIds.hero && passivesEnabled(unit));
  const firstBySide = new Set<string>();
  return owners.flatMap(owner => {
    if (firstBySide.has(owner.side)) return [];
    firstBySide.add(owner.side);
    if (owner.statuses.some(status => status.statusId === qingfangzhuIds.light)) return [];
    return [lightCommand(owner, 1, event.eventId)];
  });
}

function gainLightWhenAllyControlled(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'control-applied') return;
  const controlled = context.getUnit(event.targetId);
  if (!controlled || controlled.hp <= 0) return;
  const owner = context.getLivingUnits(controlled.side).find(unit => unit.heroId === qingfangzhuIds.hero
    && passivesEnabled(unit));
  if (!owner) return;
  const light = owner.statuses.find(status => status.statusId === qingfangzhuIds.light);
  if ((light?.stacks ?? 0) >= maxLightStacks) return;
  return [{ type: 'add-status', source: qingfangzhuSource(qingfangzhuIds.passive, owner.unitId),
    targetId: owner.unitId, parentEventId: event.eventId, instance: {
      instanceId: `${qingfangzhuIds.light}:${owner.unitId}`, statusId: qingfangzhuIds.light,
      source: qingfangzhuSource(qingfangzhuIds.passive, owner.unitId), stacks: 1,
      duration: { kind: 'permanent' },
      modifiers: [{ stat: 'resist', operation: 'flat', amount: .3, perStack: true }],
    } }];
}

function loseLightAtOwnerTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || owner.heroId !== qingfangzhuIds.hero || !passivesEnabled(owner)) return;
  const light = owner.statuses.find(status => status.statusId === qingfangzhuIds.light);
  if (!light || light.stacks <= 1) return;
  const source = qingfangzhuSource(qingfangzhuIds.passive, owner.unitId);
  return [{ type: 'remove-status-instances', source, targetId: owner.unitId, instanceIds: [light.instanceId],
    reason: 'replaced', parentEventId: event.eventId },
    lightCommand(owner, light.stacks - 1, event.eventId)];
}

function syncLightAura(context: BattleContext, ownerId: string, parentEventId: string): EffectCommand[] | undefined {
  const owner = context.getUnit(ownerId);
  const light = owner?.statuses.find(status => status.statusId === qingfangzhuIds.light);
  if (!owner || owner.heroId !== qingfangzhuIds.hero || !light) return;
  const source = qingfangzhuSource(qingfangzhuIds.passive, owner.unitId);
  return context.getLivingUnits(owner.side).filter(ally => ally.unitId !== owner.unitId).map(ally => ({
    type: 'add-status' as const, source, targetId: ally.unitId, parentEventId,
    instance: { instanceId: `${qingfangzhuIds.lightAura}:${owner.unitId}:${ally.unitId}`,
      statusId: qingfangzhuIds.lightAura, source, stacks: light.stacks, duration: { kind: 'permanent' as const },
      modifiers: [{ stat: 'resist' as const, operation: 'flat' as const, amount: .15, perStack: true }] },
  }));
}

function removeLightAura(context: BattleContext, ownerId: string, parentEventId: string): EffectCommand[] | undefined {
  const owner = context.getUnit(ownerId);
  if (!owner || owner.heroId !== qingfangzhuIds.hero) return;
  const source = qingfangzhuSource(qingfangzhuIds.passive, owner.unitId);
  return context.getLivingUnits(owner.side).flatMap(ally => ally.statuses.some(status => status.statusId === qingfangzhuIds.lightAura
    && status.source.unitId === owner.unitId) ? [{ type: 'remove-statuses' as const, source, targetId: ally.unitId,
      statusIds: [qingfangzhuIds.lightAura], reason: 'consumed' as const, parentEventId }] : []);
}

function lightCommand(owner: Readonly<UnitState>, stacks: number, parentEventId: string): EffectCommand {
  const source = qingfangzhuSource(qingfangzhuIds.passive, owner.unitId);
  return { type: 'add-status', source, targetId: owner.unitId, parentEventId, instance: {
    instanceId: `${qingfangzhuIds.light}:${owner.unitId}`, statusId: qingfangzhuIds.light,
    source, stacks, duration: { kind: 'permanent' },
    modifiers: [{ stat: 'resist', operation: 'flat', amount: .3, perStack: true }],
  } };
}

function qingfangzhuSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
