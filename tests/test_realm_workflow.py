from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from src.oooonmyoji.actions.builtin import (
    DetectRealmProgressAction,
    DismissTemplateUntilTextAction,
    ReadRealmPassCountAction,
    WaitAnyTextAction,
)
from src.oooonmyoji.vision.template import TemplateMatch


class OcrContext:
    def __init__(self, texts: list[str]) -> None:
        self.results = [SimpleNamespace(text=text, confidence=0.95, x=10, y=10) for text in texts]
        self.logged: list[tuple[str, dict[str, object]]] = []

    def ocr(self, *, roi: object = None) -> list[object]:
        return self.results

    def capture(self) -> None:
        return None

    def check_cancelled(self) -> None:
        return None

    def log(self, message: str, **fields: object) -> None:
        self.logged.append((message, fields))


def test_realm_pass_count_prefers_labeled_number() -> None:
    result = ReadRealmPassCountAction().execute(
        OcrContext(["结界突破券", "30"]),
        {"roi": [1450, 0, 470, 180], "minimum_passes": 30},
    )

    assert result.status.value == "succeeded"
    assert result.output["passes"] == 30
    assert result.output["mode"] == "run"
    assert result.output["should_enter"] is True


def test_realm_pass_count_fails_closed_when_ocr_is_unavailable() -> None:
    class Disabled(OcrContext):
        def ocr(self, *, roi: object = None) -> list[object]:
            raise RuntimeError("ocr disabled")

    result = ReadRealmPassCountAction().execute(
        Disabled([]),
        {"roi": [1450, 0, 470, 180], "minimum_passes": 30},
    )

    assert result.status.value == "succeeded"
    assert result.output == {
        "passes": 0,
        "detected": False,
        "should_enter": False,
        "mode": "skip",
        "raw_text": "",
    }


def test_wait_any_text_returns_first_matching_candidate() -> None:
    result = WaitAnyTextAction().execute(
        OcrContext(["战斗中"]),
        {"texts": ["结界突破", "战斗"], "timeout_seconds": 0.1, "present": True},
    )

    assert result.status.value == "succeeded"
    assert result.output["matched_text"] == "战斗中"


def test_wait_any_text_can_expire_without_failing_when_explicitly_allowed() -> None:
    result = WaitAnyTextAction().execute(
        OcrContext([]),
        {"texts": ["战斗"], "timeout_seconds": 0, "allow_timeout": True},
    )

    assert result.status.value == "succeeded"
    assert result.output["timed_out"] is True
    assert result.output["present"] is False


def test_dismiss_template_clicks_each_reward_layer_until_page_returns() -> None:
    class LayeredRewardContext(OcrContext):
        def __init__(self) -> None:
            super().__init__([])
            self.layer = 0

        def find_template(self, template: str, **kwargs: object) -> list[TemplateMatch]:
            if self.layer >= 3:
                return []
            return [TemplateMatch(820, 995, 285, 75, 0.94, 820, 995, 285, 75)]

        def ocr(self, *, roi: object = None) -> list[object]:
            return [SimpleNamespace(text="结界突破", confidence=0.99)] if self.layer >= 3 else []

        def tap(self, x: int, y: int, *, hold_ms: int = 0) -> None:
            self.layer += 1

    context = LayeredRewardContext()
    result = DismissTemplateUntilTextAction().execute(
        context,
        {
            "match": TemplateMatch(820, 995, 285, 75, 0.94, 820, 995, 285, 75).to_dict(),
            "template": "continue.png",
            "done_texts": ["结界突破"],
            "timeout_seconds": 2,
            "max_clicks": 6,
            "post_click_delay": 0,
            "stable_seconds": 0,
            "random_offset": 0,
            "random_interval": [0, 0],
        },
    )

    assert result.status.value == "succeeded"
    assert result.output["click_count"] == 3
    assert context.layer == 3


def test_realm_progress_reports_completed_target_count() -> None:
    context = OcrContext(["已击败"])
    result = DetectRealmProgressAction().execute(
        context,
        {
            "target_rois": [[0, 0, 100, 100]] * 8 + [[100, 0, 100, 100]],
            "page_roi": [0, 0, 200, 100],
            "completed_texts": ["已击败"],
        },
    )

    assert result.status.value == "succeeded"
    assert result.output["completed_count"] == 8
    assert result.output["next_index"] == 9
    assert result.output["detected"] is True


def test_realm_progress_target_limit_selects_only_next_incomplete_target() -> None:
    context = OcrContext(["已击败"])
    result = DetectRealmProgressAction().execute(
        context,
        {
            "target_rois": [[0, 0, 100, 100]] * 3 + [[100, 0, 100, 100]] * 6,
            "page_roi": [0, 0, 200, 100],
            "completed_texts": ["已击败"],
            "target_limit": 1,
        },
    )

    assert result.status.value == "succeeded"
    assert result.output["completed"][:3] == [True, True, True]
    assert result.output["selected"] == [False, False, False, True, False, False, False, False, False]


def test_realm_progress_fails_closed_with_schema_complete_output() -> None:
    class Disabled(OcrContext):
        def ocr(self, *, roi: object = None) -> list[object]:
            raise RuntimeError("ocr disabled")

    result = DetectRealmProgressAction().execute(
        Disabled([]),
        {
            "target_rois": [[0, 0, 100, 100]] * 9,
            "page_roi": [0, 0, 100, 100],
            "completed_texts": ["已击败"],
        },
    )

    assert result.status.value == "succeeded"
    assert result.output["detected"] is False
    assert result.output["completed"] == [False] * 9
    assert result.output["selected"] == [False] * 9
    assert result.output["evidence"] == [[] for _ in range(9)]


