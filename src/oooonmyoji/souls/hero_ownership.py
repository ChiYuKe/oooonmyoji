"""Read the logged-in character's actual heroes; never use illustration unlocks."""
from __future__ import annotations

import datetime
import struct
from collections import Counter
from pathlib import Path

from .acquisition import temporary_root, process_report, _write_json, normalize_record
from .details import client_tables, enrich
from .memory import Reader, Objects

BORROWED_FLAGS = ("_isHelpHero", "_isGuildHelpHero", "_isFiveRecallShareHero",
                  "_xhl_help_hero", "is_pvp_rent_hero", "is_temporary", "is_trial_hero")
DETAIL_FIELDS = {"_level", "_star", "_awake", "skillList", "_equips", "lock"}


def hero_details(records):
    """Keep actual per-copy configuration, excluding borrowed/trial copies."""
    count_heroes(records)  # Validate identity and conflicting duplicates first.
    result, seen = [], set()
    for uid, row in records:
        if uid in seen or any(row.get(flag) for flag in BORROWED_FLAGS): continue
        seen.add(uid)
        # Materials (e.g. hero 12) can be level 60, unlike combat heroes.
        for name, lo, hi in (("_level", 1, 60), ("_star", 1, 6), ("_awake", 0, 1)):
            if type(row.get(name)) is not int or not lo <= row[name] <= hi:
                raise ValueError(f"式神 {row['heroId']} 的 {name} 值 {row.get(name)!r} 不受支持，请重新检测")
        skills, equips = row.get("skillList"), row.get("_equips")
        if not isinstance(skills, list) or any(not isinstance(s, list) or len(s) != 2
                or type(s[0]) is not int or s[0] <= 0 or type(s[1]) is not int or not 1 <= s[1] <= 20 for s in skills):
            raise ValueError("式神技能等级尚未加载，请重新检测")
        if len({s[0] for s in skills}) != len(skills): raise ValueError("式神技能数据重复，请重新检测")
        if not isinstance(equips, list) or len(equips) > 6 or any(not isinstance(s, str) or not s for s in equips) or len(set(equips)) != len(equips):
            raise ValueError("式神御魂装配尚未加载，请重新检测")
        result.append({"id": uid, "heroId": row["heroId"], "level": row["_level"],
                       "stars": row["_star"], "awake": bool(row["_awake"]), "locked": bool(row.get("lock")),
                       "skills": [{"id": s[0], "level": s[1]} for s in sorted(skills)], "equips": equips})
    return result


def read_equipped_souls(objects, fields, equip_module, heroes, progress):
    """Resolve only the equipped UIDs in this same account/scan, never an older cache."""
    ids = {uid for hero in heroes for uid in hero["equips"]}
    if not ids: return [], None
    if "inventory" not in fields or not objects.value(fields.get("inventory_finish", 0)):
        raise ValueError("御魂背包尚未加载，请稍后重新检测")
    r = objects.r
    address = fields["inventory"]; header = r.read(address + 16, 16)
    inventory = r.dictionary(address, ids)
    if set(inventory) != ids: raise ValueError("装配御魂数据不完整，请等待背包加载后重新检测")
    wanted = {"_uid", "_equipId", "_suitId", "_qua", "_strongLevel", "_lock", "_garbage", "_inHero",
              "_base_rindex", "_strengthenedBaseAttrValue", "_rattr", "_single_attr", "_init_dict", "_randomAttrDict"}
    layouts, souls, fingerprints = {}, [], []
    tables = client_tables(objects, equip_module)
    for index, (uid, pointer) in enumerate(inventory.items()):
        r.check()
        if objects.type_name(pointer) != "Equip": raise ValueError("装配御魂结构不受支持")
        kind = r.ptr(pointer + 8)
        if kind not in layouts: layouts[kind] = objects.slots(pointer)
        row = {k[1:]: objects.value(r.ptr(pointer + off)) for k, off in layouts[kind].items() if k in wanted}
        if row.get("uid") != uid or row.get("init_dict") is not None: raise ValueError("装配御魂尚未加载或发生变化，请重新检测")
        soul = enrich(normalize_record(uid, row), row, tables, Path(__file__).resolve().parents[3])
        if type(soul["position"]) is not int or not 1 <= soul["position"] <= 6:
            raise ValueError("无法识别装配御魂位置，请重新检测")
        souls.append(soul)
        fingerprints.append((pointer, {k: off for k, off in layouts[kind].items() if k in wanted}, row))
        if (index + 1) % 100 == 0 or index + 1 == len(ids): progress("正在读取装配御魂", index + 1, len(ids))
    by_id = {s["id"]: s for s in souls}
    for hero in heroes:
        slots = [None] * 6
        for uid in hero["equips"]:
            slot = by_id[uid]["position"] - 1
            if slots[slot] is not None: raise ValueError("装配御魂位置重复，请重新检测")
            slots[slot] = uid
        hero["equips"] = slots
    return souls, (address, header, fingerprints)


