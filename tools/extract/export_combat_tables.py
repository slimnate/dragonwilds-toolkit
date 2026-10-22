"""Parse equipment DataTables and write normalized combat lookup JSON.

Sources (retoc legacy extract under exports/legacy_combat by default):
  - DT_PlayerWeaponPowerLevels
  - DT_PlayerDamageNegation
  - DT_WearableEquipment
  - ST_WeaponAttacks (unique special labels)

Mapped dumps expose DataTable rows. Older RawExport dumps are still decoded from .uexp.
"""

from __future__ import annotations

import argparse
import base64
import re
import struct
from pathlib import Path
from typing import Any

from common import (
    DATA_DIR,
    REPO_ROOT,
    as_number,
    current_usmap_name,
    datatable_row_structs,
    load_json,
    struct_field_map,
    write_json,
)

DEFAULT_COMBAT_LEGACY = REPO_ROOT / 'exports' / 'legacy_combat'
COMBAT_DATA_DIR = DATA_DIR / 'combat'


def _export_bytes(json_path: Path) -> tuple[bytes, list[Any]]:
    data = load_json(json_path)
    namemap = data.get('NameMap') or []
    uexp = json_path.with_suffix('.uexp')
    if uexp.exists():
        return uexp.read_bytes(), namemap
    raw_b64 = data['Exports'][0].get('Data')
    if not isinstance(raw_b64, str):
        raise ValueError(f'No export data in {json_path}')
    return base64.b64decode(raw_b64), namemap


def parse_structured_float_rows(json_path: Path, n_floats: int = 9) -> dict[str, list[float]] | None:
    rows = datatable_row_structs(load_json(json_path))
    if not rows:
        return None
    out: dict[str, list[float]] = {}
    for row in rows:
        name = row.get('Name')
        fields = struct_field_map(row.get('Value'))
        if not isinstance(name, str) or not fields:
            continue
        values: list[float] = []
        for index in range(1, n_floats + 1):
            number = as_number(fields.get(f'Tier{index}'))
            if number is None:
                break
            values.append(round(float(number), 5))
        if values:
            out[name] = values
    return out or None


def parse_structured_wearable(json_path: Path) -> dict[str, dict[str, Any]] | None:
    rows = datatable_row_structs(load_json(json_path))
    if not rows:
        return None
    field_names = {
        'Defense': 'armourValue',
        'MeleeResistance': 'meleeResistance',
        'RangedResistance': 'rangedResistance',
        'MagicResistance': 'magicResistance',
        'MaxVitalShield': 'maxVitalShield',
    }
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        name = row.get('Name')
        if not isinstance(name, str):
            continue
        fields = struct_field_map(row.get('Value'))
        entry: dict[str, Any] = {'row': name}
        for src, dest in field_names.items():
            number = as_number(fields.get(src))
            if isinstance(number, (int, float)) and number != 0:
                entry[dest] = number
        out[name] = entry
    return out or None


def parse_float_array_table(json_path: Path, n_floats: int = 9) -> dict[str, list[float]]:
    """Decode rows shaped as FName + ``00 13`` + N floats (power / negation DTs)."""
    structured = parse_structured_float_rows(json_path, n_floats)
    if structured:
        return structured
    raw, namemap = _export_bytes(json_path)
    rows: dict[str, list[float]] = {}
    i = 0
    while i < len(raw) - 2:
        if raw[i : i + 2] == b'\x00\x13':
            off = i + 2
            if i >= 8 and off + n_floats * 4 <= len(raw):
                idx, _num = struct.unpack_from('<ii', raw, i - 8)
                if 0 <= idx < len(namemap) and isinstance(namemap[idx], str):
                    vals = [
                        round(struct.unpack_from('<f', raw, off + 4 * k)[0], 5)
                        for k in range(n_floats)
                    ]
                    rows[namemap[idx]] = vals
            i = off + n_floats * 4
            continue
        i += 1
    return rows


def parse_wearable_table(json_path: Path) -> dict[str, dict[str, Any]]:
    """Decode DT_WearableEquipment rows."""
    structured = parse_structured_wearable(json_path)
    if structured:
        return structured
    raw, namemap = _export_bytes(json_path)
    row_count = struct.unpack_from('<I', raw, 13)[0]
    off = 17
    rows: dict[str, dict[str, Any]] = {}
    for _ in range(row_count):
        if off + 11 > len(raw):
            break
        name_idx, _name_num = struct.unpack_from('<ii', raw, off)
        off += 8
        if not (0 <= name_idx < len(namemap) and isinstance(namemap[name_idx], str)):
            break
        name = namemap[name_idx]
        if raw[off : off + 2] != b'\x80\x0b':
            break
        type_id = raw[off + 2]
        off += 3
        values: list[float] = []
        if type_id == 0x10:
            values = [round(struct.unpack_from('<f', raw, off + 4 * k)[0], 5) for k in range(4)]
            off += 16
        elif type_id == 0x1e:
            values = [round(struct.unpack_from('<f', raw, off)[0], 5)]
            off += 4
        elif type_id == 0x1f:
            values = []
        else:
            trial = [struct.unpack_from('<f', raw, off + 4 * k)[0] for k in range(4)]
            if all(v == v and abs(v) < 500 for v in trial):
                values = [round(v, 5) for v in trial]
                off += 16
            else:
                values = [round(struct.unpack_from('<f', raw, off)[0], 5)]
                off += 4

        entry: dict[str, Any] = {'row': name}
        if len(values) >= 4:
            entry['armourValue'] = values[0]
            entry['meleeResistance'] = values[1]
            entry['rangedResistance'] = values[2]
            entry['magicResistance'] = values[3]
        elif len(values) == 1:
            entry['armourValue'] = values[0]
        rows[name] = entry
    return rows


