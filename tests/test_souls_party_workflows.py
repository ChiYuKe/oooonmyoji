"""Exercise the shipped party loops through the real workflow engine without a device."""

from collections import deque
from pathlib import Path

import pytest

from src.oooonmyoji.actions import Action, ActionRegistry, ActionResult, ActionSpec, build_action_registry
from src.oooonmyoji.workflows.engine import WorkflowEngine
from src.oooonmyoji.workflows.loader import WorkflowLoader

ROOT = Path(__file__).resolve().parents[1]


class Context:
    def check_cancelled(self):
        pass


class ScriptAction(Action):
    def __init__(self, name, screens, calls, stuck=False, reward_transition=False, stale_state=None):
        self.name, self.screens, self.calls, self.stuck = name, screens, calls, stuck
        self.reward_transition = reward_transition
        self.stale_state = stale_state

    def execute(self, context, arguments):
        self.calls.append((self.name, arguments))
        if self.name == 'vision.detect_state':
            current = 'reward' if self.stuck else self.screens.popleft()
            candidate = next(s for s in arguments['states'] if s['name'] == current)
            return ActionResult.succeeded(dict(state=current, source='template', confidence=.99,
                match=match(candidate.get('template') or candidate['templates'][0]), elapsed_seconds=0))
        if self.name == 'vision.wait_any':
            if self.reward_transition and sum(name == self.name for name, _ in self.calls) > 1:
                return ActionResult.failed('reward changed to the next screen', category='not_matched')
            template = arguments['templates'][0]
            return ActionResult.succeeded(dict(template=template, match=match(template), elapsed_seconds=0))
        if self.name == 'vision.wait_template':
            template = arguments['template']
            if self.stale_state and self.stale_state in template:
                return ActionResult.failed('screen advanced before the handler could run', category='not_matched')
            if ('reinvite-default-checkbox' in template or
                    (self.stuck and 'floor-team-button' in template)):
                return ActionResult.failed('template not found', category='not_matched')
            return ActionResult.succeeded(dict(found=True, timed_out=False, matches=[match(template)]))
        # Click/sleep/log outputs have no required fields. The test records all inputs.
        return ActionResult.succeeded({})


def match(template):
    return dict(x=0, y=0, width=20, height=20, confidence=.99, reference=[0,0,20,20],
                center=[10,10], template=template, threshold=.8)


def run(role, screens, rounds=1, stuck=False, reward_transition=False, stale_state=None):
    registry, calls, queue = ActionRegistry(), [], deque(screens)
    for spec in build_action_registry(ROOT / 'plugins/actions').specs():
        action = ScriptAction(spec.name, queue, calls, stuck, reward_transition, stale_state)
        registry.register(ActionSpec(spec.definition, action))
    spec = WorkflowLoader(ROOT / 'workflows', registry, project_root=ROOT).load('souls_party_'+role)
    result = WorkflowEngine(spec, registry, Context(), {'运行轮数': rounds}).run()
    return result, calls, queue


@pytest.mark.parametrize('screens', [
    ['room', 'ready', 'reward', 'reward', 'room'],
    ['accept', 'accept', 'auto_accept', 'ready', 'reward', 'reward', 'accept', 'room'],
])
def test_member_responds_to_current_screen_without_waiting_for_an_invitation(screens):
    result, calls, queue = run('member', screens)
    assert result.status.value == 'succeeded'
    assert not queue
    assert all(args['timeout_seconds'] <= 2 for name, args in calls if name == 'vision.wait_template')


def test_captain_handles_multiple_reward_pages_and_starts_the_next_battle():
    result, calls, queue = run('captain', [
        'room', 'reward', 'reward', 'reinvite', 'room',
        'room', 'reward', 'room',
    ], rounds=2)
    assert result.status.value == 'succeeded'
    assert not queue
    clicks = [args for name, args in calls if name == 'input.tap_match']
    assert sum('wait_floor_from_map' in args['match']['template'] for args in clicks) == 2
    assert sum('wait_for_empty_party_slot_1' in args['match']['template'] for args in clicks) == 3
    assert not any('task_1-templates' in args['match']['template'] for args in clicks)


def test_stuck_reward_page_does_not_count_as_a_completed_round():
    result, calls, _ = run('captain', [], stuck=True)
    assert result.status.value == 'failed'
    assert not any(name == 'input.tap_match' and 'wait_floor_from_map' in args['match']['template']
                   for name, args in calls)


def test_member_clears_leftover_rewards_before_counting_new_battles():
    result, calls, queue = run('member', [
        'reward', 'reward', 'courtyard',
        'accept', 'ready', 'reward', 'reward', 'room',
    ])
    assert result.status.value == 'succeeded'
    assert not queue
    reward_clicks = [args for name, args in calls if name == 'input.tap_match'
                     and 'wait_for_empty_party_slot_1' in args['match']['template']]
    assert len(reward_clicks) == 3


def test_reward_disappearing_during_dispatch_confirms_next_screen_and_continues():
    result, calls, queue = run('member', [
        'room', 'reward', 'reward', 'battle', 'battle',
    ], reward_transition=True)
    assert result.status.value == 'succeeded'
    assert not queue
    assert any(name == 'vision.detect_state' and 'battle' in [s['name'] for s in args['states']]
               and 'reward' not in [s['name'] for s in args['states']] for name, args in calls)
    assert not any(name == 'input.tap_match' for name, _ in calls)


@pytest.mark.parametrize(('state', 'template'), [
    ('ready', 'wait_for_floor_team_button-template'),
    ('accept', 'invite-accept-button'),
    ('auto_accept', 'tap_empty_party_slot_1-disappeared_states'),
])
def test_page_transition_before_state_handler_does_not_abort_the_loop(state, template):
    result, calls, queue = run('member', [
        'room', state, 'battle', 'reward', 'reward', 'room',
    ], stale_state=template)
    assert result.status.value == 'succeeded'
    assert not queue
    assert not any(name == 'input.tap_match' and template in args['match']['template'] for name, args in calls)
