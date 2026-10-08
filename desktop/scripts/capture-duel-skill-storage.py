"""Read the loaded skill storage metadata and Python decoder wrappers."""
import contextlib
import json
from pathlib import Path
import sys

SOURCE = Path(sys.argv[1])
OUTPUT = Path(__file__).resolve().parent.parent / 'out/duel-fidelity/runtime'
sys.path[:0] = [str(SOURCE), str(SOURCE / 'tools')]
from yystool.resolve import Resolver
from yystool.pywalk import decode_unicode, read_dict_entries, region_of
from yystool.pyfields import OFF_TP_DICT, type_name, fields, scalar, module_dict
import disasm4

r = Resolver(verbose=False)
d = disasm4.Dis(r.pid)
old_base = int(next(line for line in (SOURCE / 'dump/maps.txt').read_text().splitlines()
                    if 'libclient.so' in line and int(line.split()[2], 16) == 0).split('-')[0], 16)
delta = d.rt.base - old_base
d.CACHES = list(d.mem.read(disasm4.CACHES_A + delta, 256))
d.DEOPT = list(d.mem.read(disasm4.DEOPT_A + delta, 256))
holder = r.module_globals('battleengine.TurnMgrComp')['DATA_SKILL']
module = fields(r.mem, r.rt, holder)['_dataModule']
seen = set()
metadata = {}

def inspect(value, label, depth=0):
    if value in seen or depth > 3 or not region_of(r.mem.regs, value):
        return
    seen.add(value)
    tn = type_name(r.mem, r.rt, value)
    attrs = module_dict(r.mem, r.rt, value) if tn == 'module' else fields(r.mem, r.rt, value)
    if tn == 'type':
        attrs = {decode_unicode(r.mem, key): item for key, item in
                 read_dict_entries(r.mem, r.rt, r.mem.u64(value + OFF_TP_DICT), hard_limit=300) or []}
    if tn == 'function':
        for offset in range(16, 128, 8):
            code = r.mem.u64(value + offset)
            if region_of(r.mem.regs, code) and type_name(r.mem, r.rt, code) == 'code':
                with (OUTPUT / (label + '.txt')).open('w', encoding='utf-8') as f, contextlib.redirect_stdout(f):
                    d.code(code, max_inst=1000)
                break
    metadata[label] = {'type': tn, 'address': hex(value), 'fields': {str(key): {
        'type': type_name(r.mem, r.rt, item), 'address': hex(item),
        'value': scalar(r.mem, r.rt, item) if type_name(r.mem, r.rt, item) in ('str', 'int', 'float', 'tuple', 'bool') else None
    } for key, item in attrs.items() if item and not str(key).startswith('__')}}
    for key, item in attrs.items():
        if item and (not str(key).startswith('__') or tn == 'type') and key not in ('builtins', 'sys', 'logging', 'sixc', 'game3d'):
            if type_name(r.mem, r.rt, item) in ('ProtoedDict', 'BindictProxy', 'type', 'module', 'function'):
                inspect(item, label + '-' + str(key), depth + 1)

inspect(module, 'skill-storage')
(OUTPUT / 'skill-storage.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
print('Captured skill decoder wrapper metadata')
