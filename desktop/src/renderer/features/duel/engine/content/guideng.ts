import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptControl } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const guidengIds = {
  hero: 308,
  basic: '3081',
  passive: '3082',
  ultimate: '3083',
  stun: 'status.hero.308.stun',
} as const;

const basicFirst = [.3, .32, .33, .35, .38] as const;
const basicSecond = [.7, .74, .77, .81, .88] as const;
const ultimateHits = [
  [.44, .88, 1.32], [.47, .93, 1.39], [.49, .97, 1.46], [.51, 1.02, 1.52], [.55, 1.1, 1.65],
] as const;
const stunChance = .22;
const cleanseStrikeRatio = .1;

export function registerGuideng(registry: ContentRegistry): void {
  registry.registerStatus({ id: guidengIds.stun, mechanicsCoverage: 'partial', category: 'control',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  registry.registerHero(createGuidengDefinition());
}

export function createGuidengDefinition(): HeroDefinition {
  const basic: SkillDefinition = {
    id: guidengIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy', useClientDamageData: true,
    levels: basicFirst.map((firstRatio, index) => ({ firstRatio, secondRatio: basicSecond[index]! })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.hp <= 0 || !target || target.hp <= 0) return [];
      const source = guidengSource(guidengIds.basic, actor.unitId);
      return [makeHit(context, actor, target, source, Number(parameters.firstRatio ?? basicFirst[0])),
        makeHit(context, actor, target, source, Number(parameters.secondRatio ?? basicSecond[0]))];
    },
  };
  const ultimate: SkillDefinition = {
    id: guidengIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', useClientDamageData: true,
    levels: ultimateHits.map(([firstRatio, secondRatio, thirdRatio]) => ({ firstRatio, secondRatio, thirdRatio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.hp <= 0 || !target || target.hp <= 0) return [];
      const source = guidengSource(guidengIds.ultimate, actor.unitId);
      return [parameters.firstRatio, parameters.secondRatio, parameters.thirdRatio]
        .map(ratio => makeHit(context, actor, target, source, Number(ratio)));
    },
  };
  return {
    id: guidengIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    aiCoverageNotes: ['鬼火不少于3时使用地狱之鬼，否则普攻；未提取官方选招权重与是否优先已眩晕目标。'],
    mechanicsCoverageNotes: ['已接入锤击二段等级倍率、地狱之鬼3火三段倍率、每次命中独立22%基础概率眩晕（效果命中/抵抗参与）、攻击眩晕目标必定暴击；自身回合结束且未受控制时，对带减益或控制的随机友方攻击两次、移除其减益/控制并提升30%行动条。tips_27按“自身未受控制”处理；多段攻击中途眩晕后的后续段必暴、友方解控对不可驱散负面效果的清除边界仍需运行帧核。'],
    handlers: {
      hit: { priority: 52, handle(context, event) { return stunOnHit(context, event); } },
      'turn-end': { priority: 52, handle(context, event) { return clearAllyDebuffs(context, event); } },
    },
    policy(context, actorId) {
      const actor = context.getUnit(actorId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = [...enemies].sort((a, b) => Number(hasControl(a, context)) - Number(hasControl(b, context))
        || a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      const fire = context.state.resources[actor.side]?.fire ?? actor.resources.fire ?? 0;
      return { actorId, skillId: fire >= 3 ? guidengIds.ultimate : guidengIds.basic,
        targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
}

function stunOnHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  const target = context.getUnit(event.targetId);
  if (!actor || actor.heroId !== guidengIds.hero || actor.unitKind === 'summon' || !passivesEnabled(actor)
    || !target || target.hp <= 0 || actor.side === target.side) return;
  const source = guidengSource(guidengIds.passive, actor.unitId);
  const command = attemptControl(context, { attemptId: `${guidengIds.stun}:${event.eventId}`, source,
    targetId: target.unitId, statusId: guidengIds.stun, controlType: '眩晕', baseChance: stunChance,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId: event.eventId,
    scopeId: `guideng:${event.attackId ?? event.eventId}` });
  return command ? [command] : undefined;
}

function clearAllyDebuffs(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.hp <= 0 || actor.heroId !== guidengIds.hero || actor.unitKind === 'summon' || !passivesEnabled(actor)
    || hasControl(actor, context)) return;
  const candidates = context.getLivingUnits(actor.side).filter(unit => unit.statuses.some(status => {
    const category = context.getStatusCategory(status.statusId);
    return category === 'debuff' || category === 'control' || typeof status.values?.controlType === 'string';
  }));
  if (!candidates.length) return;
  const target = candidates[Math.floor(context.random() * candidates.length)]!;
  const attack = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const source = guidengSource(guidengIds.passive, actor.unitId);
  const commands: EffectCommand[] = [
    makeAllyStrike(context, actor, target, source, attack.attack * cleanseStrikeRatio, event.eventId),
    makeAllyStrike(context, actor, target, source, attack.attack * cleanseStrikeRatio, event.eventId),
  ];
  const removeIds = target.statuses.filter(status => {
    const category = context.getStatusCategory(status.statusId);
    return category === 'debuff' || category === 'control' || typeof status.values?.controlType === 'string';
  }).map(status => status.instanceId);
  if (removeIds.length) commands.push({ type: 'remove-status-instances', source, targetId: target.unitId,
    instanceIds: removeIds, reason: 'consumed', parentEventId: event.eventId });
  commands.push({ type: 'change-action-gauge', source, targetId: target.unitId, amount: 30, parentEventId: event.eventId });
  return commands;
}

function makeHit(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, source: SourceRef,
  ratio: number): EffectCommand {
  const attack = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
  const result = context.calculateDamage({ attack: attack.attack, defense, defenseIgnore: effectiveDefenseIgnore(actor), ratio,
    critChance: hasStun(target) ? 1 : attack.crit, critDamage: attack.critDamage }, actor as UnitState, target as UnitState);
  return { type: 'deal-damage', source, targetId: target.unitId, amount: result.amount,
    ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}),
    ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, attack.critDamage) } : {}),
    isCritical: result.isCritical };
}

function makeAllyStrike(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, source: SourceRef,
  amount: number, parentEventId: string): EffectCommand {
  const attack = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
  const result = context.calculateDamage({ attack: attack.attack, defense, ratio: cleanseStrikeRatio,
    critChance: 0, critDamage: attack.critDamage }, actor as UnitState, target as UnitState);
  return { type: 'deal-damage', source, targetId: target.unitId, amount: Math.min(amount, result.amount),
    damageOptions: result.damageOptions, isCritical: false, parentEventId };
}

function hasStun(unit: Readonly<UnitState>): boolean {
  return unit.statuses.some(status => status.statusId === guidengIds.stun || status.values?.controlType === '眩晕');
}

function hasControl(unit: Readonly<UnitState>, context: BattleContext): boolean {
  return unit.statuses.some(status => status.values?.controlType !== undefined
    || context.getStatusCategory(status.statusId) === 'control');
}

function guidengSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
