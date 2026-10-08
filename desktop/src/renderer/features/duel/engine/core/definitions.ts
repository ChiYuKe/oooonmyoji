import type { ActionIntent, ActionKind, ActionScheduling, BattleContext, BattleEvent, BattlePhase, BattleState, EffectCommand, SkillId, SoulId, StatusCategory, StatusId, UnitState } from './types';
import type { CoverageStatus } from './result';

export type RuleHandler = (context: BattleContext, event: BattleEvent) => readonly EffectCommand[] | void;
export interface PhaseRuleDefinition {
  priority: number;
  handle: RuleHandler;
}
export type PhaseRuleSet = Partial<Record<BattlePhase, PhaseRuleDefinition>>;

export interface SkillDefinition {
  id: SkillId;
  /** Standard ratio parameters use native addDmg; false keeps a nonstandard ratio's explicit mapping. */
  useClientDamageData?: boolean;
  aiRule?: import('../policies/weighted-policy').SkillAiRule;
  actionKind?: ActionKind;
  resourceCost?: { resourceId: string; amount: number };
  resourceCostsByLevel?: readonly { resourceId: string; amount: number }[];
  resolveResourceCost?(state: import('./types').BattleState, actor: Readonly<UnitState>,
    scheduling?: ActionScheduling): { resourceId: string; amount: number } | undefined;
  alternatePayment?: { resourceId: string; meterResourceId: string; minSkillLevel: number; meterStepsPerMissing?: number };
  target: ActionIntent['shape'];
  targetRelation?: ActionIntent['targetRelation'];
  /** Allows a skill to select defeated units, for example resurrection targets. */
  allowDefeatedTargets?: boolean;
  /** Suppresses soul triggers for this action when the skill rules explicitly require it. */
  suppressSoulTriggers?: boolean;
  canUse?(state: Readonly<import('./types').BattleState>, actor: Readonly<UnitState>): boolean;
  levels: readonly Readonly<Record<string, number | boolean | string>>[];
  execute(context: BattleContext, intent: ActionIntent, parameters: Readonly<Record<string, number | boolean | string>>): readonly EffectCommand[];
}

export function skillResourceCost(skill: SkillDefinition, skillLevel: number): { resourceId: string; amount: number } | undefined {
  if (!skill.resourceCostsByLevel || skill.resourceCostsByLevel.length === 0) return skill.resourceCost;
  return skill.resourceCostsByLevel[Math.max(0, Math.min(skillLevel - 1, skill.resourceCostsByLevel.length - 1))];
}

export interface HeroDefinition {
  id: number;
  skills: readonly SkillDefinition[];
  aiCoverage?: CoverageStatus;
  mechanicsCoverage?: CoverageStatus;
  aiCoverageNotes?: readonly string[];
  mechanicsCoverageNotes?: readonly string[];
  initialize?(context: BattleContext, unitId: string): readonly EffectCommand[];
  policy?: (context: BattleContext, unitId: string) => ActionIntent | undefined;
  modifyOutgoingDamage?(attacker: Readonly<UnitState>, target: Readonly<UnitState>, amount: number, kind: 'normal' | 'true',
    state: Readonly<BattleState>): number;
  modifyIncomingDamage?(attacker: Readonly<UnitState>, target: Readonly<UnitState>, amount: number, kind: 'normal' | 'true',
    source?: import('./types').SourceRef): number;
  modifyCriticalDamage?(attacker: Readonly<UnitState>, target: Readonly<UnitState>, amount: number,
    criticalBaseAmount: number, state: Readonly<BattleState>): number;
  modifyOutgoingHealing?(healer: Readonly<UnitState>, target: Readonly<UnitState>, amount: number): number;
  interceptIncomingDamage?(state: import('./types').BattleState, attacker: Readonly<UnitState> | undefined,
    target: Readonly<UnitState>, amount: number, kind: 'normal' | 'true', context?: DamageInterceptionContext): DamageInterception | undefined;
  handlers?: PhaseRuleSet;
  beforeCalculateDamage?: DamageCalculationHooks['before'];
  afterCalculateDamage?: DamageCalculationHooks['after'];
}