def parse_weapon_attacks_strings(json_path: Path) -> dict[str, str]:
    """Pull key/value pairs from ST_WeaponAttacks RawExport ascii runs."""
    raw, _namemap = _export_bytes(json_path)
    strings = [m.decode('ascii') for m in re.findall(rb'[\x20-\x7e]{3,}', raw)]
    # Pattern: Key, Value, Key, Value… after table name
    out: dict[str, str] = {}
    i = 0
    while i + 1 < len(strings):
        key, val = strings[i], strings[i + 1]
        if key == 'ST_WeaponAttacks':
            i += 1
            continue
        if key.endswith(('Name', 'Desc', 'Special')) and not val.endswith(('Name', 'Desc', 'Special')):
            out[key] = val
            i += 2
            continue
        i += 1
    return out


def find_dt(root: Path, stem: str) -> Path | None:
    matches = sorted(root.rglob(f'{stem}.json'))
    return matches[0] if matches else None


def export_all(legacy_root: Path, out_dir: Path) -> dict[str, int]:
    out_dir.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}
    usmap = current_usmap_name()

    power_path = find_dt(legacy_root, 'DT_PlayerWeaponPowerLevels')
    if not power_path:
        raise SystemExit(f'DT_PlayerWeaponPowerLevels.json not found under {legacy_root}')
    power = parse_float_array_table(power_path, 9)
    write_json(out_dir / 'weapon_power_levels.json', {
        'meta': {
            'source': power_path.as_posix(),
            'usmap': usmap,
            'note': 'Index 0 = PowerLevel 1 … index 8 = PowerLevel 9',
        },
        'curves': power,
    })
    counts['weapon_power_levels'] = len(power)

    neg_path = find_dt(legacy_root, 'DT_PlayerDamageNegation')
    if not neg_path:
        raise SystemExit(f'DT_PlayerDamageNegation.json not found under {legacy_root}')
    negation = parse_float_array_table(neg_path, 9)
    write_json(out_dir / 'damage_negation.json', {
        'meta': {
            'source': neg_path.as_posix(),
            'usmap': usmap,
            'note': 'Per weapon family; index aligns with PowerLevel 1–9',
        },
        'families': negation,
    })
    counts['damage_negation'] = len(negation)

    wear_path = find_dt(legacy_root, 'DT_WearableEquipment')
    if not wear_path:
        raise SystemExit(f'DT_WearableEquipment.json not found under {legacy_root}')
    wearable = parse_wearable_table(wear_path)
    write_json(out_dir / 'wearable_equipment.json', {
        'meta': {
            'source': wear_path.as_posix(),
            'usmap': usmap,
            'note': (
                'armourValue scales with tier; melee/ranged/magicResistance are style '
                'affinities (positive = preferred style). Sparse rows may only have armourValue.'
            ),
        },
        'rows': wearable,
    })
    counts['wearable_equipment'] = len(wearable)

    attacks_path = find_dt(legacy_root, 'ST_WeaponAttacks')
    if attacks_path:
        attacks = parse_weapon_attacks_strings(attacks_path)
        write_json(out_dir / 'weapon_attacks.json', {
            'meta': {'source': attacks_path.as_posix(), 'usmap': usmap},
            'strings': attacks,
        })
        counts['weapon_attacks'] = len(attacks)

    return counts


def load_combat_tables(combat_dir: Path = COMBAT_DATA_DIR) -> dict[str, Any]:
    """Load previously exported combat JSON for item enrichment."""
    tables: dict[str, Any] = {
        'powerCurves': {},
        'damageNegation': {},
        'wearable': {},
        'weaponAttacks': {},
    }
    power_path = combat_dir / 'weapon_power_levels.json'
    if power_path.exists():
        data = load_json(power_path)
        tables['powerCurves'] = data.get('curves') or {}
    neg_path = combat_dir / 'damage_negation.json'
    if neg_path.exists():
        data = load_json(neg_path)
        tables['damageNegation'] = data.get('families') or {}
    wear_path = combat_dir / 'wearable_equipment.json'
    if wear_path.exists():
        data = load_json(wear_path)
        tables['wearable'] = data.get('rows') or {}
    atk_path = combat_dir / 'weapon_attacks.json'
    if atk_path.exists():
        data = load_json(atk_path)
        tables['weaponAttacks'] = data.get('strings') or {}
    return tables


def main() -> int:
    parser = argparse.ArgumentParser(description='Export combat DataTables to data/combat/')
    parser.add_argument('--legacy-root', type=Path, default=DEFAULT_COMBAT_LEGACY)
    parser.add_argument('--out', type=Path, default=COMBAT_DATA_DIR)
    args = parser.parse_args()
    if not args.legacy_root.exists():
        print(f'Missing combat legacy root: {args.legacy_root}')
        print('Extract DT_PlayerWeaponPowerLevels, DT_PlayerDamageNegation, DT_WearableEquipment')
        print('into exports/legacy_combat first (retoc to-legacy).')
        return 1
    counts = export_all(args.legacy_root, args.out)
    for key, n in counts.items():
        print(f'  {key}: {n}')
    print(f'Wrote combat tables -> {args.out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
