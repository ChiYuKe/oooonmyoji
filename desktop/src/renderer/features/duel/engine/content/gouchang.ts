import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import type { ContentRegistry } from './registry';

export const gouchangIds = {
  hero: 361,
  basic: '3611',
  passive: '3612',
  ultimate: '3613',
  hitDown: 'status.hero.361.hit-down',
  mildew: 'status.hero.361.mildew-ball',
  resistance: 'status.hero.361.resistance',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.2] as const;
const ultimateRatios = [2.11, 2.23, 2.35, 2.47, 2.47] as const;

export function registerGouchang(registry: ContentRegistry): void {
  registry.registerStatus({ id: gouchangIds.hitDown, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: gouchangIds.mildew, mechanicsCoverage: 'partial', category: 'mark', dispellable: true,
    sealable: true, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 4, stackScope: 'source-unit' });
  registry.registerStatus({ id: gouchangIds.resistance, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerHero(createGouchangDefinition());
}

export function createGouchangDefinition(): HeroDefinition {
  const basic: SkillDefinition = {
    id: gouchangIds.basic, target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.hp <= 0 || !target || target.hp <= 0) return [];
      const source = gouchangSource(gouchangIds.basic, actor.unitId);
      const stats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
      const hit = context.calculateDamage({ attack: stats.attack, defense: targetStats.defense,
        ratio: Number(parameters.ratio ?? 1), critChance: stats.crit, critDamage: stats.critDamage }, actor, target);
      return [{ type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount,
        ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical },
      ...attemptDebuff(context, { source, targetId: target.unitId, statusId: gouchangIds.hitDown,
        baseChance: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
        modifiers: [{ stat: 'hit', operation: 'flat', amount: -.25 }] })];
    },
  };
  const ultimate: SkillDefinition = {
    id: gouchangIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single', targetRelation: 'enemy',
    levels: ultimateRatios.map((ratio, rank) => ({ ratio, pushPerStack: rank === 4 ? 15 : 0 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.hp <= 0 || !target || target.hp <= 0) return [];
      const source = gouchangSource(gouchangIds.ultimate, actor.unitId);
      const stats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
      const hit = context.calculateDamage({ attack: stats.attack, defense: targetStats.defense,
        ratio: Number(parameters.ratio ?? 2.11), critChance: stats.crit, critDamage: stats.critDamage }, actor, target);
      const stacks = actor.statuses.filter(status => status.statusId === gouchangIds.mildew)
        .reduce((total, status) => total + status.stacks, 0);
      const commands: EffectCommand[] = [{ type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount,
        ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
      if (stacks > 0) {
        commands.push({ type: 'remove-statuses', source, targetId: actor.unitId, statusIds: [gouchangIds.mildew], reason: 'consumed' });
        const push = stacks * Number(parameters.pushPerStack ?? 0);
        if (push > 0) commands.push({ type: 'change-action-gauge', source, targetId: target.unitId, amount: -push, checkImmunity: true });
      }
      for (const ally of context.getLivingUnits(actor.side)) {
        commands.push({ type: 'add-status', source, targetId: ally.unitId, instance: {
          instanceId: `${gouchangIds.resistance}:${actor.unitId}:${ally.unitId}`,
          statusId: gouchangIds.resistance, source, stacks: 1,
          duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
          modifiers: [{ stat: 'resist', operation: 'flat', amount: .2 }],
        } });
      }
      return commands;
    },
  };
  return {
    id: gouchangIds.hero,
    skills: [basic, ultimate],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已遷移普攻減25%效果命中、敵方行動回合後隨機淨化最多3個減益/控制並疊加霉球、兩火單體大招與全隊20%效果抵抗；五級大招按每層擊退15%行動條。客户端技能表另记4层时自身回合末承受30%最大生命伤害，而官方图鉴只写清除霉球；该分支当前按客户端表实现，仍待实战帧核对。'],
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (enemies.length === 0) return undefined;
      const target = [...enemies].sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      const stacks = actor.statuses.filter(status => status.statusId === gouchangIds.mildew)
        .reduce((total, status) => total + status.stacks, 0);
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      return fire >= 2 && stacks > 0
        ? { actorId: unitId, skillId: gouchangIds.ultimate, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' }
        : { actorId: unitId, skillId: gouchangIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    handlers: {
      'turn-end': { priority: 45, handle(context, event) { return gouchangTurnEnd(context, event); } },
    },
  };
}

function gouchangTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const actor = context.getUnit(event.unitId);
  if (!actor) return;
  const source = gouchangSource(gouchangIds.passive, actor.unitId);
  if (actor.heroId === gouchangIds.hero) {
    const mark = actor.statuses.find(status => status.statusId === gouchangIds.mildew);
    const stacks = mark?.stacks ?? 0;
    const commands: EffectCommand[] = [];
    if (stacks > 0) {
      commands.push({ type: 'remove-statuses', source, targetId: actor.unitId, statusIds: [gouchangIds.mildew], reason: 'expired' });
      if (stacks >= 4 && passivesEnabled(actor)) commands.push({ type: 'lose-life', source, targetId: actor.unitId,
        amount: actor.stats.hp * .3, lifeLossKind: 'direct', parentEventId: event.eventId });
    }
    return commands.length ? commands : undefined;
  }
  if (actor.side === 'blue') return gouchangEnemyTurn(context, event, 'red');
  return gouchangEnemyTurn(context, event, 'blue');
}

function gouchangEnemyTurn(context: BattleContext, event: BattleEvent, ownerSide: 'blue' | 'red'): EffectCommand[] | undefined {
  const owner = context.state.sides[ownerSide].map(id => context.getUnit(id)).find(unit => unit?.heroId === gouchangIds.hero
    && unit.hp > 0 && !context.isUnitUnableToAct(unit.unitId) && passivesEnabled(unit)
    && (unit.statuses.find(status => status.statusId === gouchangIds.mildew)?.stacks ?? 0) < 4);
  const endedUnit = event.type === 'turn-ended' ? context.getUnit(event.unitId) : undefined;
  if (!owner || !endedUnit || endedUnit.side === ownerSide) return;
  const allies = context.getLivingUnits(ownerSide);
  if (allies.length === 0) return;
  const selected = allies[Math.min(allies.length - 1, Math.floor(context.random() * allies.length))]!;
  const source = gouchangSource(gouchangIds.passive, owner.unitId);
  const commands: EffectCommand[] = [];
  const removable = selected.statuses.some(status => context.isStatusDispellable(status.statusId)
    && ['debuff', 'control'].includes(context.getStatusCategory(status.statusId) ?? ''));
  if (removable) commands.push({ type: 'dispel-statuses', source, targetId: selected.unitId, maxCount: 3,
    filter: 'debuff-or-control', parentEventId: event.eventId });
  const currentMark = owner.statuses.find(status => status.statusId === gouchangIds.mildew);
  const marker: StatusInstance = { instanceId: `${gouchangIds.mildew}:${owner.unitId}`, statusId: gouchangIds.mildew,
    source, stacks: 1, duration: { kind: 'permanent' },
    modifiers: [{ stat: 'resist', operation: 'flat', amount: -.15, perStack: true }],
    ...(currentMark?.values ? { values: currentMark.values } : {}) };
  commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: marker, parentEventId: event.eventId });
  return commands;
}

function gouchangSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
