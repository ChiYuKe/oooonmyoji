from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

from src.oooonmyoji.tools.label_hyakki_names import (
    assign_cluster,
    build_tracks,
    cluster_tracks,
    crop_box,
    crop_histogram,
    crop_thumbnail,
    histogram_correlation,
    iou_xywh,
    load_name_vocabulary,
    merge_proposals,
    named_thumbnail,
    order_class_names,
    read_motion_boxes,
    run_apply,
    run_cluster,
    spatial_filter,
)


def test_iou_xywh_known_overlaps():
    assert iou_xywh((0, 0, 100, 100), (0, 0, 100, 100)) == 1.0
    assert iou_xywh((0, 0, 100, 100), (200, 200, 50, 50)) == 0.0
    assert iou_xywh((0, 0, 100, 100), (50, 0, 100, 100)) == pytest.approx(1 / 3)


def test_spatial_filter_drops_top_ui_and_player_sprite():
    assert not spatial_filter((100, 100, 200, 80))  # fully inside the top UI band
    assert spatial_filter((100, 100, 200, 200))  # extends below it
    assert not spatial_filter((900, 600, 100, 100))  # stationary player region
    assert spatial_filter((1200, 700, 100, 100))
    assert spatial_filter((400, 300, 80, 160))


def test_merge_proposals_confirms_model_boxes_and_appends_unmatched_motion():
    merged = merge_proposals([(100, 100, 80, 160)],
                             [((105, 102, 70, 150), 0.91), ((1500, 600, 100, 200), 0.8)])
    assert merged[0]["box"] == [105, 102, 70, 150]  # model box wins the overlap
    assert merged[0]["source"] == "motion+model"
    assert merged[0]["confidence"] == pytest.approx(0.91)
    assert merged[1]["source"] == "model"


def test_merge_proposals_keeps_motion_only_boxes():
    merged = merge_proposals([(1700, 900, 50, 60)], [((0, 0, 50, 50), 0.9)])
    assert [entry["source"] for entry in merged] == ["model", "motion"]
    assert merged[1]["confidence"] is None
    assert merge_proposals([(10, 10, 30, 40)], []) == [
        {"box": [10, 10, 30, 40], "source": "motion", "confidence": None}]


def test_crop_box_and_thumbnail_letterbox_to_a_square():
    image = np.full((1080, 1920, 3), 200, dtype=np.uint8)
    assert crop_thumbnail(crop_box(image, (400, 300, 100, 200)), size=96).shape == (96, 96, 3)
    assert crop_thumbnail(crop_box(image, (0, 0, 50, 50)), size=64).shape == (64, 64, 3)
    with pytest.raises(ValueError):
        crop_box(image, (2000, 300, 100, 100))


def test_histogram_correlation_separates_palettes():
    red = crop_histogram(np.full((24, 24, 3), (40, 60, 200), dtype=np.uint8))
    blue = crop_histogram(np.full((24, 24, 3), (200, 60, 40), dtype=np.uint8))
    assert histogram_correlation(red, red) == pytest.approx(1.0)
    assert histogram_correlation(red, blue) < 0.5


def _thumb(value: int) -> np.ndarray:
    return np.full((8, 8, 3), value, dtype=np.uint8)


def _fake_similarity(first: np.ndarray, second: np.ndarray) -> float:
    return 1.0 if abs(int(first.mean()) - int(second.mean())) < 10 else 0.0


def test_assign_cluster_joins_similar_and_opens_new_clusters():
    clusters: list[dict] = []
    assert assign_cluster(_thumb(100), clusters, threshold=0.6, similarity_fn=_fake_similarity) == 0
    assert assign_cluster(_thumb(105), clusters, threshold=0.6, similarity_fn=_fake_similarity) == 0
    assert assign_cluster(_thumb(20), clusters, threshold=0.6, similarity_fn=_fake_similarity) == 1
    assert assign_cluster(_thumb(102), clusters, threshold=0.6, similarity_fn=_fake_similarity) == 0
    assert len(clusters) == 2


