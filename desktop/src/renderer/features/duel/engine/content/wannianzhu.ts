import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { heroSkillsCatalog } from '../../../../../shared/hero-skills-data';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const wannianzhuIds = {
  hero: 275,
  basic: '2751',
  passive: '2752',
  ultimate: '2753',
  guard: 'status.hero.275.bamboo-guard',
  attack: 'status.hero.275.bamboo-speech-attack',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const guardChances = [.4, .5, .5, .6, .6] as const;
const attackRates = [.1, .1, .12, .12, .15] as const;

export function registerWannianzhu(registry: ContentRegistry): void {
  registry.registerStatus({ id: wannianzhuIds.guard, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' } satisfies StatusDefinition);
  registry.registerStatus({ id: wannianzhuIds.attack, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' } satisfies StatusDefinition);

  const ultimate: SkillDefinition = { id: wannianzhuIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-allies', targetRelation: 'ally', levels: attackRates.map((attackRate, index) => ({ attackRate, rank: index + 1 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.heroId !== wannianzhuIds.hero || actor.hp <= 0 || actor.unitKind === 'summon') return [];
      const rank = Math.max(1, Math.min(5, Number(parameters.rank ?? actor.skillLevels?.[wannianzhuIds.ultimate] ?? actor.skillLevel)));
      const attackRate = Number(parameters.attackRate ?? attackRates[rank - 1]);
      const attack = context.getEffectiveStats(actor.unitId)?.attack ?? actor.stats.attack;
      return intent.targetIds.flatMap(targetId => {
        const ally = context.getUnit(targetId);
        if (!ally || ally.hp <= 0 || ally.side !== actor.side || ally.unitKind === 'summon') return [];
        return [guardStatus(actor.unitId, ally.unitId, undefined, 1),
          attackStatus(actor.unitId, ally.unitId, undefined, attack * attackRate, attackRate)];
      });
    } };

  const definition: HeroDefinition = {
    id: wannianzhuIds.hero,
    skills: [createBasicAttackSkill(wannianzhuIds.basic, basicRatios), ultimate],
    aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['笛中剑倍率与30%邀战、竹叶守护回合末自挂1回合/队友被攻击时按被动等级反击（自身受击必中）、竹语3火全队1回合护竹并按万年竹攻击力增加10%/12%/15%已接入。邀战的协战资格、护竹是否逐击判定以及控制时序仍需帧核；本次十人帧图无万年竹。'],
    handlers: {
      'attack-end': { priority: 46, handle(context, event) { return counterForGuardedAlly(context, event); } },
      'turn-end': { priority: 46, handle(context, event) { return gainGuardAtTurnEnd(context, event); } },
      'action-end': { priority: 46, handle(context, event) { return inviteAllyAfterBasic(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 3) return { actorId: unitId, skillId: wannianzhuIds.ultimate,
        targetIds: context.getLivingUnits(actor.side).filter(ally => ally.unitKind !== 'summon').map(ally => ally.unitId),
        shape: 'all-allies', targetRelation: 'ally' };
      return { actorId: unitId, skillId: wannianzhuIds.basic, targetIds: [enemies[0]!.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function gainGuardAtTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.heroId !== wannianzhuIds.hero || actor.hp <= 0 || actor.unitKind === 'summon'
    || !passivesEnabled(actor) || actor.statuses.some(status => status.statusId === wannianzhuIds.guard)) return;
  return [guardStatus(actor.unitId, actor.unitId, event.eventId, 1)];
}

function counterForGuardedAlly(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || !event.source.unitId || !event.targetHealthChanges?.length) return;
  const attacker = context.getUnit(event.source.unitId);
  if (!attacker || attacker.hp <= 0) return;
  const impactedAllies = event.targetHealthChanges.map(change => context.getUnit(change.targetId))
    .filter((target): target is UnitState => Boolean(target && target.side !== attacker.side));
  if (!impactedAllies.length) return;
  const defenders = context.getLivingUnits(attacker.side === 'blue' ? 'red' : 'blue')
    .filter(unit => unit.heroId === wannianzhuIds.hero && unit.unitKind !== 'summon'
      && unit.statuses.some(status => status.statusId === wannianzhuIds.guard)
      && passivesEnabled(unit) && !context.isUnitUnableToAct(unit.unitId));
  const commands: EffectCommand[] = [];
  for (const owner of defenders) {
    const ownerWasHit = impactedAllies.some(target => target.unitId === owner.unitId);
    if (!ownerWasHit && context.random() >= guardChances[skillIndex(owner, wannianzhuIds.passive)]!) continue;
    const basic = basicIntentId(owner);
    if (!basic || attacker.side === owner.side) continue;
    commands.push({ type: 'schedule-action', source: wannianzhuSource(wannianzhuIds.passive, owner.unitId),
      intent: { actorId: owner.unitId, skillId: basic, targetIds: [attacker.unitId], shape: 'single', targetRelation: 'enemy', kind: 'passive' },
      scheduling: 'counter', freeCast: true, parentEventId: event.eventId });
  }
  return commands.length ? commands : undefined;
}

function inviteAllyAfterBasic(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || event.skillId !== wannianzhuIds.basic || event.scheduling !== undefined || !event.intent) return;
  const actor = context.getUnit(event.intent.actorId);
  if (!actor || actor.heroId !== wannianzhuIds.hero || actor.hp <= 0 || actor.unitKind === 'summon') return;
  const allies = context.getLivingUnits(actor.side).filter(unit => unit.unitId !== actor.unitId);
  const target = event.intent.targetIds.map(id => context.getUnit(id)).find(unit => unit && unit.hp > 0 && unit.side !== actor.side)
    ?? context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue')[0];
  if (!allies.length || !target || target.hp <= 0 || context.random() >= .3) return;
  const invited = allies[Math.floor(context.random() * allies.length)]!;
  const basic = heroSkillsCatalog.heroes[invited.heroId]?.skills[0];
  if (!basic) return;
  const intent: ActionIntent = { actorId: invited.unitId, skillId: String(basic.id), targetIds: [target.unitId],
    shape: 'single', targetRelation: 'enemy', kind: 'passive' };
  return [{ type: 'schedule-action', source: wannianzhuSource(wannianzhuIds.basic, actor.unitId), intent,
    scheduling: 'assist', parentEventId: event.eventId }];
}

function guardStatus(ownerId: string, targetId: string, eventId: string | undefined, remaining: number): EffectCommand {
  const source = wannianzhuSource(wannianzhuIds.passive, ownerId);
  const instance: StatusInstance = { instanceId: `${wannianzhuIds.guard}:${ownerId}:${targetId}`,
    statusId: wannianzhuIds.guard, source, stacks: 1,
    duration: { kind: 'count', remaining, owner: 'target-turn' } };
  return { type: 'add-status', source, targetId, instance, ...(eventId ? { parentEventId: eventId } : {}) };
}

function attackStatus(ownerId: string, targetId: string, eventId: string | undefined, amount: number, rate: number): EffectCommand {
  const source = wannianzhuSource(wannianzhuIds.ultimate, ownerId);
  const instance: StatusInstance = { instanceId: `${wannianzhuIds.attack}:${ownerId}:${targetId}`,
    statusId: wannianzhuIds.attack, source, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { attackRate: rate },
    modifiers: [{ stat: 'attack', operation: 'flat', amount }] };
  return { type: 'add-status', source, targetId, instance, ...(eventId ? { parentEventId: eventId } : {}) };
}

function skillIndex(unit: Readonly<UnitState>, id: string): number {
  return Math.max(0, Math.min(4, (unit.skillLevels?.[id] ?? unit.skillLevel) - 1));
}
function basicIntentId(actor: Readonly<UnitState>): string | undefined {
  const skill = heroSkillsCatalog.heroes[actor.heroId]?.skills[0];
  return skill ? String(skill.id) : undefined;
}
function wannianzhuSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
