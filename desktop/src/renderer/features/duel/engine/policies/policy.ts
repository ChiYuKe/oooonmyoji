import type { ActionIntent, BattleContext, UnitId } from '../core/types';

/** Policies only inspect state and return intent; the engine validates and pays for it. */
export type ActionPolicy = (context: BattleContext, actorId: UnitId) => ActionIntent | undefined;
