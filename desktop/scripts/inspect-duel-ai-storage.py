"""Inspect live AI data holders, including modules loaded after the registry cache."""
import json
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from yystool.resolve import Resolver
from yystool.pywalk import read_dict_entries, decode_unicode
from yystool.pyfields import fields, module_dict, type_name, scalar
r = Resolver(verbose=False)
live = r.find_modules(r'skill_ai|skillai')
sys_module = r.module_globals('battleengine.ai.tools.SkillAIRunner').get('sys')
if sys_module:
    modules = module_dict(r.mem, r.rt, sys_module).get('modules')
    for key, value in read_dict_entries(r.mem, r.rt, modules, hard_limit=30000) or []:
        name = decode_unicode(r.mem, key)
        if name and ('skill_ai' in name.lower() or 'skillai' in name.lower()):
            live[name] = value
report = {'pid': r.pid, 'modules': {}}
for name, address in live.items():
    attributes = module_dict(r.mem, r.rt, address) if type_name(r.mem, r.rt, address) == 'module' else r.module_globals(name)
    report['modules'][name] = {}
    for key, value in attributes.items():
        if key.startswith('__') or type_name(r.mem, r.rt, value) in ('function', 'type'):
            continue
        entry = {'type': type_name(r.mem, r.rt, value), 'value': scalar(r.mem, r.rt, value)}
        if key in ('data', 'SKILL_AI_DATA'):
            entry['fields'] = {field: {'type': type_name(r.mem, r.rt, val), 'value': scalar(r.mem, r.rt, val)}
                               for field, val in fields(r.mem, r.rt, value).items()}
        report['modules'][name][key] = entry
output = Path(__file__).resolve().parent.parent / 'out/duel-fidelity/ai-storage.json'
output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
