"""Refresh the local shikigami catalog, portraits, skills, and new base panels.

Run from the project root with:
    python -m src.oooonmyoji.tools.update_shikigami_data

All remote reads use the public NetEase catalog, simulator, and resource CDN.
"""
from __future__ import annotations

import datetime
import json
import pathlib
import re

from src.oooonmyoji.tools import fetch_hero_icons, fetch_hero_skills, fetch_soul_catalog

ROOT = pathlib.Path(__file__).resolve().parents[3]
CATALOG_PATH = ROOT / "desktop/src/shared/soul-catalog-data.ts"
BASE_PATH = ROOT / "desktop/src/shared/hero-base-data.generated.ts"
SKILLS_PATH = ROOT / "desktop/src/shared/hero-skills-data.ts"
HERO_ICON_DIR = ROOT / "assets/hero-icons"
SKILL_ICON_DIR = ROOT / "assets/skill-icons"


def read_ts_json(path: pathlib.Path, marker: str | None = None) -> tuple[str, dict]:
    text = path.read_text(encoding="utf-8")
    start = text.index(marker) + len(marker) if marker else text.index("{")
    end = text.rindex(";") if marker else text.rindex("}") + 1
    return text, json.loads(text[start:end])


def add_new_base_panels(heroes: list[dict]) -> list[int]:
    text = BASE_PATH.read_text(encoding="utf-8")
    declaration = "export const heroBaseById: Readonly<Record<number, HeroBaseEntry>> = "
    object_start = text.index("{", text.index(declaration))
    object_end = text.index("\n};\n\n/** 客户端 heroId", object_start)
    records = json.loads(text[object_start:object_end + 1])

    added: list[dict] = []
    for hero in heroes:
        hero_id = str(hero["id"])
        if hero_id in records:
            continue
        base = hero.get("base")
        if not base or any(not isinstance(base.get(key), (int, float)) for key in
                           ("hp", "attack", "defense", "speed", "crit", "critDamage", "hit", "resist")):
            raise ValueError(f"New shikigami {hero['name']} ({hero_id}) has no complete official base panel")
        added.append({
            "id": hero["id"],
            "name": hero["name"],
            "rarity": hero.get("rarity"),
            "pinyin": hero.get("pinyin", ""),
            "awake": bool(hero.get("awake")),
            "awakeStatus": "awake1" if hero.get("awake") else "awake0-complete",
            "kind": "shikigami",
            "base": base,
        })

    if not added:
        return []

    strict_start = text.index("export const heroBaseAliasStrict:")
    strict_match = re.search(r"(export const heroBaseAliasStrict:[^{]+\{\n)(.*?)(\n\};)", text[strict_start:], re.S)
    if not strict_match:
        raise ValueError("Could not locate the strict hero ID map")
    pairs = {int(key): int(value) for key, value in re.findall(r"(\d+):\s*(\d+)", strict_match.group(2))}
    for hero in added:
        hero_id = int(hero["id"])
        if hero_id in pairs and pairs[hero_id] != hero_id:
            raise ValueError(f"New shikigami ID {hero_id} conflicts with an existing battle ID alias")
        pairs[hero_id] = hero_id

    records.update({str(hero["id"]): {
        "name": hero["name"], "rarity": hero["rarity"], "pinyin": hero["pinyin"],
        "awake": hero["awake"], "awakeStatus": hero["awakeStatus"], "kind": hero["kind"],
        "base": hero["base"],
    } for hero in added})
    rendered_records = json.dumps(records, ensure_ascii=False, indent=2)
    text = text[:object_start] + rendered_records + text[object_end + 2:]

    strict_start = text.index("export const heroBaseAliasStrict:")
    strict_match = re.search(r"(export const heroBaseAliasStrict:[^{]+\{\n)(.*?)(\n\};)", text[strict_start:], re.S)
    assert strict_match is not None
    strict_body_start = strict_start + strict_match.start(2)
    strict_body_end = strict_start + strict_match.end(2)
    ordered = sorted(pairs.items())
    rows = ["  " + ", ".join(f"{key}: {value}" for key, value in ordered[index:index + 8]) + ","
            for index in range(0, len(ordered), 8)]
    text = text[:strict_body_start] + "\n".join(rows) + text[strict_body_end:]
    text = re.sub(r'generatedFrom: "[^"]+",',
                  f'generatedFrom: "{datetime.date.today().isoformat()}",', text, count=1)
    count_match = re.search(r"heroCount: (\d+),", text)
    if not count_match:
        raise ValueError("Could not update the hero panel count")
    text = text[:count_match.start(1)] + str(len(records)) + text[count_match.end(1):]
    BASE_PATH.write_text(text, encoding="utf-8")
    return [hero["id"] for hero in added]