def test_realm_workflow_explicitly_models_nine_targets_and_four_resets() -> None:
    root = Path(__file__).resolve().parents[1]
    workflow = json.loads((root / "workflows/realm/shared/realm_raid_loop.json").read_text(encoding="utf-8"))
    nodes = {node["id"]: node for node in workflow["nodes"]}

    assert workflow["blackboard"]["settlement_template"]["default"] == "assets/templates/souls/souls-victory-continue.png"

    page = nodes["challenge_page"]["children"]
    assert page[:8] == [f"target_{index}" for index in range(1, 9)]
    assert page[-2:] == ["target_9_reset", "target_9_final"]
    reset = nodes["target_9_reset_run"]["children"]
    assert [node_id for node_id in reset if node_id.startswith("exit_9")] == [
        "exit_9", "exit_9b", "exit_9c", "exit_9d"
    ]
    for node_id in ["exit_9", "exit_9b", "exit_9c", "exit_9d"]:
        assert nodes[node_id]["params"]["keycode"] == "KEYCODE_ESCAPE"
    assert [node_id for node_id in reset if node_id.startswith("confirm_exit_9")] == [
        "confirm_exit_9", "confirm_exit_9b", "confirm_exit_9c", "confirm_exit_9d"
    ]
    for index in range(1, 9):
        run = nodes[f"target_{index}_run"]
        skip = nodes[f"target_{index}_skip"]
        assert run["children"] == [
            f"wait_target_page_{index}",
            f"read_passes_before_{index}",
            f"set_passes_before_{index}",
            f"tap_{index}",
            f"target_select_delay_{index}",
            f"fight_{index}",
        ]
        assert nodes[f"tap_{index}"]["decorators"][0]["expression"] == {
            "eq": [{"ref": "blackboard.passes_available"}, True]
        }
        assert run["decorators"][0]["expression"] == {
            "eq": [{"ref": f"nodes.detect_progress.output.selected.{index - 1}"}, True]
        }
        assert skip["decorators"][0]["expression"] == {
            "eq": [{"ref": f"nodes.detect_progress.output.selected.{index - 1}"}, False]
        }
    assert nodes["target_9_reset"]["children"] == ["target_9_reset_run", "target_9_reset_skip"]
    assert nodes["target_9_final"]["children"] == ["target_9_final_run", "target_9_final_skip"]
    assert nodes["target_9_reset_run"]["decorators"][0]["expression"] == {
        "eq": [{"ref": "nodes.detect_progress.output.selected.8"}, True]
    }
    assert nodes["target_9_reset_run"]["children"][:4] == [
        "wait_target_page_9_initial", "read_passes_before_9a", "set_passes_before_9a", "tap_9"
    ]
    reset_children = nodes["target_9_reset_run"]["children"]
    assert reset_children.index("confirm_exit_9") < reset_children.index("wait_continue_after_exit_9")
    assert reset_children.index("wait_continue_after_exit_9") < reset_children.index("tap_retry_after_exit_9") < reset_children.index("attack_9b")
    assert reset_children.index("confirm_exit_9b") < reset_children.index("wait_continue_after_exit_9b")
    assert reset_children.index("wait_continue_after_exit_9b") < reset_children.index("tap_retry_after_exit_9b") < reset_children.index("attack_9c")
    for suffix in ["9", "9b", "9c", "9d"]:
        wait = nodes[f"wait_continue_after_exit_{suffix}"]
        tap = nodes[f"tap_retry_after_exit_{suffix}"]
        assert wait["action"] == "vision.wait_template"
        assert wait["params"]["template"] == {"ref": "blackboard.settlement_template"}
        assert wait["params"]["roi"] == {"ref": "blackboard.settlement_roi"}
        assert tap["action"] == "input.tap"
        assert tap["params"]["x"] == {"ref": "blackboard.retry_point.0"}
    assert nodes["target_9_final_run"]["children"][:4] == [
        "attack_9_final", "prepare_battle_9_final", "wait_battle_9_final", "wait_victory_9_final"
    ]
    for suffix, tap_id in [("9a", "tap_9"), ("9b", "tap_retry_after_exit_9"), ("9c", "tap_retry_after_exit_9b"), ("9d", "tap_retry_after_exit_9c")]:
        assert nodes[tap_id]["decorators"][0]["expression"] == {
            "eq": [{"ref": "blackboard.passes_available"}, True]
        }
    for node_id in ["wait_victory_1", "wait_victory_8", "wait_victory_9_final"]:
        wait_node = nodes[node_id]
        assert wait_node["action"] == "vision.wait_template"
        assert wait_node["params"]["template"] == {"ref": "blackboard.settlement_template"}
        assert wait_node["params"]["roi"] == {"ref": "blackboard.settlement_roi"}
    for index in range(1, 9):
        settle = nodes[f"settle_{index}"]
        assert settle["action"] == "input.dismiss_template_until_text"
        assert settle["params"]["match"] == {"ref": f"nodes.wait_victory_{index}.output.0"}
        assert settle["params"]["done_texts"] == {"ref": "blackboard.page_texts"}
    assert nodes["settle_9"]["params"]["match"] == {"ref": "nodes.wait_victory_9_final.output.0"}
    assert nodes["target_9_final_skip"]["decorators"][0]["expression"] == {
        "eq": [{"ref": "nodes.detect_progress.output.selected.8"}, False]
    }
    assert workflow["blackboard"]["target_limit"]["default"] == 9
    assert nodes["detect_progress"]["params"]["target_limit"] == {"ref": "blackboard.target_limit"}
    assert nodes["raid_until_empty"]["condition"] == {
        "or": [
            {"eq": [{"ref": "nodes.read_passes_after_page.output.mode"}, "skip"]},
            {"lt": [{"ref": "blackboard.target_limit"}, 9]},
        ]
    }
