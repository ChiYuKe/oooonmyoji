import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import type { ContentRegistry } from './registry';

export const lumingOotakemaruIds = {
  hero: 355, basic: '3551', stance: '3552', ultimate: '3553', revenantAttack: '3554',
  erosion: 'status.hero.355.erosion', pressure: 'status.hero.355.pressure', soulRiding: 'status.hero.355.soul-riding',
  revenant: 'status.hero.355.revenant', luze: 'status.hero.355.luze',
} as const;

export function registerLumingOotakemaru(registry: ContentRegistry): void {
  registry.registerStatus({ id: lumingOotakemaruIds.erosion, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: lumingOotakemaruIds.pressure, mechanicsCoverage: 'partial', category: 'control',
    dispellable: false, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  registry.registerStatus({ id: lumingOotakemaruIds.soulRiding, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: true, durationOwner: 'source-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: lumingOotakemaruIds.revenant, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep',
    controlProtection: 'immune', statusImmunity: 'debuffs' });
  registry.registerStatus({ id: lumingOotakemaruIds.luze, mechanicsCoverage: 'partial', category: 'mark',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 4 });
  registry.registerHero(createLumingOotakemaruDefinition());
}

export function createLumingOotakemaruDefinition(): HeroDefinition {
  const basic: SkillDefinition = {
    id: lumingOotakemaruIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: [1, 1.05, 1.1, 1.15, 1.25].map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || !target || target.hp <= 0) return [];
      const source = lumingSource(lumingOotakemaruIds.basic, owner.unitId);
      return [...deal(context, owner, target, source, Number(parameters.ratio ?? 1)), ...applyErosion(context, target, source)];
    },
  };
  const stance: SkillDefinition = {
    id: lumingOotakemaruIds.stance, actionKind: 'skill', target: 'self', targetRelation: 'ally',
    levels: [{ turns: 2 }, { turns: 2 }, { turns: 2 }, { turns: 3 }, { turns: 3 }],
    canUse: (_state, actor) => actor.heroId === lumingOotakemaruIds.hero && !hasStatus(actor, lumingOotakemaruIds.soulRiding)
      && !hasStatus(actor, lumingOotakemaruIds.revenant),
    execute(_context, intent, parameters) {
      const source = lumingSource(lumingOotakemaruIds.stance, intent.actorId);
      return [{ type: 'add-status', source, targetId: intent.actorId, instance: {
        instanceId: `${lumingOotakemaruIds.soulRiding}:${intent.actorId}`,
        statusId: lumingOotakemaruIds.soulRiding, source, stacks: 1,
        duration: { kind: 'count', remaining: Number(parameters.turns ?? 2), owner: 'source-turn' },
        modifiers: [{ stat: 'resist', operation: 'flat', amount: 1 }],
      } }];
    },
  };
  const ultimate: SkillDefinition = {
    id: lumingOotakemaruIds.ultimate, actionKind: 'skill', target: 'all-enemies', targetRelation: 'enemy',
    levels: [1.8, 2, 2.2, 2.4, 2.4].map(ratio => ({ ratio })),
    resolveResourceCost(_state, actor) {
      const stacks = actor.statuses.find(status => status.statusId === lumingOotakemaruIds.luze)?.stacks ?? 0;
      return { resourceId: 'fire', amount: Math.max(0, 4 - stacks) };
    },
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      if (!owner) return [];
      const source = lumingSource(lumingOotakemaruIds.ultimate, owner.unitId);
      const commands: EffectCommand[] = [];
      const luze = owner.statuses.find(status => status.statusId === lumingOotakemaruIds.luze);
      if (skillRank(owner, lumingOotakemaruIds.ultimate) >= 5) {
        for (const targetId of intent.targetIds) {
          const target = context.getUnit(targetId);
          if (!target || target.hp <= 0) continue;
          const buffs = target.statuses.filter(status => context.getStatusCategory(status.statusId) === 'buff'
            && context.isStatusDispellable(status.statusId));
          if (buffs[0]) commands.push({ type: 'dispel-statuses', source, targetId, maxCount: 1, filter: 'buff' });
        }
      }
      for (const targetId of intent.targetIds) {
        const target = context.getUnit(targetId);
        if (!target || target.hp <= 0) continue;
        commands.push(...deal(context, owner, target, source, Number(parameters.ratio ?? 1.8)));
        if (hasStatus(owner, lumingOotakemaruIds.soulRiding)) commands.push(...applyErosion(context, target, source));
      }
      if (luze) commands.push({ type: 'remove-status-instances', source, targetId: owner.unitId,
        instanceIds: [luze.instanceId], reason: 'consumed' });
      return commands;
    },
  };
  const revenantAttack: SkillDefinition = {
    id: lumingOotakemaruIds.revenantAttack, actionKind: 'skill', target: 'single', targetRelation: 'enemy',
    levels: [{ ratio: 2.4, hits: 5 }],
    canUse: (_state, actor) => actor.heroId === lumingOotakemaruIds.hero && hasStatus(actor, lumingOotakemaruIds.revenant),
    execute(context, intent) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || owner.hp <= 0) return [];
      const enemies = context.getLivingUnits(enemySide(owner.side));
      if (!enemies.length) return [];
      const source = lumingSource(lumingOotakemaruIds.revenantAttack, owner.unitId);
      const commands: EffectCommand[] = [];
      for (let hit = 0; hit < 5; hit++) {
        const living = context.getLivingUnits(enemySide(owner.side));
        if (!living.length) break;
        const target = living[Math.floor(context.random() * living.length)]!;
        commands.push(...deal(context, owner, target, source, 2.4));
      }
      return commands;
    },
  };

  return {
    id: lumingOotakemaruIds.hero, skills: [basic, stance, ultimate, revenantAttack],
    mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入麓影·蚀等级倍率和麓蚀攻/疗削弱、目标回合结束转不可驱散眩晕与减速的麓压、铭海之主2至3回合驭魂与效果抵抗/二级单体减伤/三级非召唤阵亡回血、友方妖术积累最多4层麓泽并抵扣断末无铭耗火、四火群攻与五级先驱散；非召唤单位阵亡3名后转归骸形态并自动使用五段逆魂尽断。归骸形态清空全部状态、100速度、50%减伤、控制/减益免疫和12%吸血已接入。因10点场没有麓铭大岳丸帧，状态先后、连续阵亡转形态的实时窗口、实战AI与御魂插入顺序仍需帧核。'],
    initialize(context, unitId) {
      const owner = context.getUnit(unitId);
      return owner && skillRank(owner, lumingOotakemaruIds.stance) >= 5
        ? enterSoulRiding(unitId, 3) : [];
    },
    handlers: {
      'unit-defeated': { priority: 160, handle(context, event) { return onUnitDefeated(context, event); } },
      'action-end': { priority: 160, handle(context, event) { return onActionEnded(context, event); } },
      'turn-end': { priority: 160, handle(context, event) { return convertErosion(context, event); } },
    },
    interceptIncomingDamage(_state, attacker, target, amount, _kind, hitContext) {
      if (target.heroId !== lumingOotakemaruIds.hero) return undefined;
      if (hasStatus(target, lumingOotakemaruIds.revenant)) return { amount: amount * .5, effects: [] };
      if (hasStatus(target, lumingOotakemaruIds.soulRiding) && skillRank(target, lumingOotakemaruIds.stance) >= 2
        && hitContext?.attackShape === 'single') return { amount: amount * .5, effects: [] };
      return undefined;
    },
    policy(context, unitId) { return chooseAction(context, unitId); },
  };
}