def validate_new_assets(new_ids: list[int], catalog: dict) -> None:
    if not new_ids:
        return
    heroes = {hero["id"]: hero for hero in catalog["heroes"]}
    portraits = {row.get("id"): row for row in json.loads((HERO_ICON_DIR / "manifest.json").read_text(encoding="utf-8"))}
    skills_text = SKILLS_PATH.read_text(encoding="utf-8")
    marker = "export const heroSkillsCatalog: HeroSkillsCatalog = "
    skill_data = json.loads(skills_text[skills_text.index(marker) + len(marker):skills_text.rindex(";")])
    skill_manifest = json.loads((SKILL_ICON_DIR / "manifest.json").read_text(encoding="utf-8"))
    skill_files = {row.get("file") for row in skill_manifest if row.get("file")}

    def icon_ids(skills: list[dict]) -> list[str]:
        result: list[str] = []
        for skill in skills:
            result.append(str(skill["icon"]))
            result.extend(icon_ids(skill.get("extraSkills", [])))
        return result

    for hero_id in new_ids:
        hero = heroes[hero_id]
        portrait = portraits.get(hero_id, {})
        if not portrait.get("file") or not (HERO_ICON_DIR / portrait["file"]).is_file():
            raise ValueError(f"Official portrait missing for {hero['name']} ({hero_id})")
        profile = skill_data["heroes"].get(str(hero_id))
        if not profile or not profile.get("skills"):
            raise ValueError(f"Official skill data missing for {hero['name']} ({hero_id})")
        icons = icon_ids(profile["skills"])
        if any(f"{icon}.png" not in skill_files for icon in icons):
            raise ValueError(f"At least one official skill icon is missing for {hero['name']} ({hero_id})")


def main() -> None:
    old_text, old_catalog = read_ts_json(CATALOG_PATH)
    old_ids = {hero["id"] for hero in old_catalog["heroes"]}

    print("Fetching the latest public NetEase shikigami catalog…", flush=True)
    fetch_soul_catalog.main()
    _, catalog = read_ts_json(CATALOG_PATH)
    new_ids = {hero["id"] for hero in catalog["heroes"]}
    if not old_ids.issubset(new_ids):
        CATALOG_PATH.write_text(old_text, encoding="utf-8")
        missing = sorted(old_ids - new_ids)
        raise ValueError(f"Official catalog omitted existing IDs {missing}; kept the previous catalog")

    old_heroes = {hero["id"]: hero for hero in old_catalog["heroes"]}
    regressed = [hero["id"] for hero in catalog["heroes"]
                 if hero["id"] in old_heroes and old_heroes[hero["id"]].get("base") and not hero.get("base")]
    if regressed:
        CATALOG_PATH.write_text(old_text, encoding="utf-8")
        raise ValueError(f"Official panel data was missing for existing IDs {regressed}; kept the previous catalog")

    added = [hero for hero in catalog["heroes"] if hero["id"] not in old_ids]
    try:
        added_ids = add_new_base_panels(added)
    except Exception:
        CATALOG_PATH.write_text(old_text, encoding="utf-8")
        raise

    print("Refreshing official portraits and skill data…", flush=True)
    fetch_hero_icons.main()
    fetch_hero_skills.main()
    validate_new_assets(added_ids, catalog)
    print(json.dumps({"updated": catalog.get("updated"), "catalog_count": len(catalog["heroes"]),
                      "new_shikigami": [hero["name"] for hero in added]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
