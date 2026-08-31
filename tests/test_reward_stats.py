from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from src.oooonmyoji.actions.builtin import EnqueueRewardStatsAction
from src.oooonmyoji.runtime.reward_stats import RewardStatsProcessor
from src.oooonmyoji.runtime.runner import _step_event_payload
from src.oooonmyoji.runtime.supervisor import Supervisor
from src.oooonmyoji.vision.ocr import OcrResult


def _write_reward_fixture(root: Path, *, default_quantity: int | None = 1) -> tuple[Path, Path]:
    cv2 = pytest.importorskip("cv2")
    np = pytest.importorskip("numpy")
    image = np.full((100, 200, 3), 24, dtype=np.uint8)
    template = np.full((20, 24, 3), 24, dtype=np.uint8)
    cv2.rectangle(template, (2, 2), (21, 17), (220, 80, 40), 3)
    cv2.line(template, (4, 15), (19, 4), (40, 220, 180), 2)
    image[20:40, 20:44] = template
    screenshot = root / "reward.png"
    ok, encoded = cv2.imencode(".png", image)
    assert ok
    screenshot.write_bytes(encoded.tobytes())
    template_dir = root / "templates"
    template_dir.mkdir()
    ok, encoded = cv2.imencode(".png", template)
    assert ok
    (template_dir / "material.png").write_bytes(encoded.tobytes())
    catalog = template_dir / "catalog.json"
    catalog.write_text(json.dumps({
        "schema_version": 1,
        "templates": [{
            "id": "soul",
            "name": "御魂",
            "template": "material.png",
            "threshold": 0.99,
            "max_results": 4,
            "default_quantity": default_quantity,
        }],
    }, ensure_ascii=False), encoding="utf-8")
    return screenshot, catalog


def test_reward_stats_processor_writes_structured_jsonl(tmp_path: Path) -> None:
    screenshot, catalog = _write_reward_fixture(tmp_path)
    events_file = tmp_path / "events.jsonl"
    events_file.write_text('{"type":"run_started","run_id":"run-one"}\n', encoding="utf-8")
    seen_shapes: list[tuple[int, ...]] = []

    def recognize(image: object) -> list[OcrResult]:
        seen_shapes.append(image.shape)
        return [
            OcrResult("12", 0.91, ((35, 35), (48, 35), (48, 50), (35, 50))),
            OcrResult("999999", 0.99, ((165, 5), (195, 5), (195, 20), (165, 20))),
        ]

    processor = RewardStatsProcessor(tmp_path / "artifacts", recognize, material_catalog=catalog)
    assert processor.submit({
        "instance_id": "mumu-1",
        "run_id": "run-one",
        "category": "souls",
        "battle_index": 2,
        "layer": 1,
        "capture_index": 3,
        "captured_at": "2026-08-29T12:00:00+00:00",
        "screenshot": str(screenshot),
        "roi": [0, 0, 200, 100],
        "events_file": str(events_file),
    })
    assert processor.close(wait_seconds=5)

    files = list((tmp_path / "artifacts" / "reward-stats" / "souls" / "mumu-1").glob("rewards-*.jsonl"))
    assert len(files) == 1
    record = json.loads(files[0].read_text(encoding="utf-8"))
    assert seen_shapes == [(100, 200, 3)]
    assert record["status"] == "succeeded"
    assert record["recognized"] is True
    assert record["text"] == "999999 12"
    assert record["numeric_values"] == [999999, 12]
    assert record["unassigned_numeric_values"] == [999999]
    assert record["items"][0]["id"] == "soul"
    assert record["items"][0]["name"] == "御魂"
    assert record["items"][0]["quantity"] == 12
    assert record["items"][0]["occurrences"] == 1
    assert record["items"][0]["detections"][0]["quantity_source"] == "ocr"
    assert record["battle_index"] == 2
    summary = json.loads((files[0].parent / "summary.json").read_text(encoding="utf-8"))
    assert summary["total_battles"] == 1
    assert summary["total_screenshots"] == 1
    assert summary["recognized_screenshots"] == 1
    assert summary["unrecognized_screenshots"] == 0
    assert summary["failed_screenshots"] == 0
    assert summary["material_totals"]["soul"]["quantity"] == 12
    assert summary["last_items"][0]["id"] == "soul"
    run_events = [json.loads(line) for line in events_file.read_text(encoding="utf-8").splitlines()]
    reward_event = run_events[-1]
    assert reward_event["type"] == "reward_stats"
    assert reward_event["run_id"] == "run-one"
    assert reward_event["battle_index"] == 2
    assert reward_event["items"] == [{
        "id": "soul",
        "name": "御魂",
        "quantity": 12,
        "occurrences": 1,
        "unresolved_occurrences": 0,
    }]
    assert reward_event["material_totals"]["soul"]["quantity"] == 12
    assert reward_event["screenshot"] == str(screenshot)


