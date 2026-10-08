import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { attemptDebuff } from '../mechanics/control';
import type { ContentRegistry } from './registry';

export const nightBloomIds = {
  hero: 358, basic: '3581', decay: '3582', ultimate: '3583', fireRoad: '3584', ash: '3585',
  seed: 'status.hero.358.seed', flower: 'status.hero.358.flower', slumber: 'status.hero.358.slumber',
  attackGrowth: 'status.hero.358.attack-growth', attackDown: 'status.hero.358.attack-down', speed: 'status.hero.358.speed',
} as const;

export function registerNightBloom(registry: ContentRegistry): void {
  registry.registerStatus({ id: nightBloomIds.seed, mechanicsCoverage: 'partial', category: 'mark', dispellable: true,
    sealable: true, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 6, stackScope: 'source-unit' });
  registry.registerStatus({ id: nightBloomIds.flower, mechanicsCoverage: 'partial', category: 'mark', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 10 });
  registry.registerStatus({ id: nightBloomIds.slumber, mechanicsCoverage: 'partial', category: 'control', dispellable: false,
    sealable: false, durationOwner: 'source-turn', refreshPolicy: 'replace', preventsAction: true });
  registry.registerStatus({ id: nightBloomIds.attackGrowth, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 3 });
  registry.registerStatus({ id: nightBloomIds.attackDown, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: nightBloomIds.speed, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'source-turn', refreshPolicy: 'refresh-duration' });
  registry.registerHero(createNightBloomDefinition());
}

