import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const xiaoxiuIds = {
  hero: 302,
  basic: '3021',
  threads: '3022',
  ultimate: '3023',
  link: 'status.hero.302.threads',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const linkChance = [.4, .4, .5, .5, .6] as const;
const linkDuration = 3;
const damageTransferRatio = .7;
const linkDamageBonus = .3;
const transferredControlSourceId = '3022-control-transfer';
const transferredDamageSourceId = '3022-damage-transfer';

export function registerXiaoxiu(registry: ContentRegistry): void {
  const link: StatusDefinition = { id: xiaoxiuIds.link, mechanicsCoverage: 'partial', category: 'mark',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' };
  registry.registerStatus(link);
  registry.registerHero(createXiaoxiuDefinition());
}

export function createXiaoxiuDefinition(): HeroDefinition {
  const basic: SkillDefinition = { id: xiaoxiuIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    useClientDamageData: true, levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== xiaoxiuIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      return damageCommands(context, actor, target, Number(parameters.ratio ?? basicRatios[skillRank(actor, xiaoxiuIds.basic) - 1]!),
        xiaoxiuIds.basic);
    } };
  const threads: SkillDefinition = { id: xiaoxiuIds.threads, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single', targetRelation: 'enemy', levels: linkChance.map((chance, index) => ({ chance, duration: linkDuration,
      rank: index + 1 })),
    canUse(state, actor) { return actor.heroId === xiaoxiuIds.hero && contextHasSecondEnemy(state, actor); },
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const selected = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== xiaoxiuIds.hero || actor.hp <= 0 || !selected || selected.hp <= 0 || selected.side === actor.side) return [];
      const enemies = context.getLivingUnits(opposingSide(actor.side)).filter(enemy => enemy.unitId !== selected.unitId);
      if (enemies.length === 0) return [];
      const partner = enemies[Math.min(enemies.length - 1, Math.floor(context.random() * enemies.length))]!;
      const source = xiaoxiuSource(xiaoxiuIds.threads, actor.unitId);
      const chance = Number(parameters.chance ?? linkChance[skillRank(actor, xiaoxiuIds.threads) - 1]!);
      const duration = Math.max(1, Math.floor(Number(parameters.duration ?? linkDuration)));
      return [selected, partner].map((target, index) => ({ type: 'add-status' as const, source, targetId: target.unitId,
        instance: { instanceId: `${xiaoxiuIds.link}:${actor.unitId}:${target.unitId}`, statusId: xiaoxiuIds.link,
          source, stacks: 1, duration: { kind: 'count' as const, remaining: duration, owner: 'target-turn' as const },
          values: { partnerUnitId: index === 0 ? partner.unitId : selected.unitId, chance, ownerUnitId: actor.unitId } } }));
    } };
  const ultimate: SkillDefinition = { id: xiaoxiuIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', levels: ultimateRatios.map((ratio, index) => ({ ratio, linkedDamageBonus: index >= 4 ? linkDamageBonus : 0 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.heroId !== xiaoxiuIds.hero || actor.hp <= 0) return [];
      const selectedId = intent.targetIds[0];
      const selected = selectedId ? context.getUnit(selectedId) : undefined;
      const enemies = context.getLivingUnits(opposingSide(actor.side));
      if (!selected || selected.hp <= 0 || selected.side === actor.side || enemies.length === 0) return [];
      const ratio = Number(parameters.ratio ?? ultimateRatios[skillRank(actor, xiaoxiuIds.ultimate) - 1]!);
      const damageBonus = Number(parameters.linkedDamageBonus ?? (skillRank(actor, xiaoxiuIds.ultimate) >= 5 ? linkDamageBonus : 0));
      const commands: EffectCommand[] = [];
      const connectedTargets: UnitState[] = [];
      for (const target of enemies) {
        const linked = target.statuses.some(status => status.statusId === xiaoxiuIds.link && status.source.unitId === actor.unitId);
        if (linked) connectedTargets.push(target);
        const multiplier = linked ? 1 + damageBonus : 1;
        commands.push(...damageCommands(context, actor, target, ratio * multiplier, xiaoxiuIds.ultimate));
        if (target.unitId === selected.unitId) commands.push(...damageCommands(context, actor, target, ratio * multiplier,
          xiaoxiuIds.ultimate));
      }
      if (connectedTargets.length > 0) commands.push({ type: 'change-resource', source: xiaoxiuSource(xiaoxiuIds.ultimate, actor.unitId),
        side: actor.side, resourceId: 'fire', amount: connectedTargets.length });
      return commands;
    } };
  return {
    id: xiaoxiuIds.hero,
    skills: [basic, threads, ultimate],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入普攻倍率、丝缕相连2火连接选中敌人与另一随机敌方（40%/50%/60%控制传导概率，持续3个目标回合）、连线受击70%概率伤害传导、穿针引线3火群攻/选中目标追加一段、五级连线目标增伤30%及每个连线受击目标返1火。控制复制未接入“免除目标御魂/被动触发”事件抑制；召唤针线实体的生命/防御继承未表示为独立召唤物，链路伤害/御魂插入顺序与客户端多分支仍需帧图核验。'],
    handlers: {
      'control-application': { priority: 57, handle(context, event) { return transferLinkedControl(context, event); } },
      hit: { priority: 57, handle(context, event) { return transferLinkedDamage(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.heroId !== xiaoxiuIds.hero || actor.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(opposingSide(actor.side));
      if (!enemies.length) return undefined;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      const linkedCount = enemies.filter(enemy => enemy.statuses.some(status => status.statusId === xiaoxiuIds.link
        && status.source.unitId === actor.unitId)).length;
      if (fire >= 3) return xiaoxiuIntent(actor.unitId, xiaoxiuIds.ultimate, [enemies[0]!.unitId], 'single', 'enemy');
      if (fire >= 2 && enemies.length > 1 && linkedCount < 2)
        return xiaoxiuIntent(actor.unitId, xiaoxiuIds.threads, [enemies[0]!.unitId], 'single', 'enemy');
      return xiaoxiuIntent(actor.unitId, xiaoxiuIds.basic, [enemies[0]!.unitId], 'single', 'enemy');
    },
  };
}

function transferLinkedControl(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'control-applied' || event.source.id === transferredControlSourceId) return;
  const sourceUnitId = event.source.unitId;
  const victim = context.getUnit(event.targetId);
  if (!sourceUnitId || !victim || victim.hp <= 0 || context.getStatusCategory(event.statusId) !== 'control') return;
  const control = victim.statuses.find(status => status.statusId === event.statusId);
  if (!control || isFreeze(control.values?.controlType)) return;
  const commands: EffectCommand[] = [];
  for (const marker of victim.statuses.filter(status => status.statusId === xiaoxiuIds.link)) {
    const ownerId = String(marker.values?.ownerUnitId ?? marker.source.unitId ?? '');
    const partnerId = String(marker.values?.partnerUnitId ?? '');
    const owner = context.getUnit(ownerId), partner = context.getUnit(partnerId);
    if (!owner || owner.heroId !== xiaoxiuIds.hero || owner.hp <= 0 || owner.side === victim.side || !partner || partner.hp <= 0
      || partner.side !== victim.side || context.random() >= Number(marker.values?.chance ?? .4)) continue;
    const source = xiaoxiuSource(transferredControlSourceId, owner.unitId);
    commands.push({ type: 'apply-control', source, targetId: partner.unitId, parentEventId: event.eventId,
      scopeId: `xiaoxiu-link:${event.eventId}:${partner.unitId}`, instance: {
        instanceId: `${control.instanceId}:thread:${event.eventId}`, statusId: control.statusId, source, stacks: 1,
        duration: control.duration, values: control.values,
      } });
  }
  return commands;
}

function transferLinkedDamage(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.source.id === transferredDamageSourceId || !event.source.unitId || event.amount <= 0) return;
  const victim = context.getUnit(event.targetId);
  if (!victim) return;
  const commands: EffectCommand[] = [];
  for (const marker of victim.statuses.filter(status => status.statusId === xiaoxiuIds.link)) {
    const ownerId = String(marker.values?.ownerUnitId ?? marker.source.unitId ?? '');
    const partner = context.getUnit(String(marker.values?.partnerUnitId ?? ''));
    const owner = context.getUnit(ownerId);
    if (!owner || owner.heroId !== xiaoxiuIds.hero || owner.hp <= 0 || owner.side === victim.side || !partner || partner.hp <= 0
      || partner.side !== victim.side || context.random() >= Number(marker.values?.chance ?? .4)) continue;
    const source = xiaoxiuSource(transferredDamageSourceId, owner.unitId);
    commands.push({ type: 'deal-damage', source, targetId: partner.unitId, amount: event.amount * damageTransferRatio,
      precalculated: true, suppressSoulTriggers: true, suppressTargetSoulTriggers: true,
      suppressTargetPassiveTriggers: true, suppressSourcePassiveTriggers: true, parentEventId: event.eventId });
  }
  return commands;
}