def test_reward_stats_retries_unresolved_quantity_with_local_crop(tmp_path: Path) -> None:
    screenshot, catalog = _write_reward_fixture(tmp_path, default_quantity=None)
    seen_shapes: list[tuple[int, ...]] = []

    def recognize(image: object) -> list[OcrResult]:
        seen_shapes.append(image.shape)
        if len(seen_shapes) == 1:
            return []
        return [OcrResult("10", 0.99, ((45, 8), (70, 8), (70, 28), (45, 28)))]

    processor = RewardStatsProcessor(tmp_path / "artifacts", recognize, material_catalog=catalog)
    assert processor.submit({
        "instance_id": "mumu-1",
        "run_id": "run-local-quantity",
        "category": "souls",
        "battle_index": 1,
        "layer": 1,
        "capture_index": 1,
        "captured_at": "2026-08-30T12:00:00+00:00",
        "screenshot": str(screenshot),
        "roi": [0, 0, 200, 100],
    })
    assert processor.close(wait_seconds=5)

    record_path = next((tmp_path / "artifacts" / "reward-stats").rglob("rewards-*.jsonl"))
    record = json.loads(record_path.read_text(encoding="utf-8"))
    assert seen_shapes == [(100, 200, 3), (69, 89, 3)]
    assert record["items"][0]["quantity"] == 10
    assert record["items"][0]["unresolved_occurrences"] == 0
    assert record["items"][0]["detections"][0]["quantity_source"] == "ocr"
    assert record["items"][0]["detections"][0]["quantity_ocr"]["source"] == "quantity_crop"


def test_reward_screenshots_retain_latest_ten_battles_per_instance_across_runs(tmp_path: Path) -> None:
    fixture, _ = _write_reward_fixture(tmp_path)
    artifact_dir = tmp_path / "artifacts"
    state_dir = artifact_dir / "runs"
    state_dir.mkdir(parents=True)
    image_bytes = fixture.read_bytes()
    base_time = 1_700_000_000_000_000_000

    def write_state(run_id: str, instance_id: str) -> None:
        (state_dir / f"{run_id}.json").write_text(
            json.dumps({"run_id": run_id, "instance_id": instance_id}),
            encoding="utf-8",
        )

    def write_screenshot(run_id: str, battle: int, modified_at: int) -> Path:
        reward_dir = artifact_dir / run_id / "rewards"
        reward_dir.mkdir(parents=True, exist_ok=True)
        path = reward_dir / f"reward-{battle:04d}-layer-1-capture-{battle:04d}.png"
        path.write_bytes(image_bytes)
        os.utime(path, ns=(modified_at, modified_at))
        return path

    write_state("run-old", "mumu-1")
    write_state("run-new", "mumu-1")
    write_state("run-other", "mumu-0")
    for battle in range(1, 13):
        write_screenshot("run-old", battle, base_time + battle * 1_000_000_000)
    other_screenshots = [
        write_screenshot("run-other", battle, base_time + battle * 1_000_000_000)
        for battle in range(1, 6)
    ]
    current = write_screenshot("run-new", 1, base_time + 100 * 1_000_000_000)
    pending = write_screenshot("run-new", 2, base_time + 101 * 1_000_000_000)

    processor = RewardStatsProcessor(artifact_dir, lambda _image: [])
    for battle, screenshot in ((1, current), (2, pending)):
        assert processor.submit({
            "instance_id": "mumu-1",
            "run_id": "run-new",
            "category": "souls",
            "battle_index": battle,
            "layer": 1,
            "capture_index": battle,
            "captured_at": "2026-08-30T12:00:00+00:00",
            "screenshot": str(screenshot),
            "roi": [0, 0, 200, 100],
        })
    assert processor.close(wait_seconds=5)

    retained = {
        path.relative_to(artifact_dir).as_posix()
        for path in artifact_dir.glob("run-*/rewards/reward-*.png")
        if "run-other" not in path.parts
    }
    assert retained == {
        *(f"run-old/rewards/reward-{battle:04d}-layer-1-capture-{battle:04d}.png" for battle in range(5, 13)),
        "run-new/rewards/reward-0001-layer-1-capture-0001.png",
        "run-new/rewards/reward-0002-layer-1-capture-0002.png",
    }
    assert all(path.is_file() for path in other_screenshots)


