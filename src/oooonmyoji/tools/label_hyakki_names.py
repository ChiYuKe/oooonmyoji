"""Name-level (per-shikigami) labeling for Hyakki reference frames.

The activity screen never shows a walking shikigami's name, so names cannot be
read from pixels. Proposals are therefore grouped into look-alike clusters and
a human names each cluster once:

- ``propose``: motion pseudo-label boxes + optional detector boxes -> clusters,
  gallery sheets and a ``cluster_names.json`` skeleton for human review.
- ``cluster``: re-cluster an existing ``proposals.json`` with a different
  threshold/similarity without re-running detection.
- ``apply``: reviewed ``cluster_names.json`` -> multi-class YOLO dataset under
  ``datasets/hyakki/named`` (class ids ordered by box frequency).

Member keys are stable ``m####`` ids stored in ``proposals.json``; galleries
caption crops with those ids because OpenCV cannot draw Chinese text. Clustering
defaults to hue-saturation histogram correlation because template matching
breaks down across walk-cycle poses (calibrated on consecutive-frame overlap
pairs: histogram p5 0.72 vs cross-pair p95 0.81, template p50 0.53 vs 0.45).
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from collections.abc import Callable, Sequence
from pathlib import Path

import cv2
import numpy as np

from ..devices.coordinates import CoordinateMapper
from ..devices.protocol import DeviceFrame
from ..vision.yolo import YoloDetector

REFERENCE_WIDTH, REFERENCE_HEIGHT = 1920, 1080
# Mirrors prepare_hyakki_candidates: keep pre-game UI and the stationary player
# sprite out of the proposals regardless of where a box came from.
TOP_UI_HEIGHT = 180
PLAYER_REGION_X = (790, 1110)
PLAYER_REGION_Y = 520
SPLITS = ("train", "val")


def read_image(path: Path) -> np.ndarray | None:
    data = np.fromfile(path, dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR) if data.size else None


def iou_xywh(first: Sequence[float], second: Sequence[float]) -> float:
    ax, ay, aw, ah = first
    bx, by, bw, bh = second
    x1, y1 = max(ax, bx), max(ay, by)
    x2, y2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def spatial_filter(box: Sequence[float]) -> bool:
    """Reject boxes that only cover top UI or the stationary player sprite."""

    x, y, _, height = box
    if y + height <= TOP_UI_HEIGHT:
        return False
    if PLAYER_REGION_X[0] < x < PLAYER_REGION_X[1] and y > PLAYER_REGION_Y:
        return False
    return True


def merge_proposals(motion_boxes: list[tuple[int, int, int, int]], model_entries: list[tuple[Sequence[float], float]],
                    *, iou_threshold: float = 0.5) -> list[dict]:
    """Union both box sources; overlapping motion boxes confirm the model box."""

    entries = [{"box": [int(round(value)) for value in box], "source": "model", "confidence": float(confidence)}
               for box, confidence in model_entries]
    for box in motion_boxes:
        best_index, best_score = None, iou_threshold
        for index, entry in enumerate(entries):
            if entry["source"] == "motion":
                continue
            score = iou_xywh(box, entry["box"])
            if score >= best_score:
                best_index, best_score = index, score
        if best_index is not None:
            entries[best_index]["source"] = "motion+model"
        else:
            entries.append({"box": [int(value) for value in box], "source": "motion", "confidence": None})
    return entries


def crop_box(image: np.ndarray, box: Sequence[float], *, margin: float = 0.1) -> np.ndarray:
    """Margin-padded crop clamped to the frame."""

    x, y, width, height = (float(value) for value in box)
    pad_x, pad_y = width * margin, height * margin
    x0, y0 = max(0, int(x - pad_x)), max(0, int(y - pad_y))
    x1 = min(image.shape[1], int(x + width + pad_x) + 1)
    y1 = min(image.shape[0], int(y + height + pad_y) + 1)
    crop = image[y0:y1, x0:x1]
    if crop.size == 0:
        raise ValueError(f"empty crop for box {list(box)}")
    return crop


def crop_thumbnail(crop: np.ndarray, *, size: int = 128) -> np.ndarray:
    """Aspect-preserving letterbox onto a square thumbnail for galleries."""

    scale = size / max(crop.shape[:2])
    resized = cv2.resize(crop, (max(1, round(crop.shape[1] * scale)), max(1, round(crop.shape[0] * scale))),
                         interpolation=cv2.INTER_AREA)
    canvas = np.full((size, size, 3), 114, dtype=np.uint8)
    offset_y, offset_x = (size - resized.shape[0]) // 2, (size - resized.shape[1]) // 2
    canvas[offset_y:offset_y + resized.shape[0], offset_x:offset_x + resized.shape[1]] = resized
    return canvas


def crop_histogram(crop: np.ndarray, *, bins: int = 16, grid: int = 2, mask: np.ndarray | None = None) -> np.ndarray:
    """L1-normalized hue-saturation histograms over a grid×grid spatial layout.

    The spatial grid keeps the descriptor pose-invariant enough for walk cycles
    while separating look-alike palettes that a single global histogram merges.
    An optional foreground mask restricts the histogram to moving pixels.
    """

    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    height, width = hsv.shape[:2]
    parts = []
    for row in range(grid):
        for col in range(grid):
            cell = hsv[row * height // grid:(row + 1) * height // grid,
                       col * width // grid:(col + 1) * width // grid]
            cell_mask = None if mask is None else mask[row * height // grid:(row + 1) * height // grid,
                                                       col * width // grid:(col + 1) * width // grid]
            hist = cv2.calcHist([cell], [0, 1], cell_mask, [bins, bins], [0, 180, 0, 256]).flatten()
            total = hist.sum()
            parts.append(hist / total if total > 0 else hist)
    return np.concatenate(parts)


def motion_mask(image: np.ndarray, previous: np.ndarray, *, threshold: int = 40) -> np.ndarray:
    """Full-frame binary mask of pixels changed since the previous sampled frame.

    A high threshold with erosion keeps the sprite core: a permissive mask also
    covers falling petals and ambient shifts, which lets track-mean histograms
    converge onto the shared background and collapse the clustering.
    """

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    old = cv2.cvtColor(previous, cv2.COLOR_BGR2GRAY)
    _, mask = cv2.threshold(cv2.absdiff(gray, old), threshold, 255, cv2.THRESH_BINARY)
    return cv2.erode(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)), iterations=1)


def foreground_histogram(crop: np.ndarray, mask: np.ndarray | None, *, min_fraction: float = 0.04) -> np.ndarray:
    """Histogram over moving pixels; falls back to the whole crop when the mask is empty."""

    if mask is not None and mask.shape == crop.shape[:2] and float((mask > 0).mean()) >= min_fraction:
        return crop_histogram(crop, mask=mask)
    return crop_histogram(crop)


def _descriptor_for(image: np.ndarray, mask: np.ndarray | None, box: Sequence[float], *, thumb_size: int) -> tuple[np.ndarray, np.ndarray]:
    """(thumbnail, foreground histogram) for one proposal box."""

    crop = crop_box(image, box)
    mask_crop = None
    if mask is not None:
        inner = crop_box(mask, box)
        mask_crop = inner if inner.shape == crop.shape[:2] else None
    return crop_thumbnail(crop, size=thumb_size), foreground_histogram(crop, mask_crop)


def _previous_image_name(images: list[str], image: str, *, step: int = 1) -> str | None:
    """The sampled frame ``step`` slots before this one within its split."""

    try:
        index = images.index(image)
    except ValueError:
        return None
    return images[index - step] if index >= step else None


def histogram_correlation(first: np.ndarray, second: np.ndarray, *, bins: int = 16, grid: int = 2) -> float:
    """Mean per-cell correlation of grid-concatenated histograms."""

    block = bins * bins
    scores = []
    for index in range(grid * grid):
        cell_a = first[index * block:(index + 1) * block].astype(np.float32)
        cell_b = second[index * block:(index + 1) * block].astype(np.float32)
        score = cv2.compareHist(cell_a, cell_b, cv2.HISTCMP_CORREL)
        if np.isfinite(score):
            scores.append(score)
    return float(np.mean(scores)) if scores else 0.0


def thumbnail_similarity(first: np.ndarray, second: np.ndarray) -> float:
    try:
        score = cv2.matchTemplate(first, second, cv2.TM_CCOEFF_NORMED)[0, 0]
    except cv2.error:
        return 0.0
    return float(score) if np.isfinite(score) else 0.0


def assign_cluster(descriptor: np.ndarray, clusters: list[dict], *, threshold: float,
                   similarity_fn: Callable[[np.ndarray, np.ndarray], float] = histogram_correlation,
                   max_exemplars: int = 5) -> int:
    """Greedy clustering: join the best cluster above threshold or open a new one."""

    best_index, best_score = None, threshold
    for index, cluster in enumerate(clusters):
        score = max(similarity_fn(descriptor, exemplar) for exemplar in cluster["exemplars"])
        if score >= best_score:
            best_index, best_score = index, score
    if best_index is None:
        clusters.append({"exemplars": [descriptor], "members": []})
        return len(clusters) - 1
    if len(clusters[best_index]["exemplars"]) < max_exemplars:
        clusters[best_index]["exemplars"].append(descriptor)
    return best_index


def read_motion_boxes(path: Path) -> list[tuple[int, int, int, int]]:
    """Read a YOLO txt (normalized cxcywh) back into reference-pixel xywh boxes."""

    if not path.is_file():
        return []
    boxes = []
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) != 5:
            continue
        _, cx, cy, width, height = (float(value) for value in parts)
        boxes.append((int(round(cx * REFERENCE_WIDTH - width * REFERENCE_WIDTH / 2)),
                      int(round(cy * REFERENCE_HEIGHT - height * REFERENCE_HEIGHT / 2)),
                      int(round(width * REFERENCE_WIDTH)), int(round(height * REFERENCE_HEIGHT))))
    return boxes


def order_class_names(counts: dict[str, int]) -> dict[str, int]:
    """Deterministic class ids: by box count descending, then by name."""

    return {name: index for index, (name, _) in
            enumerate(sorted(counts.items(), key=lambda item: (-item[1], item[0])))}


# Non-shikigami priorities the gameplay buffer also offers (buffs, probability-up, UI buttons).
EXTRA_NAME_VOCABULARY = (
    "减速buff", "加速buff", "冻结buff", "概率UP", "好友概率UP", "豆子获取", "删除",
)


def load_name_vocabulary(manifest_path: Path) -> list[str]:
    """Shikigami names from the hero-icons manifest, used to catch typos.

    Buffer-only entries live in :data:`EXTRA_NAME_VOCABULARY` and are added by the
    labeling command, so this stays a pure manifest reader.
    """

    entries = json.loads(manifest_path.read_text(encoding="utf-8"))
    return sorted({str(entry["name"]) for entry in entries})


def write_gallery(path: Path, member_ids: list[str], thumbs: list[np.ndarray], *, size: int = 128, cols: int = 8,
                  caption: int = 20, max_members: int = 40) -> int:
    """Contact sheet of cluster members captioned with their member ids."""

    shown = list(zip(member_ids[:max_members], thumbs[:max_members]))
    if not shown:
        return 0
    cells = []
    for member_id, thumb in shown:
        cell = np.vstack([thumb, np.full((caption, size, 3), 30, dtype=np.uint8)])
        cv2.putText(cell, member_id, (2, caption - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1, cv2.LINE_AA)
        cells.append(cell)
    filler = np.full((size + caption, size, 3), 60, dtype=np.uint8)
    while len(cells) % 8:
        cells.append(filler)
    rows = [np.hstack(cells[index:index + cols]) for index in range(0, len(cells), cols)]
    cv2.imencode(".jpg", np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 90])[1].tofile(str(path))
    return len(shown)


def _frame_index(image: str) -> int:
    """Sampling index embedded in candidate stems like ``阴阳师_7_000660``."""

    return int(Path(image).stem.rsplit("_", 1)[1])


def build_tracks(proposals: list[dict], *, link_iou: float = 0.15, height_ratio: float = 1.6,
                 max_gap: int = 24) -> int:
    """Chain boxes across consecutive sampled frames into walking identities.

    One-to-one greedy matching by IoU only: a distance fallback would steal the
    neighbour when two sprites cross or a motion box briefly merges them, and a
    poisoned identity is far costlier than a fragmented one. Identity survives
    one missed sampled frame (``max_gap`` in source-frame steps). Sets
    ``proposal["track"]`` to a stable ``t####`` id and returns the track count.
    """

    by_split: dict[str, list[dict]] = {}
    for proposal in proposals:
        by_split.setdefault(proposal["split"], []).append(proposal)
    assigned: dict[str, int] = {}
    counter = 0
    for split in sorted(by_split):
        items = sorted(by_split[split], key=lambda item: (_frame_index(item["image"]), item["index"]))
        open_tracks: list[dict] = []
        for proposal in items:
            frame = _frame_index(proposal["image"])
            open_tracks = [track for track in open_tracks if frame - track["frame"] <= max_gap]
            height = proposal["box"][3]
            # Boxes inside one frame are distinct objects: only tracks from
            # strictly earlier frames may absorb this box.
            comparable = [track for track in open_tracks if track["frame"] < frame
                          and 1 / height_ratio < height / track["box"][3] < height_ratio]
            best, best_score = None, link_iou
            for track in comparable:
                score = iou_xywh(proposal["box"], track["box"])
                if score >= best_score:
                    best, best_score = track, score
            if best is None:
                counter += 1
                best = {"id": counter, "frame": frame, "box": list(proposal["box"]),
                        "members": [proposal["member"]]}
                open_tracks.append(best)
            else:
                best["frame"] = frame
                best["box"] = list(proposal["box"])
                best["members"].append(proposal["member"])
            assigned[proposal["member"]] = best["id"]
    for proposal in proposals:
        proposal["track"] = f"t{assigned[proposal['member']]:04d}"
    return counter


def cluster_tracks(proposals: list[dict], *, threshold: float, similarity_fn, descriptor_key: str) -> list[dict]:
    """Cluster walking tracks (not single boxes) by their mean appearance."""

    tracks: dict[str, list[dict]] = {}
    for proposal in proposals:
        tracks.setdefault(proposal["track"], []).append(proposal)
    clusters: list[dict] = []
    for track_id in sorted(tracks, key=lambda key: min(item["member"] for item in tracks[key])):
        members = tracks[track_id]
        descriptor = np.mean([np.asarray(item[descriptor_key], dtype=np.float32) for item in members], axis=0)
        index = assign_cluster(descriptor, clusters, threshold=threshold, similarity_fn=similarity_fn)
        clusters[index].setdefault("tracks", []).append(track_id)
        cluster_id = f"c{index + 1:02d}"
        for member in members:
            member["cluster"] = cluster_id
    return clusters


def write_cluster_artifacts(proposals: list[dict], clusters: list[dict], output: Path, *, thumb_size: int,
                            threshold: float) -> tuple[list[dict], dict]:
    """Track-row galleries + cluster records + a fresh review skeleton; ids c01.."""

    for stale in (output / "clusters").glob("*.jpg"):
        stale.unlink()
    thumbs_by_member = {proposal["member"]: proposal["thumb"] for proposal in proposals}
    members_by_track: dict[str, list[str]] = {}
    for proposal in proposals:
        members_by_track.setdefault(proposal["track"], []).append(proposal["member"])
    cluster_records = []
    for number, cluster in enumerate(clusters, start=1):
        cluster_id = f"c{number:02d}"
        cell_ids: list[str] = []
        cell_thumbs: list[np.ndarray] = []
        for track_id in cluster["tracks"]:
            members = members_by_track[track_id]
            middle = len(members) // 2
            picks = list(dict.fromkeys([members[0], members[middle], members[-1]]))[:3]
            cell_ids += [track_id] * len(picks)
            cell_thumbs += [thumbs_by_member[member] for member in picks]
        # One sheet holds 8×15 cells; bigger clusters continue in __p2, __p3...
        chunk = 120
        parts = max(1, -(-len(cell_ids) // chunk))
        for part in range(parts):
            suffix = f"__p{part + 1}" if parts > 1 else ""
            gallery = output / "clusters" / f"{cluster_id}__t{len(cluster['tracks'])}__n{len(cell_ids)}{suffix}.jpg"
            write_gallery(gallery, cell_ids[part * chunk:(part + 1) * chunk],
                          cell_thumbs[part * chunk:(part + 1) * chunk], size=thumb_size)
        first = f"{cluster_id}__t{len(cluster['tracks'])}__n{len(cell_ids)}" + ("__p1" if parts > 1 else "") + ".jpg"
        cluster_records.append({"id": cluster_id, "gallery": first, "tracks": list(cluster["tracks"]),
                                "boxes": sum(len(members_by_track[track]) for track in cluster["tracks"])})
    for proposal in proposals:
        proposal.pop("thumb", None)
    skeleton = {"version": 1, "status": "names_require_human_review",
                "instructions": "拼图按轨迹（t####）分行展示最多三个时刻的裁剪。整簇是同一位式神时直接填 clusters[].name；"
                                "混簇则在 track_names 里按轨迹命名（如 {\"t0083\": \"酒吞童子\"}），优先级高于簇名。"
                                "名字必须是 assets/hero-icons/manifest.json 词表里的式神全名；无法确认的保持 null，apply 时跳过。"
                                "overrides 可按成员微调：{\"m0042\": \"山兔\"} 改名，{\"m0042\": \"\"} 剔除该框，优先级最高。",
                "vocabulary": "assets/hero-icons/manifest.json", "cluster_threshold": threshold,
                "clusters": [{"id": record["id"], "tracks": len(record["tracks"]), "boxes": record["boxes"],
                              "gallery": record["gallery"], "proposed_name": None, "confidence": None, "name": None}
                             for record in cluster_records],
                "track_names": {}, "overrides": {}}
    return cluster_records, skeleton


def _collect_proposals(args: argparse.Namespace) -> tuple[list[dict], dict[str, int], object]:
    """Motion + optional detector proposals with thumbnails and histograms."""

    candidates: Path = args.candidates
    detector = None
    mapper = None
    if not args.no_model:
        if args.model.is_file():
            detector = YoloDetector(args.model)
            mapper = CoordinateMapper(REFERENCE_WIDTH, REFERENCE_HEIGHT, REFERENCE_WIDTH, REFERENCE_HEIGHT)
        else:
            print(f"warning: model not found, using motion boxes only: {args.model}")

    proposals: list[dict] = []
    frames = {split: 0 for split in SPLITS}
    previous_by_split: dict[str, np.ndarray] = {}
    for split in SPLITS:
        for image_path in sorted((candidates / "images" / split).glob("*.jpg")):
            image = read_image(image_path)
            if image is None or image.shape[:2] != (REFERENCE_HEIGHT, REFERENCE_WIDTH):
                continue
            frames[split] += 1
            previous = previous_by_split.get(split)
            mask = motion_mask(image, previous) if previous is not None else None
            previous_by_split[split] = image
            motion = [box for box in read_motion_boxes(candidates / "labels" / split / f"{image_path.stem}.txt")
                      if spatial_filter(box)]
            model_entries: list[tuple[Sequence[float], float]] = []
            if detector is not None:
                frame = DeviceFrame(width=REFERENCE_WIDTH, height=REFERENCE_HEIGHT, pixels=image, format="bgr")
                for item in detector.detect(frame, mapper, confidence=args.confidence, device=args.device):
                    x1, y1, x2, y2 = item.box
                    box = (int(round(x1)), int(round(y1)), int(round(x2 - x1)), int(round(y2 - y1)))
                    if spatial_filter(box):
                        model_entries.append((box, item.confidence))
            for index, entry in enumerate(merge_proposals(motion, model_entries, iou_threshold=args.merge_iou)):
                thumb, hist = _descriptor_for(image, mask, entry["box"], thumb_size=args.thumb_size)
                proposals.append({"member": None, "split": split, "image": image_path.name, "index": index,
                                  "box": entry["box"], "source": entry["source"], "confidence": entry["confidence"],
                                  "thumb": thumb, "hist": hist})
        print(f"propose: {split} done ({frames[split]} frames)", flush=True)

    proposals.sort(key=lambda item: (item["split"], item["image"], item["index"]))
    for order, proposal in enumerate(proposals):
        proposal["member"] = f"m{order:04d}"
    return proposals, frames, detector


def run_propose(args: argparse.Namespace) -> None:
    candidates: Path = args.candidates
    output: Path = args.output
    if not candidates.is_dir():
        raise SystemExit(f"candidates dataset not found: {candidates}")
    (output / "clusters").mkdir(parents=True, exist_ok=True)

    proposals, frames, detector = _collect_proposals(args)
    track_count = build_tracks(proposals)
    similarity_fn = thumbnail_similarity if args.similarity == "tmpl" else histogram_correlation
    descriptor_key = "thumb" if args.similarity == "tmpl" else "hist"
    clusters = cluster_tracks(proposals, threshold=args.cluster_threshold, similarity_fn=similarity_fn,
                              descriptor_key=descriptor_key)
    cluster_records, skeleton = write_cluster_artifacts(proposals, clusters, output, thumb_size=args.thumb_size,
                                                        threshold=args.cluster_threshold)
    for proposal in proposals:
        proposal.pop("hist", None)  # recomputed from candidates images by cluster/apply helpers
    payload = {"status": "proposals_require_names", "candidates": str(candidates.resolve()),
               "model": str(args.model) if detector is not None else None, "confidence": args.confidence,
               "merge_iou": args.merge_iou, "cluster_threshold": args.cluster_threshold,
               "similarity": args.similarity, "frames": frames, "tracks": track_count,
               "reference": f"{REFERENCE_WIDTH}x{REFERENCE_HEIGHT}", "proposal_count": len(proposals),
               "clusters": cluster_records, "proposals": proposals}
    (output / "proposals.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    (output / "cluster_names.json").write_text(json.dumps(skeleton, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"frames": frames, "proposals": len(proposals), "tracks": track_count,
                      "clusters": len(clusters), "output": str(output.resolve())}, ensure_ascii=False, indent=2))


def _reference_exemplars(against: Path) -> list[tuple[str, np.ndarray]]:
    """Mean histograms per named track of a previous labeling round.

    Names resolve with the same precedence as apply: member override >
    track name > cluster name, so track-level human labels are included.
    """

    payload = json.loads((against / "proposals.json").read_text(encoding="utf-8"))
    naming = json.loads((against / "cluster_names.json").read_text(encoding="utf-8"))
    names_by_cluster = {cluster["id"]: cluster.get("name") for cluster in naming["clusters"]}
    track_names: dict[str, str] = dict(naming.get("track_names", {}))
    overrides: dict[str, str] = dict(naming.get("overrides", {}))
    candidates = Path(payload["candidates"])
    ordered = {split: sorted((str(path.name) for path in (candidates / "images" / split).glob("*.jpg")),
                             key=_frame_index) for split in SPLITS}
    by_track: dict[str, dict] = {}
    for proposal in payload["proposals"]:
        name = overrides.get(proposal["member"]) or track_names.get(proposal["track"]) \
            or names_by_cluster.get(proposal.get("cluster"))
        if not name:
            continue
        entry = by_track.setdefault(proposal["track"], {"name": name, "items": []})
        entry["items"].append(proposal)
    exemplars: list[tuple[str, np.ndarray]] = []
    current_name, image, mask = None, None, None
    for track_id in sorted(by_track):
        entry = by_track[track_id]
        hists = []
        for proposal in entry["items"]:
            if proposal["image"] != current_name:
                current_name = proposal["image"]
                split = proposal["split"]
                image = read_image(candidates / "images" / split / current_name)
                if image is None:
                    raise SystemExit(f"unable to read candidates image: {current_name}")
                previous_name = _previous_image_name(ordered[split], current_name)
                previous = read_image(candidates / "images" / split / previous_name) if previous_name else None
                mask = motion_mask(image, previous) if previous is not None else None
            hists.append(_descriptor_for(image, mask, proposal["box"], thumb_size=96)[1])
        exemplars.append((entry["name"], np.mean(hists, axis=0)))
    return exemplars


def run_cluster(args: argparse.Namespace) -> None:
    labeling: Path = args.labeling_dir
    payload = json.loads((labeling / "proposals.json").read_text(encoding="utf-8"))
    candidates = Path(payload["candidates"])
    (labeling / "clusters").mkdir(parents=True, exist_ok=True)
    thumb_size = args.thumb_size
    # Recompute descriptors exactly like propose: mask against the previous
    # sampled frame of the same split (all sampled frames, incl. negatives).
    ordered = {split: sorted((str(path.name) for path in (candidates / "images" / split).glob("*.jpg")),
                             key=_frame_index) for split in SPLITS}
    current_name, image, mask = None, None, None
    for proposal in payload["proposals"]:
        if proposal["image"] != current_name:
            current_name = proposal["image"]
            image = read_image(candidates / "images" / proposal["split"] / current_name)
            if image is None:
                raise SystemExit(f"unable to read candidates image: {current_name}")
            previous_name = _previous_image_name(ordered[proposal["split"]], current_name, step=args.mask_step)
            previous = read_image(candidates / "images" / proposal["split"] / previous_name) if previous_name else None
            mask = motion_mask(image, previous) if previous is not None else None
        proposal["thumb"], proposal["hist"] = _descriptor_for(image, mask, proposal["box"], thumb_size=thumb_size)
    similarity_fn = thumbnail_similarity if args.similarity == "tmpl" else histogram_correlation
    descriptor_key = "thumb" if args.similarity == "tmpl" else "hist"
    track_count = build_tracks(payload["proposals"])
    clusters = cluster_tracks(payload["proposals"], threshold=args.cluster_threshold, similarity_fn=similarity_fn,
                              descriptor_key=descriptor_key)
    auto_named = 0
    if args.against is not None:
        references = _reference_exemplars(args.against)
        for index, cluster in enumerate(clusters):
            cluster_id = f"c{index + 1:02d}"
            descriptor = np.mean([np.asarray(item["hist"], dtype=np.float32)
                                  for item in payload["proposals"] if item["cluster"] == cluster_id], axis=0)
            best_name, best_score = None, args.auto_threshold
            for name, exemplar in references:
                score = histogram_correlation(descriptor, exemplar)
                if score >= best_score:
                    best_name, best_score = name, score
            if best_name:
                cluster["auto_name"] = best_name
                auto_named += 1
    cluster_records, skeleton = write_cluster_artifacts(payload["proposals"], clusters, labeling,
                                                        thumb_size=thumb_size, threshold=args.cluster_threshold)
    if args.against is not None:
        for record, cluster in zip(cluster_records, clusters):
            if cluster.get("auto_name"):
                entry = next(c for c in skeleton["clusters"] if c["id"] == record["id"])
                entry["proposed_name"] = cluster["auto_name"]
                entry["confidence"] = "auto"
                entry["name"] = cluster["auto_name"]
    for proposal in payload["proposals"]:
        proposal.pop("hist", None)
    payload["clusters"] = cluster_records
    payload["cluster_threshold"] = args.cluster_threshold
    payload["similarity"] = args.similarity
    payload["tracks"] = track_count
    (labeling / "proposals.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    (labeling / "cluster_names.json").write_text(json.dumps(skeleton, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"proposals": len(payload["proposals"]), "tracks": track_count, "clusters": len(clusters),
                      "labeling_dir": str(labeling.resolve())}, ensure_ascii=False, indent=2))


def _load_font(size: int = 18):
    """CJK-capable font for review sheets; None falls back to ASCII labels."""

    try:
        from PIL import ImageFont
    except ImportError:
        return None
    for name in ("msyh.ttc", "simhei.ttf", "simsun.ttc"):
        try:
            return ImageFont.truetype(f"C:/Windows/Fonts/{name}", size)
        except OSError:
            continue
    return None


def named_thumbnail(image: np.ndarray, entries: list[tuple[Sequence[float], str]], *, width: int = 480) -> np.ndarray:
    """Downscaled frame with boxes (OpenCV) and Chinese name labels (Pillow)."""

    scale = width / image.shape[1]
    thumb = cv2.resize(image, (width, max(1, round(image.shape[0] * scale))), interpolation=cv2.INTER_AREA)
    labels = []
    for box, name in entries:
        x, y, w, h = (max(0, round(value * scale)) for value in (*box[:2], box[2], box[3]))
        cv2.rectangle(thumb, (x, y), (x + w, y + h), (0, 255, 0), 1)
        labels.append((x, max(0, y - 16), name))
    font = _load_font()
    if font is not None:
        from PIL import Image, ImageDraw

        pil = Image.fromarray(cv2.cvtColor(thumb, cv2.COLOR_BGR2RGB))
        draw = ImageDraw.Draw(pil)
        for x, y, name in labels:
            draw.text((x, y), name, font=font, fill=(255, 255, 0))
        thumb = cv2.cvtColor(np.asarray(pil), cv2.COLOR_RGB2BGR)
    else:
        for x, y, name in labels:
            ascii_label = name.encode("ascii", "ignore").decode() or "box"
            cv2.putText(thumb, ascii_label, (x, y + 14), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 255), 1, cv2.LINE_AA)
    return thumb


def run_apply(args: argparse.Namespace) -> None:
    labeling: Path = args.labeling_dir
    payload = json.loads((labeling / "proposals.json").read_text(encoding="utf-8"))
    naming = json.loads((labeling / "cluster_names.json").read_text(encoding="utf-8"))
    candidates = Path(payload["candidates"])
    vocabulary = set(load_name_vocabulary(args.vocabulary)) | set(EXTRA_NAME_VOCABULARY)

    names_by_cluster = {cluster["id"]: cluster.get("name") for cluster in naming["clusters"]}
    track_names: dict[str, str] = dict(naming.get("track_names", {}))
    overrides: dict[str, str] = dict(naming.get("overrides", {}))
    used = [name for name in names_by_cluster.values() if isinstance(name, str) and name and name != "删除"]
    used += [name for name in track_names.values() if isinstance(name, str) and name]
    used += [name for name in overrides.values() if isinstance(name, str) and name]
    invalid = sorted({name for name in used if name not in vocabulary})
    if invalid:
        raise SystemExit(f"names not in shikigami vocabulary (check spelling): {invalid}")

    known_tracks = {proposal["track"] for proposal in payload["proposals"]}
    unknown_track_names = sorted(set(track_names) - known_tracks)
    unnamed = sorted(cluster_id for cluster_id, name in names_by_cluster.items()
                     if not isinstance(name, str) or not name or name == "删除")
    final: list[dict] = []
    excluded: list[dict] = []
    overrides_applied = track_names_applied = 0
    for proposal in payload["proposals"]:
        member = proposal["member"]
        if member in overrides:
            overrides_applied += 1
            name = overrides[member]
            if not name:
                excluded.append({"member": member, "reason": "override_excluded"})
                continue
        else:
            name = track_names.get(proposal.get("track"))
            if name is not None:  # explicit track entry; "" excludes the whole track
                if not name:
                    excluded.append({"member": member, "reason": "track_excluded"})
                    continue
                track_names_applied += 1
            else:
                name = names_by_cluster.get(proposal.get("cluster"))
            if not isinstance(name, str) or not name:
                excluded.append({"member": member, "reason": "cluster_unnamed"})
                continue
            if name == "删除":
                excluded.append({"member": member, "reason": "cluster_deleted"})
                continue
        final.append({**proposal, "name": name})

    counts = Counter(item["name"] for item in final)
    class_ids = order_class_names(counts)
    output: Path = args.output
    by_frame: dict[tuple[str, str], list[dict]] = {}
    for item in final:
        by_frame.setdefault((item["split"], item["image"]), []).append(item)

    report_frames = {}
    for split in SPLITS:
        images_out = output / "images" / split
        labels_out = output / "labels" / split
        images_out.mkdir(parents=True, exist_ok=True)
        labels_out.mkdir(parents=True, exist_ok=True)
        frames_written = frames_with_boxes = 0
        for image_path in sorted((candidates / "images" / split).glob("*.jpg")):
            (images_out / image_path.name).write_bytes(image_path.read_bytes())
            entries = by_frame.get((split, image_path.name), [])
            lines = []
            for item in entries:
                x, y, width, height = item["box"]
                cx, cy = (x + width / 2) / REFERENCE_WIDTH, (y + height / 2) / REFERENCE_HEIGHT
                lines.append(f"{class_ids[item['name']]} {cx:.6f} {cy:.6f} {width / REFERENCE_WIDTH:.6f} "
                             f"{height / REFERENCE_HEIGHT:.6f}")
            (labels_out / f"{image_path.stem}.txt").write_text("\n".join(lines), encoding="utf-8")
            frames_written += 1
            frames_with_boxes += bool(lines)
        report_frames[split] = {"frames": frames_written, "frames_with_boxes": frames_with_boxes}

    names_lines = "\n".join(f"  {index}: {name}" for name, index in
                            sorted(class_ids.items(), key=lambda item: item[1]))
    (output / "dataset.yaml").write_text(
        f"path: {output.resolve().as_posix()}\ntrain: images/train\nval: images/val\nnames:\n{names_lines}\n",
        encoding="utf-8")

    for split in SPLITS:
        thumbs = []
        image_dir = candidates / "images" / split
        framed = sorted({image for (frame_split, image) in by_frame if frame_split == split})
        step = max(1, len(framed) // 12)
        for image_name in framed[::step][:12]:
            image = read_image(image_dir / image_name)
            if image is None:
                continue
            entries = [(item["box"], item["name"]) for item in by_frame[(split, image_name)]]
            thumbs.append(named_thumbnail(image, entries))
        if thumbs:
            while len(thumbs) % 3:
                thumbs.append(np.full_like(thumbs[0], 60))
            rows = [np.hstack(thumbs[index:index + 3]) for index in range(0, len(thumbs), 3)]
            cv2.imencode(".jpg", np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 90])[1].tofile(
                str(output / f"{split}_named_review.jpg"))

    report = {"status": "names_require_final_review", "dataset": str(output.resolve()),
              "class_ids": {str(index): name for name, index in class_ids.items()},
              "class_counts": dict(counts), "boxes": len(final), "frames": report_frames,
              "clusters": len(names_by_cluster), "unnamed_clusters": unnamed,
              "excluded_members": excluded, "overrides_applied": overrides_applied,
              "track_names_applied": track_names_applied, "unknown_track_names": unknown_track_names,
              "warning": "Names were assigned per appearance cluster or track; spot-check the "
                         "*_named_review.jpg sheets before training."}
    (output / "named_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)

    propose = commands.add_parser("propose", help="build box proposals, cluster them and emit review galleries")
    propose.add_argument("--candidates", type=Path, default=Path("datasets/hyakki/candidates"))
    propose.add_argument("--model", type=Path,
                         default=Path("artifacts/hyakki-training/hyakki-experimental/weights/best.pt"))
    propose.add_argument("--output", type=Path, default=Path("datasets/hyakki/name_labeling"))
    propose.add_argument("--confidence", type=float, default=0.4, help="detector confidence for model proposals")
    propose.add_argument("--merge-iou", type=float, default=0.5)
    propose.add_argument("--cluster-threshold", type=float, default=0.85,
                         help="palette correlation joins at >= this value")
    propose.add_argument("--similarity", choices=("palette", "tmpl"), default="palette")
    propose.add_argument("--thumb-size", type=int, default=128)
    propose.add_argument("--device", default="cpu")
    propose.add_argument("--no-model", action="store_true", help="skip detector proposals, motion boxes only")
    propose.set_defaults(func=run_propose)

    cluster = commands.add_parser("cluster", help="re-cluster an existing proposals.json without re-detecting")
    cluster.add_argument("--labeling-dir", type=Path, default=Path("datasets/hyakki/name_labeling"))
    cluster.add_argument("--cluster-threshold", type=float, default=0.85)
    cluster.add_argument("--similarity", choices=("palette", "tmpl"), default="palette")
    cluster.add_argument("--thumb-size", type=int, default=128)
    cluster.add_argument("--against", type=Path, default=None,
                         help="previous labeling dir; auto-name clusters by matching its confirmed species")
    cluster.add_argument("--auto-threshold", type=float, default=0.72)
    cluster.add_argument("--mask-step", type=int, default=3,
                         help="sampled frames between mask pair; keep the ~0.4s displacement of stride-12 masks")
    cluster.set_defaults(func=run_cluster)

    apply = commands.add_parser("apply", help="write the multi-class dataset from reviewed cluster names")
    apply.add_argument("--labeling-dir", type=Path, default=Path("datasets/hyakki/name_labeling"))
    apply.add_argument("--output", type=Path, default=Path("datasets/hyakki/named"))
    apply.add_argument("--vocabulary", type=Path, default=Path("assets/hero-icons/manifest.json"))
    apply.set_defaults(func=run_apply)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()


