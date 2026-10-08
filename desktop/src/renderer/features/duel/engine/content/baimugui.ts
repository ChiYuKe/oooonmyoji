import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const baimuguiIds = {
  hero: 293, basic: '2931', passive: '2932', gazeSkill: '2933', evilLight: '2934',
  eyes: 'status.hero.293.eyes', gaze: 'status.hero.293.gaze',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.2] as const;
const gazeCosts = [3, 3, 3, 3, 2] as const;
const evilLightRatios = [2.11, 2.22, 2.33, 2.44, 2.44] as const;
const eyeChances = [.4, .5, .6, .7, .8] as const;

export function registerBaimugui(registry: ContentRegistry): void {
  const evilLight = createEvilLightSkill();
  registry.registerStatus({ id: baimuguiIds.eyes, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 5,
    stackScope: 'source-unit' } satisfies StatusDefinition);
  registry.registerStatus({ id: baimuguiIds.gaze, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', grantedSkills: [evilLight],
    selectAction(context, actor, instance) {
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const owner = instance.source.unitId ? context.getUnit(instance.source.unitId) : undefined;
      if (!owner || owner.side === actor.side) return undefined;
      if ((context.state.resources[actor.side]?.fire ?? 0) < 3) return undefined;
      return { actorId: actor.unitId, skillId: baimuguiIds.evilLight, targetIds: [actor.unitId],
        shape: 'single', targetRelation: 'ally' };
    } } satisfies StatusDefinition);

  const basic: SkillDefinition = { id: baimuguiIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    useClientDamageData: true, levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== baimuguiIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      const ratio = Number(parameters.ratio ?? basicRatios[skillRank(actor, baimuguiIds.basic) - 1]);
      const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const damage = context.calculateDamage({ attack: offense.attack,
        defense: (context.getEffectiveStats(target.unitId) ?? target.stats).defense, ratio,
        defenseIgnore: effectiveDefenseIgnore(actor), dmgFluctuation: .01,
        critChance: offense.crit, critDamage: offense.critDamage }, actor, target);
      const commands: EffectCommand[] = [{ type: 'deal-damage', source: baimuguiSource(baimuguiIds.basic, actor.unitId),
        targetId: target.unitId, amount: damage.amount, ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}),
        isCritical: damage.isCritical }];
      const gaze = target.statuses.find(status => status.statusId === baimuguiIds.gaze
        && status.source.unitId === actor.unitId);
      if (gaze) commands.push({ type: 'add-status', source: baimuguiSource(baimuguiIds.basic, actor.unitId),
        targetId: target.unitId, instance: { ...gaze, duration: { kind: 'count',
          remaining: (gaze.duration.kind === 'count' ? gaze.duration.remaining : 0) + 1, owner: 'target-turn' } } });
      return commands;
    } };
  const gazeSkill: SkillDefinition = { id: baimuguiIds.gazeSkill, actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 3 }, target: 'all-enemies', targetRelation: 'enemy',
    levels: gazeCosts.map((cost, rank) => ({ cost, rank: rank + 1 })),
    resolveResourceCost(_state, actor) {
      const rank = skillRank(actor, baimuguiIds.gazeSkill);
      return { resourceId: 'fire', amount: gazeCosts[rank - 1]! };
    },
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.heroId !== baimuguiIds.hero || actor.hp <= 0) return [];
      const commands: EffectCommand[] = [];
      for (const targetId of intent.targetIds) {
        const target = context.getUnit(targetId);
        if (!target || target.hp <= 0 || target.side === actor.side) continue;
        commands.push(...attemptDebuff(context, {
          source: baimuguiSource(baimuguiIds.gazeSkill, actor.unitId), targetId: target.unitId,
          statusId: baimuguiIds.gaze, baseChance: 1,
          duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { controlType: '凝视' } }));
      }
      return commands;
    } };
  const definition: HeroDefinition = {
    id: baimuguiIds.hero, skills: [basic, gazeSkill, evilLight], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入瞳炎等级倍率与命中后延长同来源凝视1回合；鬼眸在敌方暴击伤害事件后按40%至80%概率叠层，五层免费施放诅咒之眼并清空鬼眸；诅咒之眼按100%基础概率施加1回合凝视，凝视状态为持有者授予邪光并在其有3火时覆盖行动，邪光按等级造成百目鬼攻击211%至244%的间接伤害，并按同来源凝视敌人数追加目标生命上限8%、总伤害封顶为百目鬼攻击600%，之后清除这些凝视。录像帧未见百目鬼；客户端旧行与合并战斗文本对邪光反伤对象/附加生命伤害计数范围存在版本差异，当前按独立技能行落地；无火时邪光替技、同一行动内控制/抵抗插入及多百目鬼状态归属仍待录像核验。'],
    handlers: {
      hit: { priority: 52, handle(context, event) { return gainEyesOnEnemyCritical(context, event); } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= gazeCosts[skillRank(actor, baimuguiIds.gazeSkill) - 1]!)
        return { actorId: unitId, skillId: baimuguiIds.gazeSkill, targetIds: enemies.map(target => target.unitId),
          shape: 'all-enemies', targetRelation: 'enemy' };
      return { actorId: unitId, skillId: baimuguiIds.basic, targetIds: [enemies[0]!.unitId],
        shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function createEvilLightSkill(): SkillDefinition {
  return { id: baimuguiIds.evilLight, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'ally', levels: evilLightRatios.map(ratio => ({ ratio })),
    resolveResourceCost() { return { resourceId: 'fire', amount: 3 }; },
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.hp <= 0 || !target || target.unitId !== actor.unitId) return [];
      const gaze = actor.statuses.find(status => status.statusId === baimuguiIds.gaze && status.source.unitId);
      const owner = gaze?.source.unitId ? context.getUnit(gaze.source.unitId) : undefined;
      if (!owner) return [];
      const ratio = Number(parameters.ratio ?? evilLightRatios[skillRank(owner, baimuguiIds.gazeSkill) - 1]);
      const attack = (context.getEffectiveStats(owner.unitId) ?? owner.stats).attack;
      const matchingGazes = context.getLivingUnits(actor.side).filter(unit => unit.statuses.some(status =>
        status.statusId === baimuguiIds.gaze && status.source.unitId === owner.unitId)).length;
      const extraLifeLoss = Math.min(target.stats.hp * .08 * matchingGazes,
        Math.max(0, attack * 6 - attack * ratio));
      const commands: EffectCommand[] = [{ type: 'lose-life', source: baimuguiSource(baimuguiIds.evilLight, owner.unitId),
        targetId: actor.unitId, amount: attack * ratio + extraLifeLoss, lifeLossKind: 'indirect' }];
      for (const enemy of context.getLivingUnits(actor.side)) {
        const marks = enemy.statuses.filter(status => status.statusId === baimuguiIds.gaze
          && status.source.unitId === owner.unitId);
        if (marks.length) commands.push({ type: 'remove-status-instances', source: baimuguiSource(baimuguiIds.evilLight, owner.unitId),
          targetId: enemy.unitId, instanceIds: marks.map(status => status.instanceId), reason: 'consumed' });
      }
      return commands;
    } };
}

function gainEyesOnEnemyCritical(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.isCritical || event.amount <= 0 || !event.source.unitId) return;
  const attacker = context.getUnit(event.source.unitId);
  const target = context.getUnit(event.targetId);
  if (!attacker || !target || attacker.side === target.side) return;
  const commands: EffectCommand[] = [];
  for (const owner of context.getLivingUnits(target.side).filter(unit => unit.heroId === baimuguiIds.hero
    && unit.unitKind === 'shikigami' && passivesEnabled(unit))) {
    const rank = skillRank(owner, baimuguiIds.passive);
    if (context.random() >= eyeChances[rank - 1]!) continue;
    const current = owner.statuses.find(status => status.statusId === baimuguiIds.eyes
      && status.source.unitId === owner.unitId);
    const next = Math.min(5, (current?.stacks ?? 0) + 1);
    const source = baimuguiSource(baimuguiIds.passive, owner.unitId);
    commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: {
      instanceId: `${baimuguiIds.eyes}:${owner.unitId}`, statusId: baimuguiIds.eyes, source,
      stacks: 1, duration: { kind: 'permanent' },
    } });
    if (next < 5) continue;
    commands.push({ type: 'remove-status-instances', source, targetId: owner.unitId,
      instanceIds: [current?.instanceId ?? `${baimuguiIds.eyes}:${owner.unitId}`], reason: 'consumed' },
    { type: 'schedule-action', source, scheduling: 'extra-action', freeCast: true, parentEventId: event.eventId,
      intent: { actorId: owner.unitId, skillId: baimuguiIds.gazeSkill,
        targetIds: context.getLivingUnits(attacker.side).map(enemy => enemy.unitId), shape: 'all-enemies',
        targetRelation: 'enemy', kind: 'passive' } });
  }
  return commands.length ? commands : undefined;
}

function skillRank(unit: Readonly<UnitState>, id: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[id] ?? unit.skillLevel));
}
function baimuguiSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
