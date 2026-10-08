import type { ContentRegistry } from './registry';
import type { BattleEvent, EffectCommand, SourceRef, StatusInstance } from '../core/types';
import type { DamageInterceptionContext } from '../core/definitions';
import { soulsEnabled } from '../core/soul-eligibility';

export const rainfallStoneIds = {
  soul: 'soul:300060',
  rainDew: 'status.soul.300060.rain-dew',
  absorbedAction: 'status.soul.300060.absorbed-action',
  maxHpLimit: 'status.soul.300060.max-hp-limit',
} as const;

/** 雨降 transforms once below 30% HP and absorbs one whole action per Rain Dew stack. */
export function registerRainfallStone(registry: ContentRegistry): void {
  registry.registerStatus({ id: rainfallStoneIds.rainDew, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 3,
    mechanicsCoverageNotes: ['每层吸收携带者在一次行动内受到的全部伤害；状态驱散属性和多段反击作用域仍待录像校验'] });
  registry.registerStatus({ id: rainfallStoneIds.absorbedAction, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: rainfallStoneIds.maxHpLimit, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerSoul({
    id: rainfallStoneIds.soul,
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['生命首次低于30%时将最大生命降至1并获得3层雨露；每层吸收一次行动内全部伤害，使用行动编号保持多段命中只消耗1层。首次触发是否也能阻断同一行动后续伤害、御魂封印及状态驱散属性仍待帧图校验'],
    handlers: {
      hit: { priority: 45, handle: triggerRainfall },
      'effect-resolution': { priority: 45, handle: triggerRainfall },
    },
    interceptIncomingDamage(state, _attacker, target, amount, _kind, interception) {
      if (amount <= 0 || target.hp <= 0 || target.soulId !== rainfallStoneIds.soul || !soulsEnabled(target)) return undefined;
      const rain = target.statuses.find(status => status.statusId === rainfallStoneIds.rainDew);
      if (!rain || rain.stacks <= 0) return undefined;
      const actionId = state.counters.action || interception?.attackId || state.counters.attack;
      const source = soulSource(target.unitId);
      const previous = target.statuses.find(status => status.statusId === rainfallStoneIds.absorbedAction);
      if (Number(previous?.values?.actionId) === actionId) return { amount: 0, effects: [] };
      const effects: EffectCommand[] = [{ type: 'remove-status-instances', source, targetId: target.unitId,
        instanceIds: [rain.instanceId], reason: 'consumed' }];
      if (rain.stacks > 1) effects.push({ type: 'add-status', source, targetId: target.unitId,
        instance: { ...rain, stacks: rain.stacks - 1 } });
      effects.push({ type: 'add-status', source, targetId: target.unitId,
        instance: absorbedActionStatus(target.unitId, actionId) });
      return { amount: 0, effects };
    },
  });
}

function triggerRainfall(context: import('../core/types').BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' && event.type !== 'life-lost') return;
  const target = context.getUnit(event.targetId);
  if (!target || target.hp <= 0 || target.soulId !== rainfallStoneIds.soul || !soulsEnabled(target)
    || target.stats.hp <= 1 || target.hp >= target.stats.hp * .3
    || target.statuses.some(status => status.statusId === rainfallStoneIds.maxHpLimit)) return;
  const source = soulSource(target.unitId);
  return [{ type: 'reduce-max-health', source, targetId: target.unitId, amount: target.stats.hp - 1,
    minimumRatio: 0, statusId: rainfallStoneIds.maxHpLimit, parentEventId: event.eventId },
  { type: 'add-status', source, targetId: target.unitId, parentEventId: event.eventId,
    instance: { instanceId: `${rainfallStoneIds.rainDew}:${target.unitId}`, statusId: rainfallStoneIds.rainDew,
      source, stacks: 3, duration: { kind: 'permanent' } } }];
}

function absorbedActionStatus(unitId: string, actionId: number): StatusInstance {
  const source = soulSource(unitId);
  return { instanceId: `${rainfallStoneIds.absorbedAction}:${unitId}`, statusId: rainfallStoneIds.absorbedAction,
    source, stacks: 1, duration: { kind: 'permanent' }, values: { actionId } };
}

function soulSource(unitId: string): SourceRef {
  return { kind: 'soul', id: rainfallStoneIds.soul, unitId };
}
