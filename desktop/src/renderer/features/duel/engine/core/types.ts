export type SideId = 'blue' | 'red';
export type UnitId = string;
export type SkillId = string;
export type SoulId = string;
export type StatusId = string;
export type ActionKind = 'basic' | 'skill' | 'passive';
export type ActionScheduling = 'counter' | 'assist' | 'extra-action' | 'extra-turn';
export type StatusCategory = 'buff' | 'debuff' | 'control' | 'shield' | 'mark' | 'other';
export type UnitKind = 'shikigami' | 'summon' | 'monster' | 'onmyoji';
export type BattlePhase =
  | 'battle-start'
  | 'turn-start'
  | 'action-selection'
  | 'action-validation'
  | 'resource-payment'
  | 'resource-overflow'
  | 'effect-resolution'
  | 'control-application'
  | 'attack-start'
  | 'hit'
  | 'attack-end'
  | 'action-end'
  | 'unit-defeated'
  | 'turn-end'
  | 'status-expiration'
  | 'battle-end';

export interface SourceRef {
  kind: 'unit' | 'skill' | 'soul' | 'status' | 'system';
  id: string;
  unitId?: UnitId;
}

export interface UnitStats {
  readonly hp: number;
  readonly attack: number;
  readonly defense: number;
  readonly speed: number;
  readonly crit: number;
  readonly critDamage: number;
  readonly hit: number;
  readonly resist: number;
}

export interface StatusInstance {
  readonly instanceId: string;
  readonly statusId: StatusId;
  readonly source: SourceRef;
  readonly appliedByEventId?: string;
  readonly stacks: number;
  readonly duration: StatusDuration;
  readonly modifiers?: readonly StatModifier[];
  readonly values?: Readonly<Record<string, number | string | boolean>>;
}

export type CombatStatId = Exclude<keyof UnitStats, 'hp'>;
export interface StatModifier {
  readonly stat: CombatStatId | 'critResist' | 'critDamageTaken' | 'damage' | 'damageTaken' | 'defenseIgnore' | 'healingTaken' | 'indirectDamageTaken';
  readonly operation: 'flat' | 'percent';
  /** Percent modifiers are expressed as a fraction, for example 0.2 means +20%. */
  readonly amount: number;
  /** Multiplies this modifier by the owning status layer count. Omitted for one-time status modifiers. */
  readonly perStack?: boolean;
  /** Optional health gate for conditional auras whose value changes with current HP. */
  readonly condition?: { readonly healthRatioBelow?: number; readonly healthRatioAtLeast?: number; readonly actionKind?: ActionKind };
  /** Optional additive amount recalculated from a live team resource, such as fire. */
  readonly perResource?: { readonly resourceId: string; readonly amount: number };
}

export type StatusDuration =
  | { readonly kind: 'permanent' }
  | { readonly kind: 'count'; readonly remaining: number; readonly owner: 'source-turn' | 'target-turn' | 'round' | 'event'; readonly event?: BattlePhase };

export interface UnitState {
  readonly unitId: UnitId;
  readonly heroId: number;
  /** Optional content-provided label for summoned or otherwise non-roster entities. */
  readonly displayName?: string;
  /** Duel roster units are shikigami; mechanics that create summons or monsters must set their kind explicitly. */
  readonly unitKind?: UnitKind;
  /** Entity that created a summon; kept as an ID reference for replay and ownership rules. */
  readonly summonedByUnitId?: UnitId;
  readonly skillLevel: number;
  /** Optional per-skill ranks from lineup exports; missing IDs use skillLevel. */
  readonly skillLevels?: Readonly<Record<SkillId, number>>;
  readonly awakeFilter?: number;
  readonly side: SideId;
  readonly stats: UnitStats;
  readonly hp: number;
  readonly shield: number;
  readonly actionGauge: number;
  /** Native motion-slot position (0–120); actionGauge remains the percentage API for content. */
  readonly turnPos?: number;
  readonly soulId?: SoulId;
  readonly statuses: readonly StatusInstance[];
  readonly resources: Readonly<Record<string, number>>;
  readonly damageAttributes?: Readonly<DamageAttributes>;
}