export function createNightBloomDefinition(): HeroDefinition {
  const basic: SkillDefinition = {
    id: nightBloomIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: [1, 1.05, 1.1, 1.15, 1.25].map(ratio => ({ ratio })),
    execute(context, intent, params) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target || target.hp <= 0) return [];
      return hit(context, actor, target, nightBloomSource(nightBloomIds.basic, actor.unitId), Number(params.ratio ?? 1));
    },
  };
  const decay: SkillDefinition = {
    id: nightBloomIds.decay, actionKind: 'skill', target: 'all-enemies', targetRelation: 'enemy',
    levels: Array.from({ length: 5 }, (_, index) => ({ lifeCost: .4, seeds: 6,
      flowerCap: index >= 3 ? 4 : 3, attackGain: index >= 1 ? .1 : 0 })),
    canUse: (_state, actor) => actor.heroId === nightBloomIds.hero && !has(actor, nightBloomIds.slumber)
      && !has(actor, nightBloomIds.flower),
    execute(context, intent, params) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || has(actor, nightBloomIds.slumber)) return [];
      const source = nightBloomSource(nightBloomIds.decay, actor.unitId);
      return [...castDecay(context, actor, Number(params.lifeCost ?? .4), Number(params.seeds ?? 6)),
        { type: 'add-status', source, targetId: actor.unitId, instance: {
          instanceId: `${nightBloomIds.slumber}:${actor.unitId}`, statusId: nightBloomIds.slumber, source,
          stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'source-turn' },
        } }];
    },
  };
  const ultimate: SkillDefinition = {
    id: nightBloomIds.ultimate, actionKind: 'skill', target: 'all-enemies', targetRelation: 'enemy',
    resourceCostsByLevel: [3, 3, 3, 3, 3].map(amount => ({ resourceId: 'fire', amount })),
    levels: [
      { ratio: 1, attackDown: .15 }, { ratio: 1.1, attackDown: .2 }, { ratio: 1.25, attackDown: .25 },
      { ratio: 1.4, attackDown: .3 }, { ratio: 1.4, attackDown: .3, speed: 50 },
    ],
    execute(context, intent, params) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const source = nightBloomSource(nightBloomIds.ultimate, actor.unitId), commands: EffectCommand[] = [];
      for (const targetId of intent.targetIds) {
        const target = context.getUnit(targetId);
        if (!target || target.hp <= 0) continue;
        commands.push(...hit(context, actor, target, source, Number(params.ratio ?? 1)));
        commands.push(...attemptDebuff(context, { source, targetId, statusId: nightBloomIds.attackDown,
          baseChance: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
          modifiers: [{ stat: 'attack', operation: 'percent', amount: -Number(params.attackDown ?? .15) }] }));
      }
      if (Number(params.speed ?? 0) > 0) commands.push(addStatus(actor.unitId, nightBloomIds.speed, source,
        { kind: 'count', remaining: 1, owner: 'source-turn' }, [{ stat: 'speed', operation: 'flat', amount: Number(params.speed) }]));
      return commands;
    },
  };
  const fireRoad: SkillDefinition = {
    id: nightBloomIds.fireRoad, actionKind: 'skill', target: 'single', targetRelation: 'enemy',
    levels: [{ ratio: .8 }],
    canUse: (_state, actor) => actor.heroId === nightBloomIds.hero && (actor.statuses.find(status => status.statusId === nightBloomIds.flower)?.stacks ?? 0) > 0,
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId), primary = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !primary || primary.hp <= 0) return [];
      const flower = actor.statuses.find(status => status.statusId === nightBloomIds.flower);
      const count = Math.min(10, flower?.stacks ?? 0);
      if (count <= 0 || !flower) return [];
      const enemies = context.getLivingUnits(enemySide(actor.side));
      const source = nightBloomSource(nightBloomIds.fireRoad, actor.unitId), commands: EffectCommand[] = [];
      for (let stack = 0; stack < count; stack++) {
        const targets = [primary];
        for (let extra = 0; extra < stack && enemies.length > 1; extra++) {
          const choices = enemies.filter(enemy => enemy.unitId !== primary.unitId);
          targets.push(choices[Math.floor(context.random() * choices.length)]!);
        }
        for (const target of targets) if (target.hp > 0) commands.push(...hit(context, actor, target, source, .8));
      }
      commands.push({ type: 'remove-status-instances', source, targetId: actor.unitId,
        instanceIds: [flower.instanceId], reason: 'consumed' });
      commands.push({ type: 'change-action-gauge', source, targetId: actor.unitId, amount: 25, checkImmunity: true });
      return commands;
    },
  };
  const ash: SkillDefinition = {
    id: nightBloomIds.ash, actionKind: 'skill', target: 'single', targetRelation: 'ally',
    resourceCostsByLevel: Array.from({ length: 5 }, (_, index) => ({ resourceId: 'fire', amount: index >= 2 ? 1 : 0 })),
    levels: Array.from({ length: 5 }, () => ({})),
    canUse(state, actor) {
      return actor.heroId === nightBloomIds.hero && (actor.statuses.some(status => status.statusId === nightBloomIds.seed)
        || state.sides[actor.side].some(id => state.units[id]?.statuses.some(status => status.statusId === nightBloomIds.seed)));
    },
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target || !has(target, nightBloomIds.seed)) return [];
      const own = actor.statuses.find(status => status.statusId === nightBloomIds.seed);
      const mark = target.statuses.find(status => status.statusId === nightBloomIds.seed);
      const source = nightBloomSource(nightBloomIds.ash, actor.unitId), commands: EffectCommand[] = [];
      if (own) commands.push({ type: 'change-status-stacks', source, targetId: actor.unitId, instanceId: own.instanceId, amount: -1 });
      if (mark) commands.push({ type: 'change-status-stacks', source, targetId: target.unitId, instanceId: mark.instanceId, amount: -1 });
      return commands;
    },
  };

  return {
    id: nightBloomIds.hero, skills: [basic, decay, ultimate, fireRoad, ash], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['按3581–3585技能行接入普攻、先机/40%当前生命施放赤色凋零并向低种子目标分配6层溟种、自身沉眠后回合开始回收溟种转溟花并恢复生命、花烬移除双方溟种、溟花层数驱动火照之路递增扩散、殛尽黄泉群攻降攻及五级加速。携带溟种友方的主动花烬技能入口、溟种回合末伤害/免疫返花、沉眠控制时序与实际选择AI仍需实战帧核。'],
    initialize(context, unitId) {
      const actor = context.getUnit(unitId);
      return actor && rank(actor, nightBloomIds.decay) >= 5
        ? castDecay(context, actor, .4, 6).concat({ type: 'add-status', source: nightBloomSource(nightBloomIds.decay, unitId),
          targetId: unitId, instance: { instanceId: `${nightBloomIds.slumber}:${unitId}`, statusId: nightBloomIds.slumber,
            source: nightBloomSource(nightBloomIds.decay, unitId), stacks: 1,
            duration: { kind: 'count', remaining: 1, owner: 'source-turn' } } }) : [];
    },
    handlers: {
      'turn-start': { priority: 358, handle(context, event) { return wakeAndCollect(context, event); } },
      'turn-end': { priority: 358, handle(context, event) { return seedTick(context, event); } },
      hit: { priority: 358, handle(context, event) { return flowerOnAbsorbedSeedTick(context, event); } },
    },
    policy(context, unitId) { return chooseNightBloomAction(context, unitId); },
  };
}

