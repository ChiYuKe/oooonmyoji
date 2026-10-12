"""Compare all confidently visible frames with model snapshots; never convert pixels to gauges."""
import csv
import json
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out/fourteen-match"
AUDIT = OUT / "full-frame"
rows = json.loads((AUDIT / "frames.json").read_text(encoding="utf-8"))
snapshots = json.loads((OUT / "gauges-1.json").read_text(encoding="utf-8"))
starts = [s for s in snapshots if s["eventType"] == "turn-started"]
initial = json.loads((ROOT / "tests/fixtures/duel-14pm-lineup.json").read_text(encoding="utf-8"))
names = {391: "寻香行", 247: "海坊主", 306: "虫师", 396: "修罗鬼童丸", 600: "市加美",
         356: "千姬", 331: "御怨般若", 362: "蝉冰雪女", 392: "季", 395: "流光追月神"}
actions = []
for row in rows:
    active = row["active"]
    if not active or not 417 <= row["frame"] <= 2972:
        continue
    if not actions or actions[-1]["heroId"] != active["heroId"]:
        actions.append({"ordinal": len(actions)+1, "firstObservedFrame": row["frame"], "heroId": active["heroId"],
                        "actor": active["name"], "lastObservedFrame": row["frame"]})
    else:
        actions[-1]["lastObservedFrame"] = row["frame"]

for index, action in enumerate(actions):
    model = starts[index] if index < len(starts) else None
    unit = next((u for u in model["units"] if u["unitId"] == model["unitId"]), None) if model else None
    action["modelActor"] = names.get(unit["heroId"]) if unit else None
    action["actorMatches"] = bool(unit and unit["heroId"] == action["heroId"])
    action["modelActionId"] = model["actionId"] if model else None
first_divergence = next((a for a in actions if not a["actorMatches"]), None)

comparisons = []
ordinal = 0
for row in rows:
    while ordinal+1 < len(actions) and actions[ordinal+1]["firstObservedFrame"] <= row["frame"]:
        ordinal += 1
    comparison = {"frame": row["frame"], "status": "not-comparable", "pairChecks": 0, "inversions": []}
    if not row["active"] or not 417 <= row["frame"] <= 2972:
        comparison["reason"] = "no-confident-current-actor or outside-battle"
        comparisons.append(comparison)
        continue
    action = actions[ordinal]
    comparison.update({"nativeOrdinal": action["ordinal"], "nativeActor": action["actor"], "modelActor": action["modelActor"]})
    if first_divergence and action["ordinal"] >= first_divergence["ordinal"]:
        comparison["status"] = "sequence-diverged"
        comparisons.append(comparison)
        continue
    # Damage and passive callbacks can move bars during a skill. Accept the ordering of ANY actual
    # snapshot in this model action, rather than assigning a game animation frame to a guessed event.
    possible = [s for s in snapshots if s["actionId"] == action["modelActionId"]]
    queue = [q for q in row["queue"] if q["score"] >= .80]
    for left_index, left in enumerate(queue):
        for right in queue[left_index+1:]:
            if right["y"] - left["y"] < 28:
                continue  # avoid assigning order to overlapping portraits
            signs = []
            for snapshot in possible:
                a = next((u for u in snapshot["units"] if u["heroId"] == left["heroId"] and not u["unitId"].startswith("summon:")), None)
                b = next((u for u in snapshot["units"] if u["heroId"] == right["heroId"] and not u["unitId"].startswith("summon:")), None)
                if a and b and a["hp"] > 0 and b["hp"] > 0:
                    signs.append(b["gauge"]-a["gauge"])
            if not signs:
                continue
            comparison["pairChecks"] += 1
            if max(signs) < -2:
                comparison["inversions"].append({"upper": left, "lower": right,
                    "modelDifferenceRange": [round(min(signs), 4), round(max(signs), 4)]})
    comparison["status"] = "order-inversion-candidate" if comparison["inversions"] else (
        "visible-pair-order-compatible" if comparison["pairChecks"] else "insufficient-visible-pairs")
    comparisons.append(comparison)

(AUDIT / "actions.json").write_text(json.dumps(actions, ensure_ascii=False, indent=2), encoding="utf-8")
(AUDIT / "comparison.json").write_text(json.dumps(comparisons, ensure_ascii=False, indent=2), encoding="utf-8")
with (AUDIT / "comparison.csv").open("w", encoding="utf-8-sig", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(["frame", "nativeOrdinal", "nativeActor", "modelActor", "status", "pairChecks", "inversions"])
    for row in comparisons:
        writer.writerow([row["frame"], row.get("nativeOrdinal"), row.get("nativeActor"), row.get("modelActor"),
                         row["status"], row["pairChecks"], json.dumps(row["inversions"], ensure_ascii=False)])

counts = {status: sum(r["status"] == status for r in comparisons) for status in set(r["status"] for r in comparisons)}
summary = {"framesComparedOrExplicitlyMarked": len(comparisons), "observedNormalActorSequenceLength": len(actions),
           "firstActorSequenceDivergence": first_divergence, "classificationCounts": counts,
           "pairChecks": sum(r["pairChecks"] for r in comparisons),
           "firstOrderInversionCandidate": next((r for r in comparisons if r["inversions"]), None),
           "limitations": "Visible pairs only; missing portraits remain unknown; pixel percentages and animation clocks are not calibrated."}
(AUDIT / "comparison-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

# Review each new actor and each long unidentified interval, including frame labels and raw imagery.
segments = json.loads((AUDIT / "segments.json").read_text(encoding="utf-8"))
review_frames = sorted(set([a["firstObservedFrame"] for a in actions] +
    [(s["start"]+s["end"])//2 for s in segments if s["heroId"] is None and s["end"]-s["start"] >= 10]))
for page in range((len(review_frames)+11)//12):
    subset = review_frames[page*12:(page+1)*12]
    sheet = Image.new("RGB", (1200, 960), "#181818")
    draw = ImageDraw.Draw(sheet)
    for index, frame in enumerate(subset):
        path = Path(rows[frame-1]["file"])
        with Image.open(path) as im:
            # Both current actor and a wide field view: an unidentified bar animation must stay unidentified.
            thumb = im.resize((400, 225))
            x, y = index%3*400, index//3*240
            sheet.paste(thumb, (x, y+15))
            draw.text((x+4, y), f"frame {frame}", fill="white")
    sheet.save(AUDIT / f"review-{page}.jpg", quality=95)
print(json.dumps(summary, ensure_ascii=False), flush=True)
