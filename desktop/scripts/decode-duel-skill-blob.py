"""Offline bindict reader derived from the captured native mapping reader.

References are absolute offsets in the row stream. String IDs are ONE-based.
Struct definitions carry (field count, optional field count, [string ID, type]);
only optional fields use the little-endian field mask. No client code is executed.
"""
import json
from pathlib import Path
import struct
import sys

class BindictReader:
    def __init__(self, blob):
        if len(blob) < 12:
            raise ValueError('Truncated bindict header')
        count = struct.unpack_from('<I', blob)[0]
        if not 2 <= count <= (len(blob) - 8) // 4:
            raise ValueError('Invalid string pool size')
        offsets = struct.unpack_from(f'<{count}I', blob, 8)
        base = 8 + 4 * count
        if offsets[-1] > len(blob) - base or any(a > b for a, b in zip(offsets, offsets[1:])):
            raise ValueError('Invalid string pool offsets')
        self.strings = [''] + [blob[base + offsets[i]:base + offsets[i + 1]].decode('utf-8') for i in range(count - 1)]
        self.data = blob[base + offsets[-1]:]
        self.cache = {}
        self.schemas = {}
        self.active = set()

    def varint(self, position):
        value, shift = 0, 0
        while shift < 77:
            if not 0 <= position < len(self.data):
                raise ValueError('Truncated varint')
            byte = self.data[position]
            position += 1
            value |= (byte & 127) << shift
            if byte < 128:
                return value, position
            shift += 7
        raise ValueError('Invalid varint')

    def schema(self, offset):
        if offset not in self.schemas:
            count, position = self.varint(offset)
            optional, position = self.varint(position)
            if optional > count or count > len(self.data) - position:
                raise ValueError('Invalid struct definition')
            fields = []
            for _ in range(count):
                key, position = self.varint(position)
                fields.append((self.strings[key], self.data[position]))
                position += 1
            self.schemas[offset] = optional, fields
        return self.schemas[offset]

    def at(self, offset):
        if offset in self.cache:
            return self.cache[offset]
        if offset in self.active:
            raise ValueError(f'Cyclic encoded object at {offset}')
        self.active.add(offset)
        try:
            value, _ = self.read(offset)
            self.cache[offset] = value
            return value
        finally:
            self.active.remove(offset)

    def read(self, position, tag=0):
        if not tag:
            tag = self.data[position]
            position += 1
        kind, flags = tag & 15, tag & 240
        if kind == 1:
            if flags not in (0, 16):
                raise ValueError(f'Unsupported integer flags {flags}')
            value, position = self.varint(position)
            return ((value >> 1) ^ -(value & 1) if flags == 16 else value), position
        if kind == 2:
            # Native 0x44d117a: 0x10 is float32, 0x20 is float64.
            if flags not in (16, 32):
                raise ValueError(f'Unsupported floating-point flags {flags}')
            size, format_ = (4, '<f') if flags == 16 else (8, '<d')
            return struct.unpack_from(format_, self.data, position)[0], position + size
        if kind == 3:
            return self.data[position] != 0, position + 1
        if kind == 4:
            return None, position
        if kind == 5:
            index, position = self.varint(position)
            return self.strings[index], position
        if kind == 11:
            offset, position = self.varint(position)
            return self.at(offset), position
        if kind in (7, 8, 12):
            element_tag = self.data[position] if flags & 32 else 0
            position += bool(flags & 32)
            count, position = self.varint(position)
            values = []
            for _ in range(count):
                if flags & 64:
                    offset = struct.unpack_from('<I', self.data, position)[0]
                    position += 4
                    value, _ = self.read(offset, element_tag)
                else:
                    value, position = self.read(position, element_tag)
                values.append(value)
            return values, position
        if kind == 6:
            values = {}
            if flags & 128:
                schema_offset, position = self.varint(position)
                optional, fields = self.schema(schema_offset)
                mask_size = (optional + 7) // 8
                if flags & 64:
                    mask_offset, position = self.varint(position)
                else:
                    mask_offset = position
                    position += mask_size
                mask = int.from_bytes(self.data[mask_offset:mask_offset + mask_size], 'little')
                for index, (key, value_tag) in enumerate(fields):
                    if index < optional and not mask & (1 << index):
                        continue
                    values[key], position = self.read(position, value_tag)
            else:
                key_tag = self.data[position] if flags & 16 else 0
                position += bool(flags & 16)
                value_tag = self.data[position] if flags & 32 else 0
                position += bool(flags & 32)
                count, position = self.varint(position)
                for _ in range(count):
                    if flags & 64:
                        key_offset, value_offset = struct.unpack_from('<II', self.data, position)
                        position += 8
                        key, _ = self.read(key_offset, key_tag)
                        value, _ = self.read(value_offset, value_tag)
                    else:
                        key, position = self.read(position, key_tag)
                        value, position = self.read(position, value_tag)
                    values[str(key)] = value
            return values, position
        raise ValueError(f'Unsupported type {tag:02x} at {position - 1}')

    def rows(self, expected_key_size=3):
        body_size = struct.unpack_from('<I', self.data)[0]
        table_start = body_size + 6
        if table_start + 8 > len(self.data):
            raise ValueError('Truncated hash index')
        previous = -1
        entries = []
        position = table_start
        while position + 8 <= len(self.data):
            hash_, offset = struct.unpack_from('<II', self.data, position)
            if hash_ < previous or not table_start <= offset < len(self.data):
                break
            entries.append(offset)
            previous = hash_
            position += 8
        rows = {}
        if not entries:
            raise ValueError('Empty hash index')
        for offset in entries:
            key, value_position = self.read(offset, 11)
            value, _ = self.read(value_position, 11)
            if not isinstance(key, list) or len(key) != expected_key_size or not all(isinstance(x, int) for x in key):
                raise ValueError(f'Invalid skill key: {key}')
            if isinstance(value, list):
                value = {'_proto_key': value}
            if not isinstance(value, dict):
                raise ValueError(f'Invalid skill value: {key}: {value}')
            key_string = str(tuple(key))
            if key_string in rows:
                raise ValueError(f'Duplicate row {key_string}')
            rows[key_string] = value
        return rows

def main():
    source = Path(sys.argv[1])
    reader = BindictReader((source / 'dump/skill_blob.bin').read_bytes())
    rows = reader.rows()
    truth = json.loads((source / 'out/qianji_rows.json').read_text(encoding='utf-8'))
    differences = []
    for key, expected in truth.items():
        actual = rows.get(key)
        if actual != expected:
            differences.append({'key': key, 'expected': expected, 'actual': actual})
    output = Path(__file__).resolve().parent.parent / 'out/duel-fidelity'
    output.mkdir(parents=True, exist_ok=True)
    if differences:
        raise ValueError(f'{len(differences)} known client rows differ; refusing to publish decoded data')
    (output / 'table_DATA_SKILL.json').write_text(json.dumps(rows, ensure_ascii=False), encoding='utf-8')
    (output / 'skill-decoder-validation.json').write_text(json.dumps({'rows': len(rows),
        'regressionRows': len(truth), 'differences': differences}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Decoded {len(rows)} rows; {len(differences)} differing regression rows')
    for diff in differences[:3]:
        print(diff)

if __name__ == '__main__':
    main()