function castDecay(context: BattleContext, actor: Readonly<UnitState>, lifeCost: number, seeds: number): EffectCommand[] {
  const source = nightBloomSource(nightBloomIds.decay, actor.unitId), enemies = context.getLivingUnits(enemySide(actor.side));
  const commands: EffectCommand[] = [{ type: 'lose-life', source, targetId: actor.unitId, amount: actor.hp * lifeCost }];
  const counts = new Map(enemies.map(enemy => [enemy.unitId,
    enemy.statuses.filter(status => status.statusId === nightBloomIds.seed).reduce((total, status) => total + status.stacks, 0)]));
  for (let index = 0; index < seeds && enemies.length; index++) {
    const minCount = Math.min(...[...counts.values()]);
    const choices = enemies.filter(enemy => counts.get(enemy.unitId) === minCount);
    const target = choices[Math.floor(context.random() * choices.length)]!;
    commands.push({ type: 'add-status', source, targetId: target.unitId, instance: {
      instanceId: `${nightBloomIds.seed}:${actor.unitId}:${target.unitId}`, statusId: nightBloomIds.seed,
      source, stacks: 1, duration: { kind: 'permanent' },
    } });
    counts.set(target.unitId, minCount + 1);
  }
  return commands;
}

function wakeAndCollect(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.heroId !== nightBloomIds.hero || !has(actor, nightBloomIds.slumber)) return;
  const source = nightBloomSource(nightBloomIds.decay, actor.unitId), seeds = context.state.sides[enemySide(actor.side)]
    .map(id => context.state.units[id]).filter((unit): unit is UnitState => Boolean(unit))
    .flatMap(unit => unit.statuses.filter(status => status.statusId === nightBloomIds.seed && status.source.unitId === actor.unitId)
      .map(status => ({ unit, status })));
  const count = seeds.reduce((sum, item) => sum + item.status.stacks, 0);
  const flowerCap = rank(actor, nightBloomIds.decay) >= 4 ? 4 : 3;
  const currentFlower = actor.statuses.find(status => status.statusId === nightBloomIds.flower);
  const gained = Math.min(count, Math.max(0, flowerCap - (currentFlower?.stacks ?? 0)));
  const commands: EffectCommand[] = [{ type: 'remove-statuses', source, targetId: actor.unitId, statusIds: [nightBloomIds.slumber],
    parentEventId: event.eventId }];
  for (const { unit, status } of seeds) commands.push({ type: 'remove-status-instances', source,
    targetId: unit.unitId, instanceIds: [status.instanceId], reason: 'consumed', parentEventId: event.eventId });
  if (gained > 0) {
    commands.push({ type: 'add-status', source, targetId: actor.unitId, parentEventId: event.eventId, instance: {
      instanceId: `${nightBloomIds.flower}:${actor.unitId}`, statusId: nightBloomIds.flower, source, stacks: gained,
      duration: { kind: 'permanent' },
    } });
    commands.push({ type: 'heal', source, targetId: actor.unitId, amount: actor.stats.hp * .1 * gained, parentEventId: event.eventId });
  }
  if (rank(actor, nightBloomIds.decay) >= 2) {
    const growth = actor.statuses.find(status => status.statusId === nightBloomIds.attackGrowth);
    if ((growth?.stacks ?? 0) < 3) commands.push({ type: 'add-status', source, targetId: actor.unitId, parentEventId: event.eventId,
      instance: { instanceId: `${nightBloomIds.attackGrowth}:${actor.unitId}`, statusId: nightBloomIds.attackGrowth,
        source, stacks: 1, duration: { kind: 'permanent' },
        modifiers: [{ stat: 'attack', operation: 'percent', amount: .1, perStack: true }] } });
  }
  return commands;
}

