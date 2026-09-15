from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from src.oooonmyoji.runtime.reward_stats import RewardStatsProcessor
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


def test_reward_stats_duplicate_screenshot_is_idempotent(tmp_path: Path) -> None:
    screenshot, catalog = _write_reward_fixture(tmp_path)
    calls: list[int] = []

    def recognize(_image: object) -> list[OcrResult]:
        calls.append(1)
        return []

    processor = RewardStatsProcessor(tmp_path / "artifacts", recognize, material_catalog=catalog)
    request = {
        "instance_id": "mumu-1",
        "run_id": "run-idempotent",
        "category": "souls",
        "battle_index": 1,
        "layer": 1,
        "capture_index": 1,
        "screenshot": str(screenshot),
        "roi": [0, 0, 200, 100],
    }
    assert processor.submit(request)
    assert processor.submit(dict(request))
    assert processor.close(wait_seconds=5)
    records = list((tmp_path / "artifacts" / "reward-stats").rglob("rewards-*.jsonl"))
    assert len(records) == 1
    assert len(records[0].read_text(encoding="utf-8").splitlines()) == 1
    summary = json.loads(records[0].with_name("summary.json").read_text(encoding="utf-8"))
    assert summary["total_screenshots"] == 1
    assert len(calls) == 1


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