export interface DamageCalculationHooks {
  before?(input: import('../mechanics/damage').DamageFormulaInput, attacker: UnitState, target: UnitState, state: BattleState): import('../mechanics/damage').DamageFormulaInput;
  after?(damage: number, critical: boolean, attacker: UnitState, target: UnitState, state: BattleState): number;
}

export interface DamageInterception {
  readonly amount: number;
  readonly effects: readonly EffectCommand[];
}

/** Read-only hit context for rules that intercept damage once per attack. */
export interface DamageInterceptionContext {
  readonly source?: import('./types').SourceRef;
  readonly isCritical?: boolean;
  /** Explicitly disables damage-sharing interception for skills whose client text says they cannot be shared. */
  readonly cannotBeShared?: boolean;
  readonly attackId: number;
  readonly hitIndex: number;
  readonly targetIds: readonly import('./types').UnitId[];
  readonly attackShape?: ActionIntent['shape'];
  readonly actionKind?: ActionKind;
  readonly battle: BattleContext;
  isUnitUnableToAct(unitId: string): boolean;
}

export interface SoulDefinition {
  id: SoulId;
  mechanicsCoverage?: CoverageStatus;
  mechanicsCoverageNotes?: readonly string[];
  parameters?: Readonly<Record<string, number | boolean | string>>;
  initialize?(context: BattleContext, unitId: string): readonly EffectCommand[];
  modifyOutgoingDamage?(attacker: Readonly<UnitState>, target: Readonly<UnitState>, amount: number, kind: 'normal' | 'true',
    state?: Readonly<BattleState>, random?: () => number): number;
  modifyIncomingDamage?(attacker: Readonly<UnitState>, target: Readonly<UnitState>, amount: number, kind: 'normal' | 'true'): number;
  modifyCriticalDamage?(attacker: Readonly<UnitState>, target: Readonly<UnitState>, amount: number,
    criticalBaseAmount: number, state: Readonly<BattleState>): number;
  /** Team-wide critical damage mitigation granted by an active soul carrier. */
  modifyCriticalDamageTaken?(wearer: Readonly<UnitState>, target: Readonly<UnitState>, amount: number,
    criticalBaseAmount: number, state: Readonly<BattleState>): number;
  modifyOutgoingHealing?(healer: Readonly<UnitState>, target: Readonly<UnitState>, amount: number): number;
  /** Pure per-action adjustment; the runner validates and pays the returned additional cost. */
  resolveActionAdjustment?(state: Readonly<BattleState>, actor: Readonly<UnitState>, skill: SkillDefinition): ActionAdjustment | undefined;
  interceptIncomingDamage?(state: import('./types').BattleState, attacker: Readonly<UnitState> | undefined,
    target: Readonly<UnitState>, amount: number, kind: 'normal' | 'true', context?: DamageInterceptionContext): DamageInterception | undefined;
  handlers?: PhaseRuleSet;
}

export interface ActionAdjustment {
  additionalResourceCost?: { resourceId: string; amount: number };
  resourceCostSubstitutions?: readonly { resourceId: string; statusId: string; sourceUnitId?: string;
    whenInsufficient?: boolean; linkedStatusId?: string }[];
  damageMultiplier?: number;
  label?: string;
}