def test_supervisor_drains_reward_stats_before_stopping_ocr(tmp_path: Path) -> None:
    class OcrPool:
        def __init__(self) -> None:
            self.closed = False

        def recognize(self, image: object) -> list[object]:
            assert not self.closed
            return [image]

        def close(self, *, force: bool = False) -> None:
            assert force is True
            self.closed = True

    config = type("Config", (), {
        "log_dir": tmp_path,
        "ocr": type("Ocr", (), {"enabled": True})(),
    })()
    supervisor = Supervisor(config)  # type: ignore[arg-type]
    ocr_pool = OcrPool()
    supervisor.ocr_pool = ocr_pool  # type: ignore[assignment]
    drained: list[list[object]] = []

    class RewardStats:
        def close(self, *, wait_seconds: float) -> bool:
            assert wait_seconds == 15.0
            assert supervisor._stopping is False
            drained.append(supervisor._recognize_reward_image("pending reward"))
            return True

    supervisor._reward_stats = RewardStats()  # type: ignore[assignment]
    supervisor.stop()

    assert drained == [["pending reward"]]
    assert supervisor._stopping is True
    assert ocr_pool.closed is True
    assert supervisor.ocr_pool is None


def test_enqueue_reward_action_is_non_fatal_when_queue_is_unavailable() -> None:
    class Context:
        def enqueue_reward_statistics(self, **_arguments: object) -> dict[str, object]:
            raise RuntimeError("queue unavailable")

        def log(self, _message: str, **_fields: object) -> None:
            return None

    result = EnqueueRewardStatsAction().execute(Context(), {"category": "souls", "layer": 1})
    assert result.status.value == "succeeded"
    assert result.output["accepted"] is False
    assert result.output["error"] == "queue unavailable"


def test_souls_workflow_calls_statistics_before_closing_rewards() -> None:
    project_root = Path(__file__).resolve().parents[1]
    workflow = json.loads((project_root / "workflows" / "entrypoints" / "mumu_1_souls_loop.json").read_text(encoding="utf-8"))
    stats_workflow = json.loads((project_root / "workflows" / "souls" / "shared" / "reward_statistics.json").read_text(encoding="utf-8"))
    nodes = {node["id"]: node for node in workflow["nodes"]}
    assert nodes["main"]["children"][:2] == ["prepare_entry", "enter_souls"]
    assert nodes["return_to_courtyard"]["children"] == [
        "detect_return_courtyard",
        "tap_return_courtyard",
        "wait_courtyard_after_return",
    ]
    assert nodes["detect_return_courtyard"]["params"]["template"] == (
        "assets/templates/souls/return-courtyard.png"
    )
    click_nodes = [
        node for node in workflow["nodes"]
        if node.get("action") in {"input.tap", "input.tap_match"}
    ]
    assert len(click_nodes) == 11
    for node in click_nodes:
        assert node["params"]["random_offset"] > 0, node["id"]
        assert node["params"]["random_interval"] == [0.2, 0.6], node["id"]
    assert nodes["battle_loop"]["children"] == [
        "wait_challenge",
        "tap_challenge",
        "prepare_lineup",
        "await_victory",
        "settlement",
    ]
    assert nodes["prepare_lineup"]["params"] == {
        "workflow": "souls/shared/prepare_lineup.json",
        "inputs": {"timeout_seconds": 30},
    }
    assert nodes["await_victory"]["params"] == {
        "workflow": "souls/shared/await_victory.json",
        "inputs": {"timeout_seconds": 180},
    }
    assert nodes["settled_one_tap"]["children"][:2] == ["stats_reward_layer_1", "dismiss_reward_once"]
    assert nodes["settled_more_taps"]["children"] == [
        "stats_reward_layer_2",
        "dismiss_reward_twice_a",
        "settlement_pause",
        "stats_reward_layer_3",
        "dismiss_reward_twice_b",
        "wait_floor_after_more",
    ]
    for layer in (1, 2, 3):
        node = nodes[f"stats_reward_layer_{layer}"]
        assert node["action"] == "workflow.run"
        assert node["params"]["workflow"] == "souls/shared/reward_statistics.json"
        assert node["params"]["inputs"]["layer"] == layer
    stats_nodes = {node["id"]: node for node in stats_workflow["nodes"]}
    assert stats_nodes["enqueue_reward"]["params"]["roi"] == [320, 200, 1280, 640]