def test_assign_cluster_default_similarity_is_palette():
    red = crop_histogram(np.full((24, 24, 3), (40, 60, 200), dtype=np.uint8))
    blue = crop_histogram(np.full((24, 24, 3), (200, 60, 40), dtype=np.uint8))
    clusters: list[dict] = []
    assert assign_cluster(red, clusters, threshold=0.8) == 0
    assert assign_cluster(red.copy(), clusters, threshold=0.8) == 0
    assert assign_cluster(blue, clusters, threshold=0.8) == 1


def test_read_motion_boxes_converts_normalized_cxcywh(tmp_path):
    labels = tmp_path / "frame.txt"
    labels.write_text("0 0.5 0.5 0.1 0.2\nbroken line\n", encoding="utf-8")
    assert read_motion_boxes(labels) == [(864, 432, 192, 216)]
    assert read_motion_boxes(tmp_path / "missing.txt") == []


def test_load_name_vocabulary_deduplicates_names(tmp_path):
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps([{"id": 1, "name": "判官"}, {"id": 2, "name": "山兔"},
                                    {"id": 3, "name": "判官"}], ensure_ascii=False), encoding="utf-8")
    assert load_name_vocabulary(manifest) == sorted(["判官", "山兔"])
    assert "减速buff" not in load_name_vocabulary(manifest)


def test_order_class_names_by_frequency_then_name():
    assert order_class_names({"b": 3, "c": 5, "a": 3}) == {"c": 0, "a": 1, "b": 2}
    assert order_class_names({}) == {}


def _write_jpg(path: Path, value: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imencode(".jpg", np.full((60, 80, 3), value, dtype=np.uint8))[1].tofile(str(path))


def _labeling_fixture(tmp_path: Path, *, name: str | None, vocabulary: list[dict]) -> SimpleNamespace:
    candidates = tmp_path / "candidates"
    _write_jpg(candidates / "images" / "train" / "seq_train_000000.jpg", 128)
    _write_jpg(candidates / "images" / "train" / "seq_train_000012.jpg", 90)  # negative frame
    _write_jpg(candidates / "images" / "val" / "seq_val_000000.jpg", 160)
    payload = {
        "status": "proposals_require_names", "candidates": str(candidates),
        "clusters": [{"id": "c01", "gallery": "c01__n2.jpg", "members": ["m0000", "m0002"], "shown_members": 2},
                     {"id": "c02", "gallery": "c02__n1.jpg", "members": ["m0001"], "shown_members": 1}],
        "proposals": [
            {"member": "m0000", "split": "train", "image": "seq_train_000000.jpg", "index": 0,
             "box": [10, 10, 20, 30], "source": "model", "confidence": 0.9, "cluster": "c01", "track": "t0001"},
            {"member": "m0001", "split": "train", "image": "seq_train_000000.jpg", "index": 1,
             "box": [40, 10, 20, 30], "source": "motion", "confidence": None, "cluster": "c02", "track": "t0002"},
            {"member": "m0002", "split": "val", "image": "seq_val_000000.jpg", "index": 0,
             "box": [5, 5, 20, 30], "source": "motion", "confidence": None, "cluster": "c01", "track": "t0003"},
        ],
    }
    labeling = tmp_path / "labeling"
    labeling.mkdir()
    (labeling / "proposals.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    (labeling / "cluster_names.json").write_text(json.dumps(
        {"version": 1, "clusters": [{"id": "c01", "name": name}, {"id": "c02", "name": None}],
         "track_names": {"t0002": "山兔"}, "overrides": {"m0002": ""}}, ensure_ascii=False), encoding="utf-8")
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps(vocabulary, ensure_ascii=False), encoding="utf-8")
    return SimpleNamespace(labeling_dir=labeling, output=tmp_path / "named", vocabulary=manifest)


def _proposal(member: str, split: str, image: str, index: int, box: tuple[int, int, int, int]) -> dict:
    return {"member": member, "split": split, "image": image, "index": index, "box": list(box),
            "source": "motion", "confidence": None, "hist": np.zeros(1024, dtype=np.float32),
            "thumb": _thumb(100)}