function seedTick(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const target = context.getUnit(event.unitId);
  if (!target || target.hp <= 0 || target.unitKind === 'summon') return;
  const commands: EffectCommand[] = [];
  for (const mark of target.statuses.filter(status => status.statusId === nightBloomIds.seed)) {
    const owner = context.getUnit(mark.source.unitId ?? '');
    if (!owner || owner.heroId !== nightBloomIds.hero) continue;
    for (let stack = 0; stack < mark.stacks; stack++) {
      const attack = context.getEffectiveStats(owner.unitId), defense = context.getEffectiveStats(target.unitId);
      if (!attack || !defense) continue;
      const source = nightBloomSource(nightBloomIds.decay, owner.unitId);
      const damage = context.calculateDamage({ attack: attack.attack, defense: defense.defense, ratio: 1,
        critChance: attack.crit, critDamage: attack.critDamage }, owner, target);
      commands.push({ type: 'deal-damage', source, targetId: target.unitId, amount: damage.amount,
        isCritical: damage.isCritical, ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}),
        parentEventId: event.eventId });
    }
  }
  return commands;
}

function flowerOnAbsorbedSeedTick(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.source.id !== nightBloomIds.decay || !event.source.unitId
    || !(event.amount <= 0 || (event.hpLost === 0 && (event.shieldConsumed ?? 0) >= event.amount))) return;
  const owner = context.getUnit(event.source.unitId);
  if (!owner || owner.heroId !== nightBloomIds.hero) return;
  const flowers = owner.statuses.find(status => status.statusId === nightBloomIds.flower);
  if ((flowers?.stacks ?? 0) >= 10) return;
  const source = nightBloomSource(nightBloomIds.decay, owner.unitId);
  return [{ type: 'add-status', source, targetId: owner.unitId, parentEventId: event.eventId,
    instance: { instanceId: `${nightBloomIds.flower}:${owner.unitId}`, statusId: nightBloomIds.flower,
      source, stacks: 1, duration: { kind: 'permanent' } } },
  { type: 'heal', source, targetId: owner.unitId, amount: owner.stats.hp * .1, parentEventId: event.eventId }];
}

function hit(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, source: SourceRef, ratio: number): EffectCommand[] {
  const attack = context.getEffectiveStats(actor.unitId), defense = context.getEffectiveStats(target.unitId);
  if (!attack || !defense || target.hp <= 0) return [];
  const result = context.calculateDamage({ attack: attack.attack, defense: defense.defense, ratio,
    critChance: attack.crit, critDamage: attack.critDamage }, actor, target);
  return [{ type: 'deal-damage', source, targetId: target.unitId, amount: result.amount, isCritical: result.isCritical,
    ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}) }];
}

function chooseNightBloomAction(context: BattleContext, unitId: string): ActionIntent | undefined {
  const actor = context.getUnit(unitId); if (!actor || actor.heroId !== nightBloomIds.hero || actor.hp <= 0) return;
  const enemies = context.getLivingUnits(enemySide(actor.side)); if (!enemies.length) return;
  const flowers = actor.statuses.find(status => status.statusId === nightBloomIds.flower)?.stacks ?? 0;
  if (flowers > 0) return { actorId: unitId, skillId: nightBloomIds.fireRoad, targetIds: [enemies[0]!.unitId], shape: 'single', targetRelation: 'enemy' };
  if (!has(actor, nightBloomIds.slumber) && (context.state.resources[actor.side]?.fire ?? 0) >= 3 && enemies.length > 1)
    return { actorId: unitId, skillId: nightBloomIds.ultimate, targetIds: enemies.map(enemy => enemy.unitId), shape: 'all-enemies', targetRelation: 'enemy' };
  if (!has(actor, nightBloomIds.slumber)) return { actorId: unitId, skillId: nightBloomIds.decay,
    targetIds: enemies.map(enemy => enemy.unitId), shape: 'all-enemies', targetRelation: 'enemy' };
  return { actorId: unitId, skillId: nightBloomIds.basic, targetIds: [enemies[0]!.unitId], shape: 'single', targetRelation: 'enemy' };
}

function addStatus(targetId: string, statusId: string, source: SourceRef, duration: StatusInstance['duration'],
  modifiers: StatusInstance['modifiers']): EffectCommand {
  return { type: 'add-status', source, targetId, instance: { instanceId: `${statusId}:${source.unitId}:${targetId}`,
    statusId, source, stacks: 1, duration, ...(modifiers ? { modifiers } : {}) } };
}
function rank(unit: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel)); }
function has(unit: Readonly<UnitState>, statusId: string): boolean { return unit.statuses.some(status => status.statusId === statusId); }
function enemySide(side: UnitState['side']): UnitState['side'] { return side === 'blue' ? 'red' : 'blue'; }
function nightBloomSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