def test_courtyard_explore_templates_are_scoped_by_instance() -> None:
    project_root = Path(__file__).resolve().parents[1]
    workflow_paths = {
        "mumu-0": project_root / "workflows" / "entrypoints" / "mumu_0_souls_party_leader.json",
        "mumu-1": project_root / "workflows" / "entrypoints" / "mumu_1_souls_loop.json",
    }

    for instance_id, workflow_path in workflow_paths.items():
        workflow = json.loads(workflow_path.read_text(encoding="utf-8"))
        nodes = {node["id"]: node for node in workflow["nodes"]}
        params = nodes["wait_courtyard_explore"]["params"]
        assert params["template"] == f"assets/templates/souls/courtyard-explore/{instance_id}.png"
        assert (project_root / params["template"]).is_file()

    leader = json.loads(workflow_paths["mumu-0"].read_text(encoding="utf-8"))
    leader_nodes = {node["id"]: node for node in leader["nodes"]}
    leader_params = leader_nodes["wait_courtyard_explore"]["params"]
    x, _, width, _ = leader_params["roi"]
    assert x <= 360
    assert x + width >= 1020
    assert leader_nodes["main"]["children"][0] == "ensure_party_room"
    assert "wake_hidden_ui" not in leader_nodes["main"]["children"]
    assert leader_nodes["from_courtyard"]["children"][:2] == [
        "ensure_courtyard_ui_visible",
        "wait_courtyard_explore",
    ]
    assert leader_nodes["ensure_courtyard_ui_visible"]["children"] == [
        "detect_courtyard_explore",
        "wake_hidden_courtyard",
    ]
    assert leader_nodes["wake_hidden_courtyard"]["children"] == [
        "wake_hidden_ui",
        "detect_courtyard_explore_after_wake",
    ]


def test_party_teammate_templates_flow_through_public_workflow_variables() -> None:
    project_root = Path(__file__).resolve().parents[1]
    workflows = project_root / "workflows"
    parallel = json.loads((workflows / "entrypoints" / "three_mumu_souls_parallel.json").read_text(encoding="utf-8"))
    leader = json.loads((workflows / "entrypoints" / "mumu_0_souls_party_leader.json").read_text(encoding="utf-8"))
    leader_round = json.loads((workflows / "souls" / "party" / "leader_round.json").read_text(encoding="utf-8"))

    template_names = ("member_present_template", "invite_target_template")
    for name in template_names:
        assert parallel["blackboard"][name]["public"] is True
        assert leader["blackboard"][name]["public"] is True

    parallel_node = next(node for node in parallel["nodes"] if node["type"] == "instance_parallel")
    leader_run = next(run for run in parallel_node["runs"] if run["workflow"] == "entrypoints/mumu_0_souls_party_leader.json")
    for name in template_names:
        assert leader_run["inputs"][name] == {"ref": f"blackboard.{name}"}

    leader_nodes = {node["id"]: node for node in leader["nodes"]}
    assert leader_nodes["detect_member_present"]["params"]["template"] == {"ref": "blackboard.member_present_template"}
    assert leader_nodes["wait_invite_target"]["params"]["template"] == {"ref": "blackboard.invite_target_template"}
    round_calls = [
        node for node in leader["nodes"]
        if node.get("action") == "workflow.run" and node.get("params", {}).get("workflow") == "souls/party/leader_round.json"
    ]
    assert len(round_calls) == 3
    assert all(
        node["params"]["inputs"]["member_present_template"] == {"ref": "blackboard.member_present_template"}
        for node in round_calls
    )

    assert leader_round["blackboard"]["member_present_template"]["public"] is True
    round_nodes = {node["id"]: node for node in leader_round["nodes"]}
    assert round_nodes["wait_member_present"]["params"]["template"] == {"ref": "blackboard.member_present_template"}


