import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, EffectCommand, SourceRef, UnitState } from '../core/types';
import { attemptControl } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const kappaRosterIds = {
  shuten: 415, enma: 417, twoFace: 418, ibaraki: 420, lantern: 421, yoto: 422, ichimokuren: 423,
  huaniao: 424, kaguyahime: 425, susabi: 426, higanbana: 427, yukidouji: 428, tamamo: 429, miketsu: 430,
  shutenRage: 'status.hero.415.kappa-rage', ichimokurenShield: 'status.hero.423.kappa-shield',
  kaguyahimeWard: 'status.hero.425.kappa-ward', higanbanaShield: 'status.hero.427.kappa-shield',
  yukidoujiFreeze: 'status.hero.428.kappa-freeze',
} as const;

type Spec = { id: number; name: string; basic: string; active: string; basicRatios: readonly number[]; activeRatios: readonly number[];
  cost: number; mode: 'rage' | 'single' | 'aoe' | 'mixed' | 'multi' | 'focus-multi' | 'shield' | 'heal' | 'ward' | 'falling' | 'lost-shield' | 'freeze';
  hits?: number; note?: string };

const specs: readonly Spec[] = [
  { id: 415, name: '酒吞呱', basic: '4151', active: '4152', basicRatios: [.5, .525, .55, .575, .625], activeRatios: [.5, .525, .55, .575, .625], cost: 3, mode: 'rage' },
  { id: 417, name: '阎魔呱', basic: '4171', active: '4172', basicRatios: [1, 1.05, 1.1, 1.15, 1.25], activeRatios: [1.05, 1.11, 1.16, 1.22, 1.27], cost: 3, mode: 'single' },
  { id: 418, name: '两面佛呱', basic: '4181', active: '4182', basicRatios: [1, 1.05, 1.1, 1.15, 1.25], activeRatios: [.2, .21, .22, .23, .24], cost: 3, mode: 'multi', hits: 3 },
  { id: 420, name: '茨木呱', basic: '4201', active: '4202', basicRatios: [1, 1.05, 1.1, 1.15, 1.25], activeRatios: [.8, .83, .86, .9, .95], cost: 3, mode: 'mixed' },
  { id: 421, name: '青行灯呱', basic: '4211', active: '4212', basicRatios: [1, 1.05, 1.1, 1.15, 1.2], activeRatios: [.8, .83, .86, .9, .95], cost: 3, mode: 'aoe' },
  { id: 422, name: '妖刀姬呱', basic: '4221', active: '4222', basicRatios: [1, 1.05, 1.1, 1.15, 1.2], activeRatios: [.1, .11, .12, .13, .14], cost: 3, mode: 'focus-multi', hits: 6 },
  { id: 423, name: '一目连呱', basic: '4231', active: '4232', basicRatios: [1, 1.05, 1.1, 1.15, 1.25], activeRatios: [.01, .02, .02, .03, .03], cost: 3, mode: 'shield' },
  { id: 424, name: '花鸟卷呱', basic: '4241', active: '4242', basicRatios: [1, 1.05, 1.1, 1.15, 1.2], activeRatios: [.02, .025, .03, .035, .04], cost: 3, mode: 'heal' },
  { id: 425, name: '辉夜姬呱', basic: '4251', active: '4252', basicRatios: [1, 1.05, 1.1, 1.15, 1.25], activeRatios: [.01, .02, .03, .04, .05], cost: 2, mode: 'ward' },
  { id: 426, name: '荒呱', basic: '4261', active: '4262', basicRatios: [1, 1.05, 1.1, 1.15, 1.25], activeRatios: [.5, .53, .55, .58, .6], cost: 3, mode: 'falling', hits: 3 },
  { id: 427, name: '彼岸花呱', basic: '4271', active: '4272', basicRatios: [1, 1.05, 1.1, 1.15, 1.25], activeRatios: [.02, .04, .06, .08, .1], cost: 3, mode: 'lost-shield' },
  { id: 428, name: '雪童子呱', basic: '4281', active: '4282', basicRatios: [1, 1.05, 1.1, 1.15, 1.2], activeRatios: [.22, .23, .24, .25, .26], cost: 3, mode: 'freeze', hits: 3 },
  { id: 429, name: '玉藻前呱', basic: '4291', active: '4292', basicRatios: [1, 1.05, 1.1, 1.15, 1.2], activeRatios: [1.16, 1.17, 1.18, 1.19, 1.2], cost: 3, mode: 'aoe' },
  { id: 430, name: '御馔津呱', basic: '4301', active: '4302', basicRatios: [1, 1.05, 1.1, 1.15, 1.2], activeRatios: [1.22, 1.23, 1.24, 1.25, 1.26], cost: 3, mode: 'single' },
];