def count_heroes(records):
    """UIDs deduplicate across the main bag and storage; failed rows abort a scan."""
    counts, seen = Counter(), {}
    for uid, row in records:
        hero_id = row.get("heroId")
        identity = row.get("heroUid") or row.get("uid")
        if not isinstance(uid, str) or not uid or identity != uid:
            raise ValueError("式神记录不完整，请在式神录加载完成后重新检测")
        if isinstance(hero_id, bool) or not isinstance(hero_id, int) or not 0 < hero_id < 1_000_000_000:
            raise ValueError("式神种类无法识别，请重新检测")
        if uid in seen:
            if seen[uid] != row: raise ValueError("检测期间式神仓库发生变化，请重新检测")
            continue
        seen[uid] = row
        if any(row.get(flag) for flag in BORROWED_FLAGS): continue
        counts[str(hero_id)] += 1
    return dict(counts)


def acquire_heroes(adb, package, instance_id, output, progress):
    with temporary_root(adb, progress):
        progress("正在检查式神录与当前角色")
        report = process_report(adb, package)
        r = Reader(report, adb.executable, adb.serial, adb.check)
        o = Objects(r)
        interpreter = r.ptr(r.symbols["_PyRuntime"] + 40)
        system = r.dictionary(r.ptr(interpreter + 904), {"version"})
        if not o.value(system["version"]).startswith("3.11."):
            raise ValueError("当前客户端不支持仓库检测")
        modules = r.dictionary(r.ptr(interpreter + 888), {"Globals", "com.Equip"})
        globals_ptr = r.ptr(modules["Globals"] + 16)
        glob = r.dictionary(globals_ptr, {"player1", "uiMgr", "currGameScene"})
        player = glob["player1"]
        if o.type_name(player) != "ClientAvatar": raise ValueError("请先在此实例登录角色并打开式神录")
        ensure_hero_screen(o, glob)
        fields = o.fields(player)
        if "heroes" not in fields or "heroes_bag" not in fields:
            raise ValueError("式神仓库尚未加载，请先切到式神录")
        version_fields = {name: o.value(fields[name]) for name in ("heroes_version", "hero_fold_ver") if name in fields}
        containers, records, layouts = [], [], {}
        total = 0
        for name in ("heroes", "heroes_bag"):
            address = fields[name]
            header = r.read(address + 16, 16)
            rows = list(r.dictionary_items(address))
            if len(rows) != struct.unpack_from("<Q", header)[0]: raise ValueError("式神仓库数据不完整，请重新检测")
            total += len(rows)
            containers.append((name, address, header, rows))
        progress("正在读取式神仓库", 0, total)
        completed = 0
        wanted = {"heroId", "heroUid", "uid", *BORROWED_FLAGS, *DETAIL_FIELDS}
        fingerprints = []
        for name, address, header, rows in containers:
            for key, value in rows:
                adb.check()
                uid = o.value(key)
                kind = o.type_name(value)
                if kind == "HeroData":
                    t = r.ptr(value + 8)
                    if t not in layouts: layouts[t] = o.slots(value)
                    layout = layouts[t]
                    # This client uses explicit slots; an unknown shape must not
                    # silently become an empty/partially owned inventory.
                    if not {"heroId", "heroUid", *BORROWED_FLAGS, *DETAIL_FIELDS}.issubset(layout):
                        raise ValueError("当前式神结构不受支持，未覆盖上次检测结果")
                    row = {k: o.value(r.ptr(value + off)) for k, off in layout.items() if k in wanted}
                    fingerprints.append((value, layout, row))
                else:
                    raise ValueError("当前式神仓库结构不受支持，未覆盖上次检测结果")
                records.append((uid, row)); completed += 1
                if completed % 100 == 0 or completed == total:
                    progress("正在读取式神仓库", completed, total)
        counts = count_heroes(records)
        heroes = hero_details(records)
        souls, inventory_header = read_equipped_souls(o, fields, modules.get("com.Equip"), heroes, progress)
        for hero in heroes:
            if not hero["equips"]: hero["equips"] = [None] * 6
        progress("正在校验式神与御魂装配")
        r.blocks.clear()
        for name, address, header, rows in containers:
            if r.read(address + 16, 16) != header: raise ValueError("检测期间式神仓库发生变化，请重新检测")
        current = r.dictionary(globals_ptr, {"player1", "uiMgr", "currGameScene"})
        if current["player1"] != player: raise ValueError("检测期间角色发生变化，请重新检测")
        current_fields = o.fields(player)
        if any(current_fields.get(name) != address for name, address, _, _ in containers):
            raise ValueError("检测期间式神仓库发生变化，请重新检测")
        if any(o.value(current_fields[name]) != value for name, value in version_fields.items()):
            raise ValueError("检测期间式神数据发生变化，请重新检测")
        if inventory_header and (current_fields.get("inventory") != inventory_header[0]
                or r.read(inventory_header[0] + 16, 16) != inventory_header[1]):
            raise ValueError("检测期间御魂背包发生变化，请重新检测")
        for value, layout, original in fingerprints:
            adb.check()
            if any(o.value(r.ptr(value + off)) != original[k] for k, off in layout.items() if k in wanted):
                raise ValueError("检测期间式神等级、技能或装配发生变化，请重新检测")
        if inventory_header:
            for pointer, layout, original in inventory_header[2]:
                adb.check()
                if any(o.value(r.ptr(pointer + off)) != original[k[1:]] for k, off in layout.items()):
                    raise ValueError("检测期间装配御魂发生变化，请重新检测")
        ensure_hero_screen(o, current)
        if int(adb.command("exec-out", "pidof", package).decode().split()[0]) != report["pid"]:
            raise ValueError("检测期间游戏已重启，请重新检测")
        result = {"instanceId": instance_id, "fetchedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  "total": sum(counts.values()), "counts": counts, "source": "memory", "heroes": heroes, "equippedSouls": souls}
    # Only publish a complete scan after the original connection privileges return.
    adb.check()
    destination = Path(output); destination.parent.mkdir(parents=True, exist_ok=True)
    _write_json(destination, result)
    return result


def ensure_hero_screen(objects, globals_fields):
    """Require the loaded GhostPanel in the client's UI stack, not scene names.

    New clients keep YardScene underneath the RTT-based shikigami screen.
    """
    r = objects.r
    ui = objects.fields(globals_fields["uiMgr"])
    active = objects.value(ui["full_screen_ui_list"])
    stack = objects.value(ui["_uiBuffer"])
    open_roots = r.dictionary(ui["openUIRoot"])
    if "GhostPanel" not in active and "GhostPanel" not in open_roots and "GhostPanel" not in stack:
        raise ValueError("请先在游戏中切到「式神录」，等待列表加载完成后再检测")
    panels = r.dictionary(ui["_uiInstMap"], {"GhostPanel"})
    if "GhostPanel" not in panels or objects.type_name(panels["GhostPanel"]) != "GhostPanel":
        raise ValueError("式神录尚未加载完成，请稍后再检测")
    panel = objects.fields(panels["GhostPanel"])
    if not objects.value(panel["is_async_load_complete"]):
        raise ValueError("式神录尚未加载完成，请稍后再检测")
