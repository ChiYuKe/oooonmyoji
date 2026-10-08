"""Read the now-loaded official AI table; capture its blob without client execution."""
from pathlib import Path
import json
import sys
SOURCE = Path(sys.argv[1])
sys.path.insert(0, str(SOURCE))
from yystool.resolve import Resolver
from yystool.pyfields import fields, module_dict, type_name, scalar
from yystool.pywalk import read_dict_entries, value_to_python
from importlib.util import spec_from_file_location, module_from_spec
r = Resolver(verbose=False)
holder = r.module_globals('battleengine.SkillAi')['SKILL_AI_DATA']
module = fields(r.mem, r.rt, holder).get('_dataModule')
if not module or type_name(r.mem, r.rt, module) != 'module':
    raise RuntimeError('SKILL_AI_DATA is unmaterialized. Server-authoritative duels do not load it; use a local-AI battle mode or provide an exported table.')
attributes = module_dict(r.mem, r.rt, module)
data = attributes['data']
if type_name(r.mem, r.rt, data) == 'BindictProxy':
    data = fields(r.mem, r.rt, data)['bindict_data']
output = Path(__file__).resolve().parent.parent / 'out/duel-fidelity'
if type_name(r.mem, r.rt, data) == 'bindict.bindict' and r.mem.u64(data + 16):
    state = r.mem.u64(data + 16)
    bytes_ = r.mem.u64(state)
    blob = r.mem.read(bytes_ + 32, r.mem.u64(bytes_ + 16))
    (output / 'skill_ai_blob.bin').write_bytes(blob)
    spec = spec_from_file_location('decode_duel', Path(__file__).with_name('decode-duel-skill-blob.py'))
    decoder = module_from_spec(spec)
    spec.loader.exec_module(decoder)
    rows = decoder.BindictReader(blob).rows(expected_key_size=2)
else:
    if type_name(r.mem, r.rt, data) == 'bindict.bindict':
        data = r.mem.u64(data + 24)
    rows = {str(value_to_python(r.mem, r.rt, key, max_items=8)): scalar(r.mem, r.rt, value)
            for key, value in read_dict_entries(r.mem, r.rt, data, hard_limit=200000) or []}
if not rows:
    raise RuntimeError('Loaded official AI table is empty')
(output / 'table_SKILL_AI_DATA.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'Captured {len(rows)} official AI rows')