export function registerKappaRoster(registry: ContentRegistry): void {
  registry.registerStatus({ id: kappaRosterIds.shutenRage, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 1 });
  registry.registerStatus({ id: kappaRosterIds.ichimokurenShield, mechanicsCoverage: 'partial', category: 'shield', dispellable: false,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: kappaRosterIds.kaguyahimeWard, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: kappaRosterIds.higanbanaShield, mechanicsCoverage: 'partial', category: 'shield', dispellable: false,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: kappaRosterIds.yukidoujiFreeze, mechanicsCoverage: 'partial', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  for (const spec of specs) registry.registerHero(createKappa(spec));
}

function createKappa(spec: Spec): HeroDefinition {
  const basicBase = createBasicAttackSkill(spec.basic, spec.basicRatios);
  const basic: SkillDefinition = spec.id === 415 ? { ...basicBase, execute(context, intent, parameters) {
    const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
    if (!owner || owner.hp <= 0 || !target || target.hp <= 0 || target.side === owner.side) return [];
    const commands = attack(context, owner, target, Number(parameters.ratio ?? .5), 1, kappaSource(spec.basic, owner.unitId));
    if (context.random() < .2 && !owner.statuses.some(status => status.statusId === kappaRosterIds.shutenRage))
      commands.push({ type: 'add-status', source: kappaSource(spec.basic, owner.unitId), targetId: owner.unitId,
        instance: { instanceId: `${kappaRosterIds.shutenRage}:${owner.unitId}`, statusId: kappaRosterIds.shutenRage,
          source: kappaSource(spec.basic, owner.unitId), stacks: 1, duration: { kind: 'permanent' } } });
    return commands;
  } } : basicBase;
  const active: SkillDefinition = { id: spec.active, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: spec.cost },
    target: spec.mode === 'shield' || spec.mode === 'heal' || spec.mode === 'ward' ? 'all-allies'
      : spec.mode === 'lost-shield' ? 'self'
        : spec.mode === 'aoe' || spec.mode === 'mixed' || spec.mode === 'multi' ? 'all-enemies' : 'single',
    targetRelation: spec.mode === 'shield' || spec.mode === 'heal' || spec.mode === 'ward' || spec.mode === 'lost-shield' ? 'ally' : 'enemy',
    levels: spec.activeRatios.map(ratio => ({ ratio, hits: spec.hits ?? 1 })),
    execute(context, intent, parameters) { return executeKappaSkill(context, intent, parameters, spec); } };
  return { id: spec.id, skills: [basic, active], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    aiCoverageNotes: [`${spec.name}已按技能消耗实现鬼火足够时使用主动技能，否则使用普攻；更细的目标选择和实战自动选招仍待帧核。`],
    mechanicsCoverageNotes: [`已按客户端技能表接入普攻和主动技能的等级倍率、鬼火消耗及${modeNote(spec.mode)}；状态驱散时序、完整御魂交互和客户端AI优先级仍需实战帧核。`],
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      if (spec.mode === 'lost-shield' && fire >= spec.cost) return { actorId: unitId, skillId: spec.active,
        targetIds: [unitId], shape: 'self', targetRelation: 'ally' };
      const supportSkill = spec.mode === 'shield' || spec.mode === 'heal' || spec.mode === 'ward' || spec.mode === 'lost-shield';
      if (supportSkill && fire >= spec.cost) {
        const allies = context.getLivingUnits(actor.side).filter(unit => unit.unitKind !== 'summon');
        return { actorId: unitId, skillId: spec.active, targetIds: allies.map(unit => unit.unitId), shape: 'all-allies', targetRelation: 'ally' };
      }
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return;
      const target = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      const useActive = !supportSkill && fire >= spec.cost;
      const allTargets = useActive && ['aoe', 'mixed', 'multi'].includes(spec.mode);
      return { actorId: unitId, skillId: useActive ? spec.active : spec.basic,
        targetIds: allTargets ? enemies.map(enemy => enemy.unitId) : [target.unitId],
        shape: allTargets ? 'all-enemies' : 'single', targetRelation: 'enemy' };
    } };
}