def test_party_leader_retries_swallowed_create_team_click() -> None:
    project_root = Path(__file__).resolve().parents[1]
    workflow = json.loads(
        (project_root / "workflows" / "entrypoints" / "mumu_0_souls_party_leader.json").read_text(encoding="utf-8")
    )
    nodes = {node["id"]: node for node in workflow["nodes"]}

    create_children = nodes["create_party_room"]["children"]
    first_tap = create_children.index("tap_create_team")
    assert create_children[first_tap:first_tap + 3] == [
        "tap_create_team",
        "ensure_create_dialog_open",
        "wait_create_confirm",
    ]
    assert nodes["ensure_create_dialog_open"]["children"] == [
        "detect_create_dialog_quick",
        "retry_create_dialog",
    ]
    assert nodes["retry_create_dialog"]["children"] == [
        "tap_create_team_retry",
        "wait_create_confirm_after_retry",
    ]
    assert nodes["retry_create_dialog"]["decorators"] == [
        {"type": "retry", "attempts": 3, "delay_seconds": 0.5}
    ]
    assert nodes["tap_create_team_retry"]["params"]["match"] == {
        "ref": "nodes.wait_create_team.output.0"
    }
    assert nodes["tap_create_team_retry"]["params"]["revalidate"] is True
    assert nodes["tap_create_confirm"]["params"]["match"] == {
        "ref": "nodes.wait_create_confirm.output.0"
    }


def test_party_rounds_prepare_unlocked_lineups() -> None:
    project_root = Path(__file__).resolve().parents[1]
    round_paths = [
        project_root / "workflows" / "souls" / "party" / "leader_round.json",
        project_root / "workflows" / "souls" / "party" / "member_round.json",
    ]

    for round_path in round_paths:
        workflow = json.loads(round_path.read_text(encoding="utf-8"))
        nodes = {node["id"]: node for node in workflow["nodes"]}
        round_children = nodes["round"]["children"]
        state_index = round_children.index("detect_lineup_state")
        prepare_index = round_children.index("prepare_lineup_if_needed")
        assert state_index < prepare_index
        assert round_children[prepare_index + 1] == "await_victory"
        assert nodes["detect_lineup_state"]["children"] == [
            "detect_locked_lineup",
            "detect_unlocked_lineup",
            "lineup_state_unknown",
        ]
        assert nodes["detect_unlocked_lineup"]["params"]["template"] == (
            "assets/templates/souls/party/formation-unlocked.png"
        )
        assert nodes["detect_locked_lineup"]["params"]["template"] == (
            "assets/templates/souls/party/formation-locked.png"
        )
        for state_node in ("detect_unlocked_lineup", "detect_locked_lineup"):
            assert (project_root / nodes[state_node]["params"]["template"]).is_file()
            assert nodes[state_node]["params"]["roi"] == [130, 930, 140, 100]
            assert nodes[state_node]["params"]["threshold"] == 0.4
        assert nodes["prepare_lineup_if_needed"]["children"] == [
            "lineup_already_locked",
            "prepare_unlocked_lineup",
            "lineup_started_without_ready",
        ]
        assert nodes["prepare_unlocked_lineup"]["action"] == "workflow.run"
        assert nodes["prepare_unlocked_lineup"]["params"]["workflow"] == (
            "souls/shared/prepare_lineup.json"
        )
        assert nodes["prepare_unlocked_lineup"]["params"]["inputs"] == {
            "timeout_seconds": 10
        }
        assert nodes["await_victory"]["action"] == "workflow.run"
        assert nodes["await_victory"]["params"]["workflow"] == (
            "souls/shared/await_victory.json"
        )
        assert nodes["await_victory"]["params"]["inputs"] == {
            "timeout_seconds": 240
        }
        assert nodes["lineup_already_locked"]["decorators"] == [{
            "type": "condition",
            "expression": {"exists": {"ref": "nodes.detect_locked_lineup.output.0"}},
        }]