function damageCommands(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, ratio: number,
  skillId: string): EffectCommand[] {
  const attack = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const hit = context.calculateDamage({ attack: attack.attack, defense: defense.defense,
    defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: attack.crit, critDamage: attack.critDamage }, actor as UnitState, target as UnitState);
  return [{ type: 'deal-damage', source: xiaoxiuSource(skillId, actor.unitId), targetId: target.unitId,
    amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
    ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, attack.critDamage) } : {}), isCritical: hit.isCritical }];
}

function contextHasSecondEnemy(state: Readonly<import('../core/types').BattleState>, actor: Readonly<UnitState>): boolean {
  return state.sides[opposingSide(actor.side)].filter(unitId => state.units[unitId]?.hp > 0).length >= 2;
}

function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}

function isFreeze(controlType: unknown): boolean {
  const value = String(controlType ?? '').toLowerCase();
  return value.includes('冰') || value.includes('冻') || value.includes('freeze');
}

function opposingSide(side: UnitState['side']): UnitState['side'] { return side === 'blue' ? 'red' : 'blue'; }

function xiaoxiuIntent(actorId: string, skillId: string, targetIds: readonly string[], shape: ActionIntent['shape'],
  targetRelation: NonNullable<ActionIntent['targetRelation']>): ActionIntent {
  return { actorId, skillId, targetIds, shape, targetRelation };
}

function xiaoxiuSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