/** Units under a battlefield-exile effect remain alive but cannot act or be selected. */
export function isUnitBanished(unit: Pick<UnitState, 'statuses'> | undefined): boolean {
  return Boolean(unit?.statuses.some(status => status.values?.banished === true));
}

/** Dead units with an explicit keep-on-death marker remain scheduled battle actors. */
export function isUnitFightingSpirit(unit: Pick<UnitState, 'statuses'> | undefined): boolean {
  return Boolean(unit?.statuses.some(status => status.values?.fightingSpirit === true));
}

/** Game attributes distinct from the displayed hit/resist panel. */
export interface DamageAttributes {
  critResist?: number;
  dodge?: number;
  hurtReductionRate?: number;
  parameterHurtReductionRate?: number;
  fixedHurtReductionVal?: number;
  hurtReboundRate?: number;
  leechRate?: number;
  damageImmune?: boolean;
  ignoreShieldCounter?: number;
  beIgnoreShield?: boolean;
  absorbAllDamage?: boolean;
  seriousInjury?: boolean;
  extHpAbsorptionRate?: number;
}

export interface BattleState {
  units: Readonly<Record<UnitId, UnitState>>;
  sides: Readonly<Record<SideId, readonly UnitId[]>>;
  resources: Readonly<Record<SideId, Readonly<Record<string, number>>>>;
  resourceMeters: Readonly<Record<SideId, Readonly<Record<string, ResourceMeter>>>>;
  counters: Readonly<{ round: number; action: number; attack: number; hit: number }>;
  ended: boolean;
  scheduling?: { readonly extraTurns: readonly UnitId[]; readonly normalTurns?: readonly UnitId[]; readonly lastSide?: SideId };
  /** Current hit scope, separate from the monotonically allocated attack counter. */
  activeAttackId?: number;
  /** Targets and shape of the attack currently being resolved, used by damage interception rules. */
  activeAttackTargetIds?: readonly UnitId[];
  activeAttackShape?: ActionIntent['shape'];
  /** Scheduling scope for damage modifiers that distinguish in-turn from out-of-turn actions. */
  activeActionScheduling?: ActionScheduling;
}

export interface ResourceMeter {
  readonly progress: number;
  readonly threshold: number;
  readonly nextSupply: number;
  readonly maxSupply: number;
  readonly resourceCap: number;
}

export interface ActionIntent {
  actorId: UnitId;
  skillId: SkillId;
  targetIds: readonly UnitId[];
  /** The directly selected target when an area attack also carries its full resolved target set. */
  selectedTargetId?: UnitId;
  shape: 'single' | 'all-enemies' | 'all-allies' | 'self' | 'multi';
  targetRelation?: 'ally' | 'enemy' | 'any';
  kind?: ActionKind;
}