function convertErosion(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const target = context.getUnit(event.unitId);
  if (!target || target.hp <= 0) return;
  const eroded = target.statuses.filter(status => status.statusId === lumingOotakemaruIds.erosion);
  if (!eroded.length) return;
  const commands: EffectCommand[] = [];
  for (const status of eroded) {
    const source = status.source;
    commands.push({ type: 'remove-status-instances', source, targetId: target.unitId,
      instanceIds: [status.instanceId], reason: 'consumed', parentEventId: event.eventId });
    commands.push({ type: 'apply-control', source, targetId: target.unitId, parentEventId: event.eventId,
      scopeId: `${lumingOotakemaruIds.pressure}:${event.eventId}:${source.unitId ?? source.id}`,
      instance: { instanceId: `${lumingOotakemaruIds.pressure}:${source.unitId ?? source.id}:${target.unitId}`,
        statusId: lumingOotakemaruIds.pressure, source, stacks: 1,
        duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { controlType: '眩晕' },
        modifiers: [{ stat: 'speed', operation: 'percent', amount: -.3 }] } });
  }
  return commands;
}

function onUnitDefeated(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  // The rule is shared by the registry, so locate all living Luming owners in the rosters.
  const candidates = [...context.getLivingUnits('blue'), ...context.getLivingUnits('red')]
    .filter(unit => unit.heroId === lumingOotakemaruIds.hero && unit.hp > 0 && unit.unitKind !== 'summon');
  const commands: EffectCommand[] = [];
  const defeated = context.getUnit(event.unitId);
  for (const actor of candidates) {
    const soul = actor.statuses.find(status => status.statusId === lumingOotakemaruIds.soulRiding);
    if (!soul || !passivesEnabled(actor)) continue;
    if (defeated && defeated.unitKind !== 'summon' && skillRank(actor, lumingOotakemaruIds.stance) >= 3) {
      commands.push({ type: 'heal', source: lumingSource(lumingOotakemaruIds.stance, actor.unitId), targetId: actor.unitId,
        amount: actor.stats.hp * .3, parentEventId: event.eventId });
    }
    const deadCount = [...context.state.sides.blue, ...context.state.sides.red]
      .map(unitId => context.state.units[unitId]).filter(unit => unit && unit.hp <= 0 && unit.unitKind !== 'summon').length;
    if (deadCount >= 3) commands.push(...enterRevenant(actor, event.eventId));
  }
  return commands;
}