def test_build_tracks_chains_walking_boxes():
    proposals = [
        _proposal("m0000", "train", "seq_000000.jpg", 0, (100, 500, 100, 200)),
        _proposal("m0001", "train", "seq_000012.jpg", 12, (140, 500, 100, 200)),
        _proposal("m0002", "train", "seq_000024.jpg", 24, (180, 500, 100, 200)),
    ]
    assert build_tracks(proposals) == 1
    assert {proposal["track"] for proposal in proposals} == {"t0001"}


def test_build_tracks_opens_new_tracks_for_distant_boxes():
    proposals = [
        _proposal("m0000", "train", "seq_000000.jpg", 0, (100, 500, 100, 200)),
        _proposal("m0001", "train", "seq_000012.jpg", 12, (800, 500, 100, 200)),
        _proposal("m0002", "train", "seq_000024.jpg", 24, (820, 500, 100, 200)),
    ]
    assert build_tracks(proposals) == 2
    tracks = {proposal["member"]: proposal["track"] for proposal in proposals}
    assert tracks["m0000"] != tracks["m0001"]
    assert tracks["m0001"] == tracks["m0002"]


def test_build_tracks_matches_one_to_one_when_crossing():
    proposals = [
        _proposal("m0000", "train", "seq_000000.jpg", 0, (100, 500, 100, 200)),
        _proposal("m0001", "train", "seq_000000.jpg", 1, (400, 500, 100, 200)),
        _proposal("m0002", "train", "seq_000012.jpg", 12, (400, 500, 100, 200)),
        _proposal("m0003", "train", "seq_000012.jpg", 13, (100, 500, 100, 200)),
    ]
    build_tracks(proposals)
    tracks = {proposal["member"]: proposal["track"] for proposal in proposals}
    assert tracks["m0000"] == tracks["m0003"]  # stayed near x=100
    assert tracks["m0001"] == tracks["m0002"]  # stayed near x=400


def test_build_tracks_does_not_link_disjoint_neighbours():
    # Crossing sprites: a disjoint nearby box must open a new track even when
    # the center distance is small, otherwise identities swap on crossings.
    proposals = [
        _proposal("m0000", "train", "seq_000000.jpg", 0, (100, 500, 100, 200)),
        _proposal("m0001", "train", "seq_000012.jpg", 12, (210, 500, 100, 200)),
    ]
    assert build_tracks(proposals) == 2


def test_cluster_tracks_merges_same_palette_and_separates_other():
    red = crop_histogram(np.full((24, 24, 3), (40, 60, 200), dtype=np.uint8))
    blue = crop_histogram(np.full((24, 24, 3), (200, 60, 40), dtype=np.uint8))
    proposals = [
        {**_proposal("m0000", "train", "seq_000000.jpg", 0, (0, 0, 20, 30)), "hist": red},
        {**_proposal("m0001", "train", "seq_000012.jpg", 12, (10, 0, 20, 30)), "hist": red},
        {**_proposal("m0002", "train", "seq_000000.jpg", 1, (500, 0, 20, 30)), "hist": blue},
    ]
    assert build_tracks(proposals) == 2  # t0001: m0000+m0001, t0002: m0002
    clusters = cluster_tracks(proposals, threshold=0.8, similarity_fn=histogram_correlation,
                              descriptor_key="hist")
    assert len(clusters) == 2
    by_member = {proposal["member"]: proposal["cluster"] for proposal in proposals}
    assert by_member["m0000"] == by_member["m0001"] != by_member["m0002"]


