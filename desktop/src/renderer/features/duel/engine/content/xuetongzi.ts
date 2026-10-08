import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptControl, attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const xuetongziIds = { hero: 292, basic: '2921', passive: '2922', ultimate: '2923',
  freeze: 'status.hero.292.freeze', shattered: 'status.hero.292.shattered', shield: 'status.hero.292.frost-shield',
  hitBonus: 'status.hero.292.hit-bonus', attackGrowth: 'status.hero.292.attack-growth', refundMarker: 'status.hero.292.refund-marker' } as const;

const basicRatios = [.8, .84, .88, .92, 1] as const;
const ultimateRatio = 1.4;

export function registerXuetongzi(registry: ContentRegistry): void {
  registry.registerStatus({ id: xuetongziIds.freeze, mechanicsCoverage: 'partial', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true } satisfies StatusDefinition);
  registry.registerStatus({ id: xuetongziIds.shattered, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: xuetongziIds.shield, mechanicsCoverage: 'partial', category: 'shield', dispellable: false,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: xuetongziIds.hitBonus, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: xuetongziIds.attackGrowth, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', stackScope: 'source-unit' });
  registry.registerStatus({ id: xuetongziIds.refundMarker, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });

  const basic: SkillDefinition = { id: xuetongziIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    useClientDamageData: true, levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== xuetongziIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      return makeHit(context, actor, target, Number(parameters.ratio ?? basicRatios[rank(actor, basic.id) - 1]), basic.id);
    } };
  const ultimate: SkillDefinition = { id: xuetongziIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', levels: [1.4, 1.4, 1.4, 1.4, 1.4].map(ratio => ({ ratio, hits: 3 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== xuetongziIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      const source = xuetongziSource(ultimate.id, actor.unitId);
      const ratio = Number(parameters.ratio ?? ultimateRatio);
      const commands: EffectCommand[] = [];
      for (let hitIndex = 0; hitIndex < 3; hitIndex += 1)
        commands.push(...makeHit(context, actor, target, ratio, ultimate.id));
      commands.push({ type: 'add-status', source, targetId: actor.unitId, instance: { instanceId: `${xuetongziIds.hitBonus}:${actor.unitId}`,
        statusId: xuetongziIds.hitBonus, source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
        modifiers: [{ stat: 'hit', operation: 'flat', amount: 2 }] } });
      return commands;
    } };

  const definition: HeroDefinition = { id: xuetongziIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入雪走按等级80%至100%攻击、对已有冰冻/深度冰冻/霜冻目标碎冰并将该次伤害提高至300%、碎冰后施加2回合减速、霜天之织按当前主技能文本45%基础概率尝试1至2回合冰冻、成功冰冻后获得不可驱散且吸收雪童子初始攻击150%的2回合护盾；胧月雪华斩消耗3火攻击3次并获得本回合+200效果命中，命中冰冻目标按碎冰规则增伤，首次造成冰冻类效果返还1火。任何式神阵亡时雪童子永久增加5%伤害。客户端旧行对冰冻率记载25%，当前主文本为45%；技能槽未列的2924雪花瓣/暴风雪分支及回合外飞雪抵消冻结、放逐、被动/御魂封印等保护机制暂未接入；多段攻击在一次性命中状态变化、免控/封印/放逐消耗顺序和御魂交互仍待帧核。'],
    beforeCalculateDamage(input, attacker, target) {
      if (attacker.heroId !== xuetongziIds.hero || !passivesEnabled(attacker) || !isFrozen(undefined, target)) return input;
      return { ...input, ratio: input.ratio * 3 };
    },
    handlers: {
      'attack-end': { priority: 56, handle(context, event) { return triggerFrostWeave(context, event); } },
      'unit-defeated': { priority: 56, handle(context, event) { return gainAttackOnShikigamiDeath(context, event); } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const frozen = enemies.find(target => isFrozen(context, target));
      if (frozen) return { actorId: actor.unitId, skillId: xuetongziIds.ultimate, targetIds: [frozen.unitId], shape: 'single', targetRelation: 'enemy' };
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 3)
        return { actorId: actor.unitId, skillId: xuetongziIds.ultimate, targetIds: [enemies[0]!.unitId], shape: 'single', targetRelation: 'enemy' };
      return { actorId: actor.unitId, skillId: xuetongziIds.basic, targetIds: [enemies[0]!.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function triggerFrostWeave(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || !event.source.unitId || !event.targetHealthChanges?.length
    || (event.actionKind !== 'basic' && event.actionKind !== 'skill')) return;
  const owner = context.getUnit(event.source.unitId);
  if (!owner || owner.heroId !== xuetongziIds.hero || owner.hp <= 0 || !passivesEnabled(owner)) return;
  const commands: EffectCommand[] = [];
  for (const change of event.targetHealthChanges) {
    const target = context.getUnit(change.targetId);
    if (!target || target.side === owner.side || target.hp <= 0 || change.hpLost <= 0) continue;
    const ref = xuetongziSource(xuetongziIds.passive, owner.unitId);
    if (isFrozen(context, target)) {
      const frozen = target.statuses.filter(status => isFreezeStatus(context, status));
      if (frozen.length) commands.push({ type: 'remove-status-instances', source: ref, targetId: target.unitId,
        instanceIds: frozen.map(status => status.instanceId), reason: 'consumed', parentEventId: event.eventId });
      commands.push(...attemptDebuff(context, { source: ref, targetId: target.unitId, statusId: xuetongziIds.shattered, baseChance: 1,
        duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, parentEventId: event.eventId,
        modifiers: [{ stat: 'speed', operation: 'percent', amount: -.4 }] }));
      continue;
    }
    const duration = 1 + Math.floor(context.random() * 2);
    const freeze = attemptControl(context, { attemptId: `${xuetongziIds.freeze}:${event.eventId}:${target.unitId}`,
      source: ref, targetId: target.unitId, statusId: xuetongziIds.freeze, controlType: '冰冻', baseChance: .45,
      duration: { kind: 'count', remaining: duration, owner: 'target-turn' }, parentEventId: event.eventId });
    if (!freeze || freeze.type !== 'apply-control') {
      if (freeze) commands.push(freeze);
      continue;
    }
    commands.push(freeze, { type: 'add-status', source: ref, targetId: owner.unitId, instance: {
      instanceId: `${xuetongziIds.shield}:${owner.unitId}`, statusId: xuetongziIds.shield, source: ref, stacks: 1,
      duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
      values: { shieldRemaining: owner.stats.attack * 1.5 },
    } });
    if (event.source.id === xuetongziIds.ultimate) {
      const attackId = event.attackId ?? event.eventId;
      const marker = owner.statuses.find(status => status.statusId === xuetongziIds.refundMarker);
      if (String(marker?.values?.attackId ?? '') !== String(attackId)) {
        commands.push({ type: 'change-resource', source: ref, side: owner.side, resourceId: 'fire', amount: 1,
          parentEventId: event.eventId }, { type: 'add-status', source: ref, targetId: owner.unitId, instance: {
          instanceId: `${xuetongziIds.refundMarker}:${owner.unitId}`, statusId: xuetongziIds.refundMarker,
          source: ref, stacks: 1, duration: { kind: 'permanent' }, values: { attackId: String(attackId) },
        }, parentEventId: event.eventId });
      }
    }
  }
  return commands.length ? commands : undefined;
}

function gainAttackOnShikigamiDeath(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || owner.unitKind !== 'shikigami') return;
  return context.getLivingUnits('blue').concat(context.getLivingUnits('red')).filter(unit => unit.heroId === xuetongziIds.hero
    && unit.unitKind !== 'summon' && passivesEnabled(unit)).map(shikigami => ({ type: 'add-status' as const,
    source: xuetongziSource(xuetongziIds.passive, shikigami.unitId), targetId: shikigami.unitId,
    instance: { instanceId: `${xuetongziIds.attackGrowth}:${shikigami.unitId}`, statusId: xuetongziIds.attackGrowth,
      source: xuetongziSource(xuetongziIds.passive, shikigami.unitId), stacks: 1, duration: { kind: 'permanent' as const },
      modifiers: [{ stat: 'damage' as const, operation: 'percent' as const, amount: .05, perStack: true }] } }));
}

function makeHit(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, ratio: number, skillId: string): EffectCommand[] {
  const offense = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const damage = context.calculateDamage({ attack: offense.attack, defense: defense.defense, ratio,
    defenseIgnore: effectiveDefenseIgnore(owner), dmgFluctuation: .01, critChance: offense.crit, critDamage: offense.critDamage },
  owner as UnitState, target as UnitState);
  return [{ type: 'deal-damage', source: xuetongziSource(skillId, owner.unitId), targetId: target.unitId,
    amount: damage.amount, ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical }];
}

function isFrozen(context: BattleContext | undefined, target: Readonly<UnitState>): boolean {
  return target.statuses.some(status => isFreezeStatus(context, status));
}
function isFreezeStatus(context: BattleContext | undefined, status: StatusInstance): boolean {
  const label = String(status.values?.controlType ?? '');
  return status.statusId === xuetongziIds.freeze || label.includes('冰冻') || label.includes('深度冰冻') || label.includes('霜冻')
    || context?.getStatusCategory(status.statusId) === 'control' && ['freeze', 'deep-freeze', 'frost'].includes(label.toLowerCase());
}
function rank(unit: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel)); }
function xuetongziSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
