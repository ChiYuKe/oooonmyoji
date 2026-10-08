import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { attemptControl } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ContentRegistry } from './registry';

export const paperDancerIds = { hero: 340, basic: '3401', passive: '3402', ultimate: '3403', paper: 'status.hero.340.paper-blade',
  fallenPaper: 'status.hero.340.fallen-paper', silence: 'status.hero.340.paper-silence' } as const;

const basicRatios = [.8, .85, .9, 1, 1] as const;
const paperRatios = [1.08, 1.1, 1.12, 1.14, 1.14] as const;
const detonationDefenseIgnore = [0, 100, 150, 200, 200] as const;
const fallenPaperCaps = [1, 2, 2, 3, 3] as const;

export function registerPaperDancer(registry: ContentRegistry): void {
  const statuses: StatusDefinition[] = [
    { id: paperDancerIds.paper, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'replace' },
    { id: paperDancerIds.fallenPaper, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'replace', maxStacks: 3 },
    { id: paperDancerIds.silence, mechanicsCoverage: 'partial', category: 'control', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'replace', preventsSkill: true },
  ];
  statuses.forEach(status => registry.registerStatus(status));

  const basic: SkillDefinition = { id: paperDancerIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map((ratio, index) => ({ ratio, detonate: index >= 4 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== paperDancerIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      const commands = strike(context, actor, target, basic.id, Number(parameters.ratio ?? basicRatios[rank(actor, basic.id) - 1]!));
      if (Boolean(parameters.detonate ?? rank(actor, basic.id) >= 5) && hasPaper(target, actor.unitId))
        commands.push(...detonatePaper(context, actor, target, target.statuses.find(status => status.statusId === paperDancerIds.paper
          && status.source.unitId === actor.unitId)!, true));
      return commands;
    } };
  const passive: SkillDefinition = { id: paperDancerIds.passive, actionKind: 'passive', target: 'self', targetRelation: 'ally',
    levels: fallenPaperCaps.map((cap, index) => ({ cap, defensePerStack: index >= 2 ? .1 : 0 })),
    canUse() { return false; }, execute() { return []; } };
  const ultimate: SkillDefinition = { id: paperDancerIds.ultimate, actionKind: 'skill', target: 'all-enemies', targetRelation: 'enemy',
    resourceCost: { resourceId: 'fire', amount: 3 },
    resolveResourceCost(_state, actor) {
      const rankLevel = rank(actor, paperDancerIds.passive);
      const spent = rankLevel >= 5 ? Math.min(3, actor.statuses.find(status => status.statusId === paperDancerIds.fallenPaper)?.stacks ?? 0) : 0;
      return { resourceId: 'fire', amount: 3 - spent };
    },
    levels: paperRatios.map((ratio, index) => ({ ratio, reapplyRatio: index >= 4 ? 1.54 : 0,
      defenseIgnore: detonationDefenseIgnore[index]! })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId); if (!actor || actor.heroId !== paperDancerIds.hero || actor.hp <= 0) return [];
      const commands: EffectCommand[] = [], source = paperDancerSource(ultimate.id, actor.unitId);
      const fallen = actor.statuses.find(status => status.statusId === paperDancerIds.fallenPaper);
      const ratio = Number(parameters.ratio ?? paperRatios[rank(actor, ultimate.id) - 1]!);
      const repeatRatio = Number(parameters.reapplyRatio ?? (rank(actor, ultimate.id) >= 5 ? 1.54 : 0));
      const defenseIgnore = Number(parameters.defenseIgnore ?? detonationDefenseIgnore[rank(actor, ultimate.id) - 1]!);
      if (rank(actor, paperDancerIds.passive) >= 5 && fallen) commands.push({ type: 'remove-status-instances', source: fallen.source,
        targetId: actor.unitId, instanceIds: [fallen.instanceId], reason: 'consumed' });
      for (const targetId of context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue').map(unit => unit.unitId)) {
        const target = context.getUnit(targetId); if (!target || target.hp <= 0) continue;
        const oldPaper = target.statuses.find(status => status.statusId === paperDancerIds.paper && status.source.unitId === actor.unitId);
        if (oldPaper && repeatRatio > 0)
          commands.push(...indirectHit(context, actor, target, source, repeatRatio, defenseIgnore, `paper-refresh:${target.unitId}`,
            Number(oldPaper.values?.attack ?? (context.getEffectiveStats(actor.unitId) ?? actor.stats).attack)));
        commands.push(...indirectHit(context, actor, target, source, ratio, 0, `paper-apply:${target.unitId}`));
        if (oldPaper) commands.push({ type: 'remove-status-instances', source: oldPaper.source, targetId: target.unitId,
          instanceIds: [oldPaper.instanceId], reason: 'replaced' });
        commands.push({ type: 'add-status', source, targetId: target.unitId, instance: {
          instanceId: `${paperDancerIds.paper}:${actor.unitId}:${target.unitId}`, statusId: paperDancerIds.paper, source, stacks: 1,
          duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
          values: { attack: (context.getEffectiveStats(actor.unitId) ?? actor.stats).attack, ratio, defenseIgnore },
        } });
      }
      return commands;
    } };

  const definition: HeroDefinition = { id: paperDancerIds.hero, skills: [basic, passive, ultimate], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['按客户端数据接入纸扇80%/85%/90%/100%普攻，五级起普攻引爆同源纸刃。敌方施放非普攻技能时，纸舞获得1层落纸（上限1/2/2/3/3，持续至自身回合；三级起每层加10%防御）；自身回合开始按层数上限驱散自身可驱散减益/控制并消耗等量层。纸刃翩跹耗3火、对敌方全体造成108%至114%攻击间接伤害并施加2回合纸刃；五级起对已有同源纸刃目标再造成154%伤害并刷新纸刃。带纸刃敌人施放非普攻技能时引爆并尝试沉默1回合；二至四级引爆伤害按技能数据忽略100/150/200点防御；五级落纸每层抵1点大招费用。10点场阵容没有纸舞；间接伤害防御口径、沉默抵抗及同一动作内引爆/受击顺序仍需实战帧校对。'],
    handlers: {
      'action-selection': { priority: 340, handle(context, event) { return resolvePaperAction(context, event); } },
      'turn-start': { priority: 340, handle(context, event) { return clearDebuffs(context, event); } },
      'turn-end': { priority: 340, handle(context, event) { return tickPaper(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.heroId !== paperDancerIds.hero || actor.hp <= 0 || actor.unitKind === 'summon') return;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return;
      const target = enemies.find(enemy => hasPaper(enemy, actor.unitId)) ?? enemies[0]!;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 3)
        return { actorId: unitId, skillId: paperDancerIds.ultimate, targetIds: enemies.map(enemy => enemy.unitId), shape: 'all-enemies', targetRelation: 'enemy' };
      return { actorId: unitId, skillId: basic.id, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function resolvePaperAction(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-declared') return;
  const actor = context.getUnit(event.intent.actorId); if (!actor || actor.hp <= 0) return;
  const commands: EffectCommand[] = [];
  const own = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue').find(unit => unit.heroId === paperDancerIds.hero && unit.hp > 0);
  if (own && passivesEnabled(own) && event.intent.skillId !== paperDancerIds.basic) commands.push(...gainFallenPaper(context, own, event));
  const selected = event.intent.targetIds.map(id => context.getUnit(id)).find(unit => unit && unit.hp > 0);
  const canBasicDetonate = own && actor.side !== own.side && event.intent.skillId === paperDancerIds.basic
    && rank(own, paperDancerIds.basic) >= 5;
  const markedUnit = event.intent.skillId === paperDancerIds.basic ? selected : actor;
  const mark = markedUnit?.statuses.find(status => status.statusId === paperDancerIds.paper && status.source.unitId === own?.unitId);
  if (own && markedUnit && mark && actor.side !== own.side && (event.intent.skillId !== paperDancerIds.basic || canBasicDetonate))
    commands.push(...detonatePaper(context, own, markedUnit, mark, true));
  return commands.length ? commands : undefined;
}

function gainFallenPaper(context: BattleContext, owner: Readonly<UnitState>, event: BattleEvent): EffectCommand[] {
  const current = owner.statuses.find(status => status.statusId === paperDancerIds.fallenPaper);
  const level = rank(owner, paperDancerIds.passive), cap = fallenPaperCaps[level - 1]!, stacks = Math.min(cap, (current?.stacks ?? 0) + 1);
  const source = paperDancerSource(paperDancerIds.passive, owner.unitId);
  return [
    ...(current ? [{ type: 'remove-status-instances' as const, source: current.source, targetId: owner.unitId,
      instanceIds: [current.instanceId], reason: 'replaced' as const }] : []),
    { type: 'add-status', source, targetId: owner.unitId, parentEventId: event.eventId, instance: {
      instanceId: `${paperDancerIds.fallenPaper}:${owner.unitId}`, statusId: paperDancerIds.fallenPaper, source, stacks,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
      modifiers: level >= 3 ? [{ stat: 'defense', operation: 'percent', amount: .1, perStack: true }] : [],
    } },
  ];
}

function clearDebuffs(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const owner = context.getUnit(event.unitId); if (!owner || owner.heroId !== paperDancerIds.hero || owner.hp <= 0 || !passivesEnabled(owner)) return;
  const mark = owner.statuses.find(status => status.statusId === paperDancerIds.fallenPaper);
  if (!mark || mark.stacks <= 0) return;
  const removable = owner.statuses.filter(status => {
    const category = context.getStatusCategory(status.statusId);
    return (category === 'debuff' || category === 'control') && context.isStatusDispellable(status.statusId);
  }).slice(0, mark.stacks);
  if (!removable.length) return;
  const source = paperDancerSource(paperDancerIds.passive, owner.unitId), consume = removable.length;
  return [
    { type: 'dispel-statuses', source, targetId: owner.unitId, instanceIds: removable.map(status => status.instanceId),
      maxCount: consume, filter: 'debuff-or-control', parentEventId: event.eventId },
    { type: 'remove-status-instances', source: mark.source, targetId: owner.unitId, instanceIds: [mark.instanceId], reason: 'consumed' },
    ...(mark.stacks > consume ? [{ type: 'add-status' as const, source: mark.source, targetId: owner.unitId,
      instance: { ...mark, stacks: mark.stacks - consume } }] : []),
  ];
}

function tickPaper(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const target = context.getUnit(event.unitId); if (!target || target.hp <= 0) return;
  const marks = target.statuses.filter(status => status.statusId === paperDancerIds.paper);
  return marks.flatMap(mark => {
    const owner = context.getUnit(mark.source.unitId ?? '');
    if (!owner || owner.heroId !== paperDancerIds.hero) return [];
    return indirectHit(context, owner, target, mark.source, Number(mark.values?.ratio ?? paperRatios[rank(owner, paperDancerIds.ultimate) - 1]!),
      0, `paper-turn-end:${target.unitId}`, Number(mark.values?.attack ?? (context.getEffectiveStats(owner.unitId) ?? owner.stats).attack));
  });
}

function detonatePaper(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, mark: Readonly<UnitState['statuses'][number]>, silence: boolean): EffectCommand[] {
  const ratio = Number(mark.values?.ratio ?? paperRatios[rank(owner, paperDancerIds.ultimate) - 1]!);
  const ignoreDefense = Number(mark.values?.defenseIgnore ?? detonationDefenseIgnore[rank(owner, paperDancerIds.ultimate) - 1]!);
  const source = paperDancerSource(paperDancerIds.ultimate, owner.unitId);
  const commands: EffectCommand[] = [
    { type: 'remove-status-instances', source: mark.source, targetId: target.unitId, instanceIds: [mark.instanceId], reason: 'consumed' },
    ...indirectHit(context, owner, target, source, ratio, ignoreDefense, `paper-detonate:${target.unitId}`,
      Number(mark.values?.attack ?? (context.getEffectiveStats(owner.unitId) ?? owner.stats).attack)),
  ];
  const silenceEffect = silence ? attemptControl(context, { attemptId: `${paperDancerIds.silence}:${owner.unitId}:${target.unitId}:${context.state.counters.action}`,
    source, targetId: target.unitId, statusId: paperDancerIds.silence, controlType: '沉默', baseChance: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }) : undefined;
  if (silenceEffect) commands.push(silenceEffect);
  return commands;
}

function indirectHit(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, source: SourceRef,
  ratio: number, defenseIgnore: number, parentEventId: string, attackSnapshot?: number): EffectCommand[] {
  const attack = attackSnapshot ?? (context.getEffectiveStats(owner.unitId) ?? owner.stats).attack;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const hit = context.calculateDamage({ attack, defense: defense.defense, defenseIgnore: effectiveDefenseIgnore(owner),
    defenseReduction: defenseIgnore > 0 ? { ignoreDefenseValue: defenseIgnore } : undefined,
    ratio, critChance: 0, critDamage: 1 }, owner as UnitState, target as UnitState);
  return [{ type: 'lose-life', source, targetId: target.unitId, amount: hit.amount, lifeLossKind: 'indirect', parentEventId }];
}

function strike(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, skillId: string, ratio: number): EffectCommand[] {
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats, defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const hit = context.calculateDamage({ attack: offense.attack, defense: defense.defense, defenseIgnore: effectiveDefenseIgnore(actor),
    ratio, critChance: offense.crit, critDamage: offense.critDamage }, actor as UnitState, target as UnitState);
  return [{ type: 'deal-damage', source: paperDancerSource(skillId, actor.unitId), targetId: target.unitId, amount: hit.amount,
    ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
}

function hasPaper(unit: Readonly<UnitState>, sourceUnitId: string): boolean {
  return unit.statuses.some(status => status.statusId === paperDancerIds.paper && status.source.unitId === sourceUnitId);
}
function rank(unit: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel)); }
function paperDancerSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
