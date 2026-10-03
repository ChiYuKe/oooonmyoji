"""Snapshot the official Shikigami skills and icons for the offline atlas."""
from __future__ import annotations

import concurrent.futures
import datetime
import hashlib
import html
import json
import pathlib
import re
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[3]
API = "https://g37simulator.webapp.163.com/get_hero_skill?heroid={id}&awake={awake}&level=0&star=2"
ICON = "https://yys.res.netease.com/pc/zt/20161108171335/data/skill/{icon}.png?v11"


def plain(value: str) -> str:
    return html.unescape(re.sub(r"</?[a-zA-Z][^>]*>", "", re.sub(r"<br\s*/?>", "\n", value, flags=re.I))).strip()


def normalize(skill_id: int, raw: dict) -> dict:
    icon = str(raw.get("icon", ""))
    if not re.fullmatch(r"[\w-]+", icon, flags=re.ASCII):
        raise ValueError(f"Invalid skill icon: {icon}")
    return {"id": skill_id, "name": plain(raw["name"]), "icon": icon,
            "description": plain(raw.get("normaldesc", "")),
            "cost": raw.get("consume_val", 0), "type": raw.get("skill_type", 0),
            "upgrades": [plain(line) for line in raw.get("desc", []) if line],
            "extraSkills": [normalize(item["skill_id"], item) for item in raw.get("extra_skills", [])]}


def merge_profile(base: dict, awake: dict | None = None) -> dict:
    merged = {key: value for key, value in base.items() if str(key).isdigit() and isinstance(value, dict)}
    for key, value in (awake or {}).items():
        if str(key).isdigit() and isinstance(value, dict):
            merged[key] = {**merged.get(key, {}), **value}
    return {"skills": [normalize(int(key), merged[key]) for key in sorted(merged, key=int)],
            "awakening": plain((awake or {}).get("add") or "")}


def request_bytes(url: str) -> bytes:
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://yys.163.com/shishen/"})
            with urllib.request.urlopen(request, timeout=20) as response:
                return response.read()
        except OSError:
            if attempt == 2:
                raise
    raise RuntimeError("Request failed")


def main() -> None:
    catalog_text = (ROOT / "desktop/src/shared/soul-catalog-data.ts").read_text(encoding="utf-8")
    heroes = json.loads(catalog_text[catalog_text.index("{"):catalog_text.rindex("}") + 1])["heroes"]
    day = datetime.date.today().isoformat()
    cache = ROOT / "artifacts/hero-skills" / day
    cache.mkdir(parents=True, exist_ok=True)

    def fetch(hero: dict) -> tuple[int, dict]:
        def data(awake: int) -> dict:
            target = cache / f"{hero['id']}-{awake}.json"
            raw = json.loads(target.read_bytes() if target.exists() else request_bytes(API.format(id=hero["id"], awake=awake)))
            if raw.get("success") is not True or not isinstance(raw.get("data"), dict):
                raise ValueError(f"Invalid response for {hero['name']}")
            target.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
            return raw["data"]
        try:
            return hero["id"], merge_profile(data(0), data(1) if hero["awake"] else None)
        except (OSError, ValueError, KeyError) as error:
            return hero["id"], {"skills": [], "awakening": "", "error": str(error)}

    profiles = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for index, (hero_id, profile) in enumerate(pool.map(fetch, heroes), 1):
            profiles[hero_id] = profile
            if index % 25 == 0:
                print(f"Skills {index}/{len(heroes)}", flush=True)
    errors = {key: row["error"] for key, row in profiles.items() if "error" in row}
    if errors:
        raise RuntimeError(json.dumps(errors, ensure_ascii=False))

    icons = set()
    def collect(skills: list) -> None:
        for skill in skills:
            icons.add(skill["icon"])
            collect(skill["extraSkills"])
    for row in profiles.values():
        collect(row["skills"])
    directory = ROOT / "assets/skill-icons"
    directory.mkdir(parents=True, exist_ok=True)
    def fetch_icon(icon: str) -> dict:
        target = directory / f"{icon}.png"
        try:
            data = target.read_bytes() if target.exists() else request_bytes(ICON.format(icon=icon))
            if not data.startswith(b"\x89PNG\r\n\x1a\n"):
                raise ValueError(f"Invalid PNG: {icon}")
            target.write_bytes(data)
            return {"file": target.name, "url": ICON.format(icon=icon), "sha256": hashlib.sha256(data).hexdigest()}
        except (OSError, ValueError) as error:
            return {"icon": icon, "url": ICON.format(icon=icon), "error": str(error)}
    manifest = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for index, entry in enumerate(pool.map(fetch_icon, sorted(icons)), 1):
            manifest.append(entry)
            if index % 100 == 0:
                print(f"Icons {index}/{len(icons)}", flush=True)
    (directory / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    result = {"updated": day, "source": "https://yys.163.com/shishen/", "heroes": profiles}
    output = ROOT / "desktop/src/shared/hero-skills-data.ts"
    output.write_text("// Generated from the official NetEase Shikigami directory.\nimport type { HeroSkillsCatalog } from './hero-skills';\nexport const heroSkillsCatalog: HeroSkillsCatalog = " + json.dumps(result, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")
    print(json.dumps({"heroes": len(profiles), "icons": len(icons), "missingIcons": [row for row in manifest if "error" in row], "empty": [hero["name"] for hero in heroes if not profiles[hero["id"]]["skills"]]}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