export type BattleEvent =
  | (EventEnvelope & { type: 'battle-started' })
  | (EventEnvelope & { type: 'turn-started'; unitId: UnitId; scheduling?: 'extra-turn' })
  | (EventEnvelope & { type: 'turn-ended'; unitId: UnitId; scheduling?: 'extra-turn' })
  | (EventEnvelope & { type: 'turn-scheduled'; unitId: UnitId; scheduling: 'extra-turn'; selection: 'action-gauge' })
  | (EventEnvelope & { type: 'action-declared'; intent: ActionIntent; scheduling?: ActionScheduling; resourceCostWaived?: boolean })
  | (EventEnvelope & { type: 'action-ended'; actionKind: ActionKind; skillId: SkillId; soulTriggersAllowed: boolean;
      intent?: ActionIntent; scheduling?: ActionScheduling })
  | (EventEnvelope & { type: 'content-triggered'; contentType: 'hero' | 'soul' | 'status'; contentId: string; label: string })
  | (EventEnvelope & { type: 'action-skipped'; actorId: UnitId; reason: 'no-policy' | 'invalid-intent' | 'interrupted' })
  | (EventEnvelope & { type: 'attack-start'; targetIds: readonly UnitId[]; selectedTargetIds?: readonly UnitId[]; shape?: ActionIntent['shape']; actionKind?: ActionKind })
  | (EventEnvelope & { type: 'attack-ended'; hitCount: number; actionKind?: ActionKind; shape?: ActionIntent['shape']; selectedTargetIds?: readonly UnitId[]; suppressTargetPassiveTriggers?: boolean; suppressSourcePassiveTriggers?: boolean; targetHealthChanges?: readonly { targetId: UnitId; hpBefore: number; hpAfter: number; hpLost: number; defeatedByHit?: boolean; overkillDamage?: number }[] })
  | (EventEnvelope & { type: 'resource-changed'; side: SideId; resourceId: string; before: number; after: number })
  | (EventEnvelope & { type: 'resource-overflow'; side: SideId; resourceId: string; amount: number; before: number; after: number; attempted: number })
  | (EventEnvelope & { type: 'resource-meter-advanced'; side: SideId; resourceId: string; progressBefore: number; progressAfter: number; supplied: number })
  | (EventEnvelope & { type: 'resource-meter-set'; side: SideId; resourceId: string; progressBefore: number; progressAfter: number })
  | (EventEnvelope & { type: 'action-gauge-changed'; unitId: UnitId; before: number; after: number;
      requestedAmount?: number; blockedByImmunity?: boolean })
  | (EventEnvelope & { type: 'damage'; targetId: UnitId; damageKind: 'normal' | 'true'; actionKind?: ActionKind; amount: number; hpBefore?: number; hpAfter?: number; hpLost: number; mitigated: number; overkillDamage?: number; criticalAbsorbed?: number; isCritical: boolean; suppressSoulTriggers?: boolean; suppressTargetSoulTriggers?: boolean; suppressTargetPassiveTriggers?: boolean; suppressSourcePassiveTriggers?: boolean; fatalProtectionStatusId?: StatusId;
      hurtBeforeAbsorb?: number; shieldConsumed?: number; extHpConsumed?: number; reboundDamage?: number; leechDamage?: number;
      seriousInjury?: boolean; recordDefense?: number; recordHurtReductionRate?: number; recordIndirectHurtReductionRate?: number })
  | (EventEnvelope & { type: 'life-lost'; targetId: UnitId; amount: number; hpLost: number; lifeLossKind?: 'direct' | 'indirect' })
  | (EventEnvelope & { type: 'unit-defeated'; unitId: UnitId; defeatedBy?: SourceRef })
  | (EventEnvelope & { type: 'unit-revived'; unitId: UnitId; hp: number })
  | (EventEnvelope & { type: 'revive-blocked'; unitId: UnitId; protectionStatusId: StatusId })
  | (EventEnvelope & { type: 'unit-summoned'; unitId: UnitId; ownerUnitId: UnitId; heroId: number })
  | (EventEnvelope & { type: 'healing'; targetId: UnitId; amount: number; requestedAmount: number; hpGained: number; healingAbsorbed?: number })
  | (EventEnvelope & { type: 'healing-blocked'; targetId: UnitId; sourceId: string; restrictionStatusId: StatusId })
  | (EventEnvelope & { type: 'health-restored'; targetId: UnitId; amount: number; hpGained: number })
  | (EventEnvelope & { type: 'max-health-changed'; targetId: UnitId; before: number; after: number })
  | (EventEnvelope & { type: 'control-applied'; targetId: UnitId; statusId: StatusId; newlyControlled: boolean; controlType?: string })
  | (EventEnvelope & { type: 'control-resisted'; targetId: UnitId; controlStatusId: StatusId; controlType: string })
  | (EventEnvelope & { type: 'control-blocked'; targetId: UnitId; controlStatusId: StatusId; protectionStatusId?: StatusId; blockReason?: 'protection' | 'immunity' })
  | (EventEnvelope & { type: 'status-resisted'; targetId: UnitId; statusId: StatusId })
  | (EventEnvelope & { type: 'status-added'; targetId: UnitId; instance: StatusInstance })
  | (EventEnvelope & { type: 'status-stacks-changed'; targetId: UnitId; instanceId: string; statusId: StatusId; before: number; after: number })
  | (EventEnvelope & { type: 'status-removed'; targetId: UnitId; instanceId: string; statusId?: StatusId; statusCategory?: StatusCategory; removedValues?: StatusInstance['values']; removedSource?: SourceRef; reason: 'expired' | 'dispelled' | 'consumed' | 'replaced' })
  | (EventEnvelope & { type: 'status-application-blocked'; targetId: UnitId; attemptedStatusId: StatusId; protectionStatusId?: StatusId; blockReason?: 'protection' | 'immunity' })
  | (EventEnvelope & { type: 'healing-converted'; targetId: UnitId; requestedAmount: number; shieldAmount: number; shieldStatusId: StatusId })
  | (EventEnvelope & { type: 'action-scheduled'; intent: ActionIntent; scheduling: ActionScheduling; freeCast?: boolean; preResolved?: boolean })
  | (EventEnvelope & { type: 'battle-ended'; winner: SideId | 'draw'; reason: 'elimination' | 'action-limit' | 'trigger-budget' });