function onActionEnded(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || event.actionKind !== 'skill') return;
  const actor = context.getUnit(event.intent?.actorId ?? event.source.unitId ?? '');
  if (!actor || actor.unitKind === 'summon') return;
  return [...context.getLivingUnits(actor.side).filter(owner => owner.heroId === lumingOotakemaruIds.hero
    && owner.unitId !== actor.unitId && hasStatus(owner, lumingOotakemaruIds.soulRiding)
    && passivesEnabled(owner)).map(owner => ({ type: 'add-status' as const,
      source: lumingSource(lumingOotakemaruIds.stance, owner.unitId), targetId: owner.unitId,
      instance: { instanceId: `${lumingOotakemaruIds.luze}:${owner.unitId}`, statusId: lumingOotakemaruIds.luze,
        source: lumingSource(lumingOotakemaruIds.stance, owner.unitId), stacks: 1, duration: { kind: 'permanent' as const } },
      parentEventId: event.eventId }))];
}

function enterRevenant(owner: Readonly<UnitState>, parentEventId: string): EffectCommand[] {
  const source = lumingSource(lumingOotakemaruIds.stance, owner.unitId);
  const commands: EffectCommand[] = [];
  const statusIds = [...new Set(owner.statuses.map(status => status.statusId))];
  if (statusIds.length) commands.push({ type: 'remove-statuses', source, targetId: owner.unitId, statusIds, parentEventId });
  commands.push({ type: 'add-status', source, targetId: owner.unitId, parentEventId, instance: {
    instanceId: `${lumingOotakemaruIds.revenant}:${owner.unitId}`, statusId: lumingOotakemaruIds.revenant,
    source, stacks: 1, duration: { kind: 'permanent' },
    modifiers: [{ stat: 'speed', operation: 'flat', amount: 100 }],
  } });
  return commands;
}

function enterSoulRiding(unitId: string, turns: number): EffectCommand[] {
  const source = lumingSource(lumingOotakemaruIds.stance, unitId);
  return [{ type: 'add-status', source, targetId: unitId, instance: {
    instanceId: `${lumingOotakemaruIds.soulRiding}:${unitId}`, statusId: lumingOotakemaruIds.soulRiding,
    source, stacks: 1, duration: { kind: 'count', remaining: turns, owner: 'source-turn' },
    modifiers: [{ stat: 'resist', operation: 'flat', amount: 1 }],
  } }];
}

function applyErosion(context: BattleContext, target: Readonly<UnitState>, source: SourceRef): EffectCommand[] {
  return attemptDebuff(context, { source, targetId: target.unitId, statusId: lumingOotakemaruIds.erosion,
    baseChance: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
    modifiers: [{ stat: 'attack', operation: 'percent', amount: -.15 },
      { stat: 'healingTaken', operation: 'percent', amount: -.3 }] });
}

function deal(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, source: SourceRef, ratio: number): EffectCommand[] {
  const attack = context.getEffectiveStats(owner.unitId), defense = context.getEffectiveStats(target.unitId);
  if (!attack || !defense || target.hp <= 0) return [];
  const damage = context.calculateDamage({ attack: attack.attack, defense: defense.defense, ratio,
    critChance: attack.crit, critDamage: attack.critDamage }, owner as UnitState, target as UnitState);
  return [{ type: 'deal-damage', source, targetId: target.unitId, amount: damage.amount, isCritical: damage.isCritical,
    ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}),
    ...(hasStatus(owner, lumingOotakemaruIds.revenant) ? { leechRate: .12 } : {}) }];
}

function chooseAction(context: BattleContext, unitId: string): ActionIntent | undefined {
  const owner = context.getUnit(unitId);
  if (!owner || owner.heroId !== lumingOotakemaruIds.hero || owner.hp <= 0 || owner.unitKind === 'summon') return;
  const enemies = context.getLivingUnits(enemySide(owner.side));
  if (!enemies.length) return;
  if (hasStatus(owner, lumingOotakemaruIds.revenant)) return { actorId: unitId, skillId: lumingOotakemaruIds.revenantAttack,
    targetIds: [enemies[0]!.unitId], shape: 'single', targetRelation: 'enemy' };
  const fire = context.state.resources[owner.side]?.fire ?? 0;
  const stacks = owner.statuses.find(status => status.statusId === lumingOotakemaruIds.luze)?.stacks ?? 0;
  if (!hasStatus(owner, lumingOotakemaruIds.soulRiding) && fire < 4) return { actorId: unitId, skillId: lumingOotakemaruIds.stance,
    targetIds: [unitId], shape: 'self', targetRelation: 'ally' };
  if (fire + stacks >= 4 && enemies.length >= 2) return { actorId: unitId, skillId: lumingOotakemaruIds.ultimate,
    targetIds: enemies.map(enemy => enemy.unitId), shape: 'all-enemies', targetRelation: 'enemy' };
  const target = [...enemies].sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0]!;
  return { actorId: unitId, skillId: lumingOotakemaruIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
}

function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
function hasStatus(unit: Readonly<UnitState>, statusId: string): boolean { return unit.statuses.some(status => status.statusId === statusId); }
function enemySide(side: UnitState['side']): UnitState['side'] { return side === 'blue' ? 'red' : 'blue'; }
function lumingSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
