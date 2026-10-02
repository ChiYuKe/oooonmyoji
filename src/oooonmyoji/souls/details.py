"""Resolve soul names and exact attributes from the running client's config tables."""
from collections import OrderedDict

LABELS = {
    "attackAdditionVal": "攻击", "defenseAdditionVal": "防御", "maxHpAdditionVal": "生命",
    "speedAdditionVal": "速度", "attackAdditionRate": "攻击加成", "defenseAdditionRate": "防御加成",
    "maxHpAdditionRate": "生命加成", "critRateAdditionVal": "暴击", "critPowerAdditionVal": "暴击伤害",
    "debuffEnhance": "效果命中", "debuffResist": "效果抵抗", "speedAdditionRate": "速度加成",
}
PERCENT = {name for name in LABELS if name.endswith("Rate")} | {
    "critRateAdditionVal", "critPowerAdditionVal", "debuffEnhance", "debuffResist"}


def attribute(name, value, rolls=1):
    return {"name": name, "label": LABELS.get(name, name), "value": value,
            "percent": name in PERCENT, "rolls": rolls}


def native_cached_rows(objects, address):
    """Inspect already decoded bindict rows; never run client deserialization code."""
    r = objects.r
    state = r.ptr(address + 16)
    if not state: return objects.value(address)
    found, seen = {}, set()
    for start in (r.ptr(state + 88), r.ptr(state + 96)):
        node = start
        for _ in range(10000):
            r.check()
            if not node or node in seen: break
            seen.add(node)
            try: next_node = r.ptr(node)
            except ValueError: break
            try:
                obj = r.ptr(node + 24)
                if objects.type_name(obj) == "taggeddict.taggeddict":
                    row = objects.value(obj)
                    if isinstance(row.get("id"), int) and "attr_list" in row:
                        found[row["id"]] = row
            except (ValueError, UnicodeError, KeyError): pass
            node = next_node
    return found


def client_tables(objects, equip_module):
    r = objects.r
    equip = r.module_dictionary(equip_module)
    result = {}
    for key, name in (("DATA_EQUIP_INIT", "init"), ("EQUIP_SUIT", "suits"),
                      ("DATA_EQUIP_ATTR", "random"), ("DATA_EQUIP_RANDOM_ATTR", "single")):
        fields = objects.fields(equip[key])
        module = r.module_dictionary(fields["_dataModule"])
        source = module["data"]
        if objects.type_name(source) == "BindictProxy":
            source = objects.fields(source)["bindict_data"]
        result[name] = native_cached_rows(objects, source) if objects.type_name(source) == "bindict.bindict" else objects.value(source)
    return result


def enrich(soul, record, tables):
    init = tables.get("init", {}).get(soul["itemId"], {})
    suit = tables.get("suits", {}).get(soul["suitId"], {})
    soul["name"] = suit.get("suit_n") or f"套装 {soul['suitId']}"
    soul["iconKey"] = suit.get("icon")
    soul["iconUrl"] = None
    soul["mainAttribute"] = None
    base = init.get("base_attr", [])
    index = soul["baseAttributeIndex"]
    if isinstance(index, int) and 0 <= index < len(base) and soul["baseValue"] is not None:
        soul["mainAttribute"] = attribute(base[index][0], soul["baseValue"])
    config = tables.get("random", {}).get(init.get("rand_id"), {})
    coefficients = {row[0]: row[1] for row in config.get("attr_list", [])}
    accumulated = OrderedDict()
    for roll in soul["attributeRolls"]:
        name = roll["name"]
        if name not in accumulated: accumulated[name] = [0., 0]
        accumulated[name][0] += roll["factor"]
        accumulated[name][1] += 1
    cached = record.get("randomAttrDict")
    soul["subAttributes"] = []
    for name, (factor, count) in accumulated.items():
        value = cached.get(name) if isinstance(cached, dict) else None
        if value is None and name in coefficients: value = factor * coefficients[name]
        if value is not None: soul["subAttributes"].append(attribute(name, value, count))
    soul["attributesComplete"] = len(soul["subAttributes"]) == len(accumulated) and soul["mainAttribute"] is not None
    soul["intrinsicAttributes"] = []
    single = record.get("single_attr")
    if isinstance(single, int):
        soul["intrinsicAttributes"] = [attribute(row[0], row[1]) for row in tables.get("single", {}).get(single, {}).get("attrs", [])]
    soul["setEffects"] = [text for group in suit.get("suitAttrDesc", []) for text in group if isinstance(text, str)]
    return soul