def test_shared_battle_workflows_expose_timeout_inputs() -> None:
    project_root = Path(__file__).resolve().parents[1]
    prepare = json.loads(
        (project_root / "workflows" / "souls" / "shared" / "prepare_lineup.json").read_text(encoding="utf-8")
    )
    victory = json.loads(
        (project_root / "workflows" / "souls" / "shared" / "await_victory.json").read_text(encoding="utf-8")
    )

    assert prepare["blackboard"]["timeout_seconds"]["default"] == 10
    prepare_nodes = {node["id"]: node for node in prepare["nodes"]}
    assert prepare_nodes["prepare"]["children"] == ["wait_ready", "tap_ready"]
    assert prepare_nodes["wait_ready"]["params"]["timeout_seconds"] == {
        "ref": "blackboard.timeout_seconds"
    }
    assert prepare_nodes["tap_ready"]["params"]["match"] == {
        "ref": "nodes.wait_ready.output.0"
    }

    assert victory["blackboard"]["timeout_seconds"]["default"] == 240
    victory_nodes = {node["id"]: node for node in victory["nodes"]}
    assert victory_nodes["await"]["children"] == ["wait_victory", "tap_victory"]
    assert victory_nodes["wait_victory"]["params"]["timeout_seconds"] == {
        "ref": "blackboard.timeout_seconds"
    }
    assert victory_nodes["tap_victory"]["params"]["match"] == {
        "ref": "nodes.wait_victory.output.0"
    }


def test_party_long_run_plan_sets_up_automatic_invites_once() -> None:
    project_root = Path(__file__).resolve().parents[1]
    leader = json.loads(
        (project_root / "workflows" / "entrypoints" / "mumu_0_souls_party_leader.json").read_text(encoding="utf-8")
    )
    member = json.loads(
        (project_root / "workflows" / "entrypoints" / "mumu_1_souls_party_member.json").read_text(encoding="utf-8")
    )
    leader_nodes = {node["id"]: node for node in leader["nodes"]}
    member_nodes = {node["id"]: node for node in member["nodes"]}

    assert leader["limits"]["timeout_seconds"] == 1209600
    assert leader["blackboard"]["rounds"]["default"] == 9999
    assert leader["blackboard"]["rounds"]["enum"] == [1, 9999]
    assert leader_nodes["long_run_plan"]["children"] == [
        "setup_auto_invite_round",
        "repeat_auto_invite_rounds",
    ]
    assert leader_nodes["setup_auto_invite_round"]["params"]["inputs"] == {
        "phase": "setup_auto_invite",
        "member_present_template": {"ref": "blackboard.member_present_template"},
    }
    assert leader_nodes["repeat_auto_invite_rounds"]["params"]["inputs"] == {
        "phase": "auto_invite",
        "member_present_template": {"ref": "blackboard.member_present_template"},
    }
    assert {"type": "repeat", "count": 9998} in leader_nodes[
        "repeat_auto_invite_rounds"
    ]["decorators"]
    assert {"type": "timeout", "seconds": 1209000} in leader_nodes[
        "repeat_auto_invite_rounds"
    ]["decorators"]

    assert member["limits"]["timeout_seconds"] == 1209600
    assert member["blackboard"]["rounds"]["default"] == 9999
    assert member["blackboard"]["rounds"]["enum"] == [1, 9999]
    assert member_nodes["long_run_plan"]["children"] == [
        "setup_auto_ready_round",
        "repeat_auto_ready_rounds",
    ]
    assert member_nodes["setup_auto_ready_round"]["params"]["inputs"] == {
        "phase": "setup_auto_ready"
    }
    assert member_nodes["repeat_auto_ready_rounds"]["params"]["inputs"] == {
        "phase": "auto_ready"
    }
    assert {"type": "repeat", "count": 9998} in member_nodes[
        "repeat_auto_ready_rounds"
    ]["decorators"]
    assert {"type": "timeout", "seconds": 1209000} in member_nodes[
        "repeat_auto_ready_rounds"
    ]["decorators"]