export interface EventEnvelope {
  eventId: string;
  phase: BattlePhase;
  source: SourceRef;
  parentEventId?: string;
  actionId?: number;
  attackId?: number;
  hitIndex?: number;
}

export interface ScheduledHit {
  targetId: UnitId;
  amount: number;
  criticalBaseAmount?: number;
  damageKind?: 'normal' | 'true';
  isCritical?: boolean;
  suppressTargetSoulTriggers?: boolean;
  suppressTargetPassiveTriggers?: boolean;
  suppressSourcePassiveTriggers?: boolean;
  damageOptions?: import('../mechanics/damage').DamageOptions;
}

export type EffectCommand =
  | { type: 'deal-damage'; source: SourceRef; targetId: UnitId; amount: number; criticalBaseAmount?: number; damageKind?: 'normal' | 'true'; actionKind?: ActionKind; isCritical?: boolean; precalculated?: boolean; countsAsHit?: boolean; suppressSoulTriggers?: boolean; suppressTargetSoulTriggers?: boolean; suppressTargetPassiveTriggers?: boolean; suppressSourcePassiveTriggers?: boolean; cannotBeShared?: boolean; parentEventId?: string;
      ignoreShield?: boolean; shieldDmgAddRate?: number; leechRate?: number; suppressRebound?: boolean; damageOptions?: import('../mechanics/damage').DamageOptions }
  | { type: 'lose-life'; source: SourceRef; targetId: UnitId; amount: number; lifeLossKind?: 'direct' | 'indirect'; parentEventId?: string }
  | { type: 'heal'; source: SourceRef; targetId: UnitId; amount: number; parentEventId?: string }
  /** Restores HP directly without healing modifiers or healing conversion. */
  | { type: 'restore-health'; source: SourceRef; targetId: UnitId; amount: number; parentEventId?: string }
  | { type: 'increase-max-health'; source: SourceRef; targetId: UnitId; amount: number; parentEventId?: string }
  | { type: 'reduce-max-health'; source: SourceRef; targetId: UnitId; amount: number; minimumRatio: number; statusId: StatusId; parentEventId?: string }
  /** Submit only after the content rule has passed its hit/resist probability check. */
  | { type: 'apply-control'; source: SourceRef; targetId: UnitId; instance: StatusInstance; scopeId?: string; parentEventId?: string }
  | { type: 'report-control-resisted'; source: SourceRef; targetId: UnitId; controlStatusId: StatusId; controlType: string; parentEventId?: string }
  | { type: 'report-status-resisted'; source: SourceRef; targetId: UnitId; statusId: StatusId; parentEventId?: string }
  | { type: 'revive'; source: SourceRef; targetId: UnitId; hp: number; parentEventId?: string }
  | { type: 'summon-unit'; source: SourceRef; unit: UnitState; parentEventId?: string }
  | { type: 'dispel-statuses'; source: SourceRef; targetId: UnitId; statusIds?: readonly StatusId[]; instanceIds?: readonly string[]; maxCount?: number; filter?: 'debuff-or-control' | 'buff'; preferCategories?: readonly StatusCategory[]; parentEventId?: string }
  | { type: 'transfer-status'; source: SourceRef; fromTargetId: UnitId; toTargetId: UnitId; instanceId: string; parentEventId?: string }
  | { type: 'remove-statuses'; source: SourceRef; targetId: UnitId; statusIds: readonly StatusId[]; reason?: 'expired' | 'consumed' | 'replaced'; parentEventId?: string }
  | { type: 'remove-status-instances'; source: SourceRef; targetId: UnitId; instanceIds: readonly string[]; reason?: 'expired' | 'consumed' | 'replaced'; parentEventId?: string }
  | { type: 'change-action-gauge'; source: SourceRef; targetId: UnitId; amount: number; parentEventId?: string;
      checkImmunity?: boolean }
  | { type: 'advance-resource-meter'; source: SourceRef; side: SideId; resourceId: string; steps: number; parentEventId?: string }
  | { type: 'set-resource-meter-progress'; source: SourceRef; side: SideId; resourceId: string; progress: number; parentEventId?: string }
  | { type: 'add-status'; source: SourceRef; targetId: UnitId; instance: StatusInstance; parentEventId?: string }
  | { type: 'change-status-stacks'; source: SourceRef; targetId: UnitId; instanceId: string; amount: number; parentEventId?: string }
  | { type: 'change-resource'; source: SourceRef; side: SideId; resourceId: string; amount: number; parentEventId?: string }
  | { type: 'schedule-action'; source: SourceRef; intent: ActionIntent; scheduling: ActionScheduling; freeCast?: boolean; parentEventId?: string }
  | { type: 'schedule-turn'; source: SourceRef; unitId: UnitId; scheduling: 'extra-turn'; selection: 'action-gauge'; parentEventId?: string }
  | { type: 'schedule-attack'; source: SourceRef; intent: ActionIntent; scheduling: ActionScheduling;
    hits: readonly ScheduledHit[]; suppressSoulTriggers?: boolean; suppressTargetSoulTriggers?: boolean; suppressTargetPassiveTriggers?: boolean; suppressSourcePassiveTriggers?: boolean; parentEventId?: string };

export interface BattleContext {
  readonly state: BattleState;
  getUnit(unitId: UnitId): UnitState | undefined;
  getEffectiveStats(unitId: UnitId): UnitStats | undefined;
  getStatusCategory(statusId: StatusId): StatusCategory | undefined;
  isStatusDispellable(statusId: StatusId): boolean;
  isUnitUnableToAct(unitId: UnitId): boolean;
  actionGaugeChangeAllowed(unitId: UnitId, amount: number): boolean;
  getLivingUnits(side: SideId): readonly UnitState[];
  random(): number;
  calculateDamage(input: import('../mechanics/damage').DamageFormulaInput, attacker: UnitState, target: UnitState): import('../mechanics/damage').CalculatedDamage;
  submit(command: EffectCommand): void;
}

export type StatId = 'attack' | 'defense' | 'speed' | 'crit' | 'critDamage' | 'hit' | 'resist' | 'critResist' | 'damage';