function executeKappaSkill(context: BattleContext, intent: ActionIntent, parameters: Readonly<Record<string, number | boolean | string>>,
  spec: Spec): readonly EffectCommand[] {
  const owner = context.getUnit(intent.actorId); if (!owner || owner.hp <= 0) return [];
  const ratio = Number(parameters.ratio ?? spec.activeRatios[rank(owner, spec.active) - 1]!);
  const source = kappaSource(spec.active, owner.unitId);
  const allies = intent.targetIds.map(id => context.getUnit(id)).filter((unit): unit is UnitState => Boolean(unit && unit.hp > 0 && unit.side === owner.side));
  const enemies = (spec.mode === 'single' ? intent.targetIds.slice(0, 1).map(id => context.getUnit(id)).filter((unit): unit is UnitState => Boolean(unit))
    : context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue')).filter(unit => unit.hp > 0);
  switch (spec.mode) {
    case 'rage': {
      const target = enemies[0]; if (!target) return [];
      const rage = owner.statuses.find(status => status.statusId === kappaRosterIds.shutenRage);
      const commands = attack(context, owner, target, ratio, 1 + (rage?.stacks ?? 0), source);
      if (rage) commands.push({ type: 'remove-status-instances', source, targetId: owner.unitId, instanceIds: [rage.instanceId], reason: 'consumed' });
      return commands;
    }
    case 'single': { const target = enemies[0]; return target ? attack(context, owner, target, ratio, 1, source) : []; }
    case 'aoe': return enemies.flatMap(target => attack(context, owner, target, ratio, 1, source));
    case 'mixed': {
      const picked = intent.targetIds.map(id => context.getUnit(id)).find(unit => unit?.hp && unit.side !== owner.side);
      return enemies.flatMap(target => attack(context, owner, target, target.unitId === picked?.unitId ? ratio : .5, 1, source));
    }
    case 'multi': return enemies.flatMap(target => attack(context, owner, target, ratio, spec.hits ?? 3, source));
    case 'focus-multi': { const target = enemies[0]; return target ? attack(context, owner, target, ratio, spec.hits ?? 6, source) : []; }
    case 'falling': {
      const target = intent.targetIds.map(id => context.getUnit(id)).find(unit => unit?.hp && unit.side !== owner.side);
      return target ? attack(context, owner, target, ratio, 1, source).concat(
        attack(context, owner, target, ratio * .75, 1, source), attack(context, owner, target, ratio * .75 ** 2, 1, source)) : [];
    }
    case 'shield': return allies.filter(ally => ally.unitKind !== 'summon').map(ally => ({ type: 'add-status' as const, source,
      targetId: ally.unitId, instance: { instanceId: `${kappaRosterIds.ichimokurenShield}:${owner.unitId}:${ally.unitId}`,
        statusId: kappaRosterIds.ichimokurenShield, source, stacks: 1,
        duration: { kind: 'count' as const, remaining: 1, owner: 'target-turn' as const },
        values: { shieldRemaining: ally.stats.hp * ratio } } }));
    case 'heal': return allies.map(ally => ({ type: 'heal' as const, source, targetId: ally.unitId, amount: ally.stats.hp * ratio }));
    case 'ward': return allies.map(ally => ({ type: 'add-status' as const, source, targetId: ally.unitId, instance: {
      instanceId: `${kappaRosterIds.kaguyahimeWard}:${owner.unitId}:${ally.unitId}`, statusId: kappaRosterIds.kaguyahimeWard, source,
      stacks: 1, duration: { kind: 'count' as const, remaining: 1, owner: 'target-turn' as const },
      modifiers: [{ stat: 'defense' as const, operation: 'percent' as const, amount: .05 },
        { stat: 'resist' as const, operation: 'flat' as const, amount: ratio }],
    } }));
    case 'lost-shield': return [{ type: 'add-status', source, targetId: owner.unitId, instance: {
      instanceId: `${kappaRosterIds.higanbanaShield}:${owner.unitId}`, statusId: kappaRosterIds.higanbanaShield, source, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
      values: { shieldRemaining: Math.max(0, owner.stats.hp - owner.hp) * ratio },
    } }];
    case 'freeze': {
      const target = enemies[0]; if (!target) return [];
      const commands: EffectCommand[] = [];
      for (let hit = 0; hit < (spec.hits ?? 3); hit += 1) {
        commands.push(...attack(context, owner, target, ratio, 1, source));
        const control = attemptControl(context, { attemptId: `${kappaRosterIds.yukidoujiFreeze}:${owner.unitId}:${target.unitId}:${context.state.counters.action}:${hit}`,
          source, targetId: target.unitId, statusId: kappaRosterIds.yukidoujiFreeze, controlType: '冰冻', baseChance: .08,
          duration: { kind: 'count', remaining: 1, owner: 'target-turn' } });
        if (control) commands.push(control);
      }
      return commands;
    }
  }
}

function attack(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, ratio: number, hits: number,
  source: SourceRef): EffectCommand[] {
  const offense = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  return Array.from({ length: hits }, () => {
    const result = context.calculateDamage({ attack: offense.attack, defense: defense.defense,
      defenseIgnore: effectiveDefenseIgnore(owner), ratio, critChance: offense.crit, critDamage: offense.critDamage }, owner as UnitState, target as UnitState);
    return { type: 'deal-damage' as const, source, targetId: target.unitId, amount: result.amount, isCritical: result.isCritical,
      ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}) };
  });
}
function modeNote(mode: Spec['mode']): string {
  return ({ rage: '呱气叠层与消耗后追加攻击', single: '单体攻击', aoe: '全体攻击', mixed: '选中目标增伤与其余目标伤害',
    multi: '多段攻击', 'focus-multi': '选中目标多段攻击', shield: '全队护盾', heal: '全队治疗', ward: '防御/抵抗增益', falling: '逐段递减攻击',
    'lost-shield': '按已损生命生成护盾', freeze: '三段攻击与逐段冰冻判定' })[mode];
}
function rank(owner: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(5, owner.skillLevels?.[skillId] ?? owner.skillLevel)); }
function kappaSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
