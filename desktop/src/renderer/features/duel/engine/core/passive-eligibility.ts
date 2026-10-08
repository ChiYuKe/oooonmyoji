import type { UnitState } from './types';
import type { StatusDefinition } from './definitions';

/** Canonical status marker for effects that seal a unit's passive triggers. */
export const passiveSuppressionStatusId = 'core.passive-suppression';

export const passiveSuppressionStatusDefinition: StatusDefinition = {
  id: passiveSuppressionStatusId,
  mechanicsCoverage: 'verified',
  category: 'control',
  dispellable: true,
  sealable: false,
  durationOwner: 'target-turn',
  refreshPolicy: 'replace',
};

export function passivesEnabled(unit: Pick<UnitState, 'statuses'>): boolean {
  return !unit.statuses.some(status => status.statusId === passiveSuppressionStatusId || status.values?.sealPassives === true);
}