export interface StatusDefinition {
  id: StatusId;
  mechanicsCoverage?: CoverageStatus;
  mechanicsCoverageNotes?: readonly string[];
  dispellable: boolean;
  sealable: boolean;
  durationOwner: 'source-turn' | 'target-turn' | 'round' | 'event' | 'permanent';
  refreshPolicy: 'replace' | 'refresh-duration' | 'add-stack' | 'keep';
  maxStacks?: number;
  /** For add-stack statuses, merge applications from different skills when they share the same source unit. */
  stackScope?: 'source' | 'source-unit';
  category?: StatusCategory;
  /** A control status with this flag consumes the unit's action when it next acts. */
  preventsAction?: boolean;
  /** A silence-like control blocks paid skills while still allowing a basic attack. */
  preventsSkill?: boolean;
  /** Prevents this unit from being selected for scheduled ally assists. */
  preventsAssist?: boolean;
  /** Prevents the unit's normal post-action resource-meter advance. */
  blocksResourceMeterAdvance?: boolean;
  /** Prevents direct single-target enemy skills from selecting this unit while the status is present. */
  protectsFromDirectTargeting?: boolean;
  /** Prevents other effects from intercepting or sharing damage away from this unit. */
  preventsDamageSharing?: boolean;
  preventsDamageSharingOnHitActionKinds?: readonly ActionKind[];
  /** Applies only to the next matching hit types; the status must also opt into consumption. */
  ignoresShieldOnHitActionKinds?: readonly ActionKind[];
  suppressesTargetTriggersOnHitActionKinds?: readonly ActionKind[];
  consumesOneStackOnHitActionKinds?: readonly ActionKind[];
  /** Blocks positive and negative action-gauge modifications while the status is present. */
  preventsActionGaugeChange?: boolean;
  /** Native PUSH_TURN_POS blocks decreases; PULL_TURN_POS blocks increases. */
  preventsActionGaugeDecrease?: boolean;
  preventsActionGaugeIncrease?: boolean;
  absorbsCriticalBonus?: boolean;
  controlProtection?: 'single-application' | 'single-skill' | 'immune';
  /** Blocks only the listed control types, leaving other control effects eligible. */
  controlImmunityTypes?: readonly string[];
  statusImmunity?: 'debuffs';
  /** Marks a defeated unit as occupying its battle slot, preventing resurrection until removed. */
  preventsRevive?: boolean;
  /** One stack prevents one hit from reducing the holder to zero HP. */
  preventsLethalDamage?: boolean;
  /** Lethal protection is inactive while the holder's passive triggers are sealed. */
  requiresPassiveEnabled?: boolean;
  /** Lethal protection is inactive while the holder's equipped souls are sealed. */
  requiresSoulEnabled?: boolean;
  blocksNextDispellableBuff?: boolean;
  healingConversionToShield?: { ratio: number; shieldStatusId: StatusId; duration: number; durationOwner: 'source-turn' | 'target-turn' | 'round' };
  /** Restricts healing and direct health restoration to effects from the listed source IDs. */
  healingRestriction?: { allowedSourceIds: readonly string[] };
  /** Prevents new positive buff and shield statuses from being applied to this unit. */
  preventsBuffApplications?: boolean;
  /** Consumes healing against status.values.healingAbsorptionRemaining and removes exhausted statuses. */
  healingAbsorption?: boolean;
  /** Consumes one status stack and blocks one healing effect. */
  blocksNextHealing?: boolean;
  /** Consumes one status stack and blocks one positive action-gauge change. */
  blocksNextActionAdvance?: boolean;
  /** Skills temporarily granted while this status instance is active. */
  grantedSkills?: readonly SkillDefinition[];
  /** Resource credit exposed to the wearer's action policy while this status is active. */
  policyResourceBonus?: { resourceId: string; amount: number };
  /** Optional AI action offered by this status, re-evaluated for its current holder. */
  selectAction?(context: BattleContext, actor: Readonly<UnitState>, instance: import('./types').StatusInstance): ActionIntent | undefined;
  handlers?: PhaseRuleSet;
  /** Re-evaluated against this entity's current statuses on every payment. */
  modifyResourceCost?(state: BattleState, actor: UnitState, skill: SkillDefinition, cost: { resourceId: string; amount: number }): number;
}

export interface RuleRegistration<T> {
  readonly id: string;
  readonly definition: T;
}