def test_cluster_reruns_without_detection(tmp_path):
    fixture = _labeling_fixture(tmp_path, name=None, vocabulary=[{"name": "判官"}])
    run_cluster(SimpleNamespace(labeling_dir=fixture.labeling_dir, cluster_threshold=0.8,
                                similarity="palette", thumb_size=64, against=None, auto_threshold=0.72,
                                mask_step=3))
    payload = json.loads((fixture.labeling_dir / "proposals.json").read_text(encoding="utf-8"))
    # Flat gray palettes merge into one cluster; each frame's disjoint boxes stay their own tracks.
    assert len(payload["clusters"]) == 1
    assert payload["clusters"][0]["tracks"] == ["t0001", "t0002", "t0003"]
    assert payload["clusters"][0]["boxes"] == 3
    assert all(proposal["cluster"] == "c01" for proposal in payload["proposals"])
    assert all("hist" not in proposal and "thumb" not in proposal for proposal in payload["proposals"])
    skeleton = json.loads((fixture.labeling_dir / "cluster_names.json").read_text(encoding="utf-8"))
    assert skeleton["clusters"][0]["tracks"] == 3 and skeleton["clusters"][0]["boxes"] == 3
    assert (fixture.labeling_dir / "clusters" / "c01__t3__n3.jpg").is_file()


def test_apply_writes_named_dataset(tmp_path):
    run_apply(_labeling_fixture(tmp_path, name="判官", vocabulary=[{"name": "判官"}, {"name": "山兔"}]))
    named = tmp_path / "named"
    assert sorted(path.name for path in (named / "images" / "train").iterdir()) == [
        "seq_train_000000.jpg", "seq_train_000012.jpg"]
    # m0000 falls back to its cluster name; m0001's track name beats its unnamed cluster.
    assert (named / "labels" / "train" / "seq_train_000000.txt").read_text(encoding="utf-8") == \
        "0 0.010417 0.023148 0.010417 0.027778\n1 0.026042 0.023148 0.010417 0.027778"
    assert (named / "labels" / "train" / "seq_train_000012.txt").read_text(encoding="utf-8") == ""
    # m0002 is override-excluded, so the val label file is empty despite the named cluster.
    assert (named / "labels" / "val" / "seq_val_000000.txt").read_text(encoding="utf-8") == ""
    dataset = (named / "dataset.yaml").read_text(encoding="utf-8")
    assert "0: 判官" in dataset and "1: 山兔" in dataset
    report = json.loads((named / "named_report.json").read_text(encoding="utf-8"))
    assert report["class_counts"] == {"判官": 1, "山兔": 1}
    assert report["unnamed_clusters"] == ["c02"]
    assert report["overrides_applied"] == 1
    assert report["track_names_applied"] == 1
    assert [item["reason"] for item in report["excluded_members"]] == ["override_excluded"]
    assert (named / "train_named_review.jpg").is_file()
    assert not (named / "val_named_review.jpg").exists()  # every val box was excluded


def test_apply_rejects_names_outside_vocabulary(tmp_path):
    with pytest.raises(SystemExit, match="vocabulary"):
        run_apply(_labeling_fixture(tmp_path, name="判官x", vocabulary=[{"name": "判官"}]))


def test_apply_track_exclusion_wins_over_cluster_name(tmp_path):
    fixture = _labeling_fixture(tmp_path, name="判官", vocabulary=[{"name": "判官"}, {"name": "山兔"}])
    naming_path = fixture.labeling_dir / "cluster_names.json"
    naming = json.loads(naming_path.read_text(encoding="utf-8"))
    naming["track_names"]["t0001"] = ""  # t0001 carries m0000, whose cluster is named
    naming_path.write_text(json.dumps(naming, ensure_ascii=False), encoding="utf-8")
    run_apply(fixture)
    named = tmp_path / "named"
    assert (named / "labels" / "train" / "seq_train_000000.txt").read_text(encoding="utf-8") == \
        "0 0.026042 0.023148 0.010417 0.027778"  # only m0001's 山兔 track-name box remains
    report = json.loads((named / "named_report.json").read_text(encoding="utf-8"))
    assert [item["reason"] for item in report["excluded_members"]] == ["track_excluded", "override_excluded"]
    assert report["class_counts"] == {"山兔": 1}


def test_named_thumbnail_draws_boxes_and_labels():
    image = np.full((30, 60, 3), 100, dtype=np.uint8)
    thumb = named_thumbnail(image, [([5, 5, 10, 20], "判官")], width=30)
    assert thumb.shape == (15, 30, 3)
    assert thumb.dtype == np.uint8
