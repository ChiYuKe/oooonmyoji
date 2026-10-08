"""Read current battle classes using the supplied, calibrated client tools.

No injection or UI interaction. All captured outputs remain in this repository.
"""
import contextlib
import json
from pathlib import Path
import sys

SOURCE = Path(sys.argv[1])
OUTPUT = Path(__file__).resolve().parent.parent / 'out' / 'duel-fidelity' / 'runtime'
sys.path.insert(0, str(SOURCE))
sys.path.insert(0, str(SOURCE / 'tools'))
from yystool.resolve import Resolver
from yystool.pywalk import decode_unicode, read_dict_entries, region_of
from yystool.pyfields import OFF_TP_DICT, type_name
import disasm4

resolver = Resolver(verbose=False)
dis = disasm4.Dis(resolver.pid)
# Relocate the original image's opcode arrays by its recorded ELF load bias.
maps = (SOURCE / 'dump' / 'maps.txt').read_text().splitlines()
mapping = next(line for line in maps if 'libclient.so' in line and int(line.split()[2], 16) == 0)
old_base = int(mapping.split('-')[0], 16)
delta = dis.rt.base - old_base
dis.CACHES = list(dis.mem.read(disasm4.CACHES_A + delta, 256))
dis.DEOPT = list(dis.mem.read(disasm4.DEOPT_A + delta, 256))
OUTPUT.mkdir(parents=True, exist_ok=True)
manifest = {'pid': resolver.pid, 'oldBase': hex(old_base), 'currentBase': hex(dis.rt.base), 'classes': {}}
for module in ['battleengine.TurnMgrComp', 'battleengine.SkillAi', 'battleengine.SkillAi_config', 'cdata.SKILL_AI_DATA']:
    globals_ = resolver.module_globals(module)
    print(module, len(globals_), flush=True)
    if module.endswith('SkillAi_config'):
        from yystool.pyfields import scalar
        manifest['aiConfig'] = {name: scalar(resolver.mem, resolver.rt, value) for name, value in globals_.items() if not name.startswith('__')}
    for name, value in globals_.items():
        if type_name(resolver.mem, resolver.rt, value) != 'type' or name.startswith('__'):
            continue
        methods = []
        dictionary = resolver.mem.u64(value + OFF_TP_DICT)
        for key, func in read_dict_entries(resolver.mem, resolver.rt, dictionary, hard_limit=500) or []:
            method = decode_unicode(resolver.mem, key)
            if not method or type_name(resolver.mem, resolver.rt, func) != 'function':
                continue
            code = next((resolver.mem.u64(func + offset) for offset in range(16, 128, 8)
                         if region_of(resolver.mem.regs, resolver.mem.u64(func + offset))
                         and type_name(resolver.mem, resolver.rt, resolver.mem.u64(func + offset)) == 'code'), 0)
            if not code:
                continue
            destination = OUTPUT / module / name
            destination.mkdir(parents=True, exist_ok=True)
            with (destination / (method + '.txt')).open('w', encoding='utf-8') as file, contextlib.redirect_stdout(file):
                dis.code(code, max_inst=3000)
            methods.append(method)
        manifest['classes'][module + '.' + name] = methods
        print(name, methods, flush=True)
(OUTPUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