def test_party_auto_invite_templates_and_timed_click_are_native_and_fast() -> None:
    project_root = Path(__file__).resolve().parents[1]
    leader = json.loads(
        (project_root / "workflows" / "souls" / "party" / "leader_round.json").read_text(encoding="utf-8")
    )
    member = json.loads(
        (project_root / "workflows" / "souls" / "party" / "member_round.json").read_text(encoding="utf-8")
    )
    leader_nodes = {node["id"]: node for node in leader["nodes"]}
    member_nodes = {node["id"]: node for node in member["nodes"]}

    assert leader["blackboard"]["phase"]["enum"] == [
        "finish",
        "setup_auto_invite",
        "auto_invite",
    ]
    assert leader_nodes["wait_default_invite_checkbox"]["params"]["template"] == (
        "assets/templates/souls/party/default-invite-checkbox.png"
    )
    assert leader_nodes["tap_default_invite_checkbox"]["params"]["match"] == {
        "ref": "nodes.wait_default_invite_checkbox.output.0"
    }
    assert "wait_lobby_after_one" in leader_nodes["wait_destination_after_one"]["children"]

    assert member["blackboard"]["phase"]["enum"] == [
        "finish",
        "setup_auto_ready",
        "auto_ready",
    ]
    assert member_nodes["setup_auto_ready"]["children"] == ["prepare_auto_ready_setup"]
    assert member_nodes["configure_auto_ready"]["children"] == [
        "wait_auto_ready_invite",
        "tap_auto_ready_invite",
        "complete_auto_ready_setup",
    ]
    assert member_nodes["handle_auto_ready_confirmation"]["children"] == [
        "wait_auto_ready_confirmation",
        "wait_never_prompt_checkbox",
        "tap_never_prompt_checkbox",
        "tap_auto_ready_confirm",
        "wait_lobby_after_auto_ready_confirm",
    ]
    timed_tap = member_nodes["tap_auto_ready_invite"]["params"]
    assert timed_tap["revalidate"] is False
    assert timed_tap["random_interval"] == [0.0, 0.05]
    never_prompt = member_nodes["wait_never_prompt_checkbox"]["params"]["template"]
    assert never_prompt == "assets/templates/souls/party/never-prompt-checkbox.png"
    assert (project_root / never_prompt).is_file()
    assert member_nodes["tap_never_prompt_checkbox"]["params"]["match"] == {
        "ref": "nodes.wait_never_prompt_checkbox.output.0"
    }
    assert "wait_lobby_after_one" in member_nodes["done_after_one"]["children"]
    assert "save_auto_ready_confirmation" not in member_nodes
    assert "capture_pause" not in member_nodes


def test_reward_material_catalog_templates_exist_and_are_readable() -> None:
    cv2 = pytest.importorskip("cv2")
    np = pytest.importorskip("numpy")
    project_root = Path(__file__).resolve().parents[1]
    catalog_path = project_root / "assets" / "templates" / "rewards" / "catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    assert catalog["schema_version"] == 1
    assert len(catalog["templates"]) == 10
    materials = {material["id"]: material["name"] for material in catalog["templates"]}
    assert materials["orochi_scale_fragment"] == "八岐大蛇鳞片"
    assert materials["material_shikigami"] == "四星青吉鬼"
    assert materials["friendship_points"] == "友情点"
    assert "soul_purple" not in materials
    quantities = {
        material["id"]: material["default_quantity"]
        for material in catalog["templates"]
    }
    assert quantities["material_shikigami"] == 1
    assert quantities["friendship_points"] is None
    for material in catalog["templates"]:
        template_path = catalog_path.parent / material["template"]
        image = cv2.imdecode(np.frombuffer(template_path.read_bytes(), dtype=np.uint8), cv2.IMREAD_COLOR)
        assert image is not None, material["id"]
        assert image.shape[0] >= 80
        assert image.shape[1] >= 80


def test_reward_capture_is_attached_to_run_log_event() -> None:
    payload = _step_event_payload("run-one", None, {
        "step_id": "enqueue_reward",
        "action": "stats.enqueue_reward",
        "status": "succeeded",
        "output": {"accepted": True, "screenshot": "artifacts/run-one/rewards/reward.png"},
    })
    assert payload["screenshot"] == "artifacts/run-one/rewards/reward.png"
