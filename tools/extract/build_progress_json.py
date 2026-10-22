"""Build Progress catalogs from extracted building, spell, hook, agility, and AI assets."""

from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Any

from common import (
    DATA_DIR,
    EXPORTS_ICONS,
    PID_RE,
    current_usmap_name,
    soft_object_basename,
    top_level_properties,
    extract_fstrings,
    load_json,
    pick_persistence_id,
    write_json,
)

RAW_ROOT = Path(__file__).resolve().parents[2] / 'exports' / 'raw_progress'
LEGACY_ROOT = Path(__file__).resolve().parents[2] / 'exports' / 'legacy_progress'

HEX32_RE = re.compile(r'^[0-9A-Fa-f]{32}$')
NOISE_PID_PREFIXES = (
    'DA_', 'USD_', 'PH_', 'ACDA_', 'SKILL_', 'ITEM_', 'RECIPE_', 'BUILD',
    'BP_', 'DT_', 'GE_', 'AM_', 'ST_',
)
VENDORS = [
    {'tag': 'Vendor.MoonGarou.Hawker', 'name': 'Hawker'},
    {'tag': 'Vendor.MoonGarou.Smith', 'name': 'Smith'},
    {'tag': 'Vendor.MoonGarou.Hunter', 'name': 'Hunter'},
]


def uexp_bytes(json_path: Path) -> bytes:
    rel = json_path.as_posix()
    marker = '/raw_progress/'
    if marker in rel:
        legacy = Path(rel.replace('/raw_progress/', '/legacy_progress/', 1)).with_suffix('.uexp')
        if legacy.exists():
            return legacy.read_bytes()
    sibling = LEGACY_ROOT / json_path.name
    alt = sibling.with_suffix('.uexp')
    return alt.read_bytes() if alt.exists() else b''


def collect_strings(json_path: Path) -> list[str]:
    raw = uexp_bytes(json_path)
    if not raw:
        return []
    out: list[str] = []
    for value in extract_fstrings(raw):
        if '\x00' in value:
            continue
        cleaned = value.strip()
        if cleaned:
            out.append(cleaned)
    return out


def is_real_pid(value: str) -> bool:
    if not PID_RE.match(value):
        return False
    if value.startswith(NOISE_PID_PREFIXES):
        return False
    letters = [ch for ch in value if ch.isalpha()]
    if letters and (all(ch.isupper() for ch in letters) or all(ch.islower() for ch in letters)):
        return False
    return True


def persistence_id(strings: list[str]) -> str | None:
    pid = pick_persistence_id([s for s in strings if is_real_pid(s)])
    if pid and is_real_pid(pid):
        return pid
    for value in strings:
        if is_real_pid(value):
            return value
    return None


def texture_names(namemap: list[Any]) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for entry in namemap:
        if not isinstance(entry, str):
            continue
        base = entry.replace('\\', '/').split('/')[-1].split('.')[0]
        if not base.startswith('T_'):
            continue
        icon = f'{base}.png'
        key = icon.lower()
        if key in seen:
            continue
        seen.add(key)
        names.append(icon)
    return names


def pretty_ident(value: str) -> str:
    text = re.sub(r'([a-z])([A-Z])', r'\1 \2', value)
    text = text.replace('_', ' ')
    text = re.sub(r'([a-z])(\d)', r'\1 \2', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text.title() if text else value


EQUIPMENT_NAME_NOISE = {
    'Pickaxe', 'Hatchet', 'Axe', 'Shovel', 'Hammer', 'Sword', 'Bow', 'Staff',
    'Fishing Rod', 'Fishing Rod Equipped', 'Woodcutting Veteran',
}


def is_description(value: str) -> bool:
    lowered = value.lower()
    if len(value) > 48:
        return True
    if value.endswith('.'):
        return True
    if lowered.startswith(('a ', 'an ', 'the ')):
        return True
    if ' used ' in lowered or ' used to ' in lowered:
        return True
    return False


def pick_display_name(strings: list[str], fallback: str) -> str:
    ranked: list[str] = []
    for value in strings:
        if is_real_pid(value) or HEX32_RE.match(value):
            continue
        if value.startswith('AgilityCourseName.'):
            ranked.append(pretty_ident(value.split('.', 1)[1]))
            continue
        if value.startswith('SpellDisplayName_'):
            ranked.append(pretty_ident(value.split('_', 1)[1]))
            continue
        if re.match(r'^[a-z]+_[a-z0-9_]+$', value) or value.startswith('spell_'):
            continue
        if value.startswith(('BP_', 'DA_', 'PH_', 'USD_', 'T_', 'AM_', 'GE_', 'ST_')):
            continue
        if value in {'BPTYPE_Normal', 'None', 'Class', 'Package', 'BPTYPE Normal'}:
            continue
        if re.search(r'[.\\/]', value):
            continue
        if len(value) < 2 or len(value) > 48:
            continue
        if is_description(value):
            continue
        if re.search(r'[A-Za-z]', value):
            if ' ' not in value and re.search(r'[a-z][A-Z]', value):
                ranked.append(pretty_ident(value))
            else:
                ranked.append(value)
    if not ranked:
        return fallback
    ranked.sort(key=lambda s: (0 if s.lower() != fallback.lower() else 1, len(s)))
    return ranked[0]


def pick_spell_copy(strings: list[str], fallback: str) -> tuple[str, str | None]:
    """Prefer SpellDisplayName keys, skip equipment nouns, keep a description if present."""
    from_keys: list[str] = []
    names: list[str] = []
    descriptions: list[str] = []
    for value in strings:
        if is_real_pid(value) or HEX32_RE.match(value):
            continue
        if value.startswith('SpellDisplayName_'):
            from_keys.append(pretty_ident(value.split('_', 1)[1]))
            continue
        if is_description(value) and len(value) >= 24:
            descriptions.append(value)
            continue
        if re.match(r'^[a-z]+_[a-z0-9_]+$', value) or value.startswith('spell_'):
            continue
        if value.startswith(('BP_', 'DA_', 'PH_', 'USD_', 'T_', 'AM_', 'GE_', 'ST_')):
            continue
        if value in {'BPTYPE_Normal', 'None', 'Class', 'Package', 'BPTYPE Normal'}:
            continue
        if value in EQUIPMENT_NAME_NOISE:
            continue
        if re.search(r'[.\\/]', value):
            continue
        if len(value) < 3 or len(value) > 48:
            continue
        if not re.search(r'[A-Za-z]', value):
            continue
        if ' ' not in value and re.search(r'[a-z][A-Z]', value):
            names.append(pretty_ident(value))
        else:
            names.append(value)
    if from_keys:
        name = from_keys[0]
    elif names:
        names.sort(key=lambda s: (
            0 if s.lower() == fallback.lower() else 1,
            0 if ' ' in s else 1,
            -len(s),
        ))
        name = names[0]
    else:
        name = fallback
    description = max(descriptions, key=len) if descriptions else None
    return name, description


def namemap_has(namemap: list[Any], token: str) -> bool:
    return any(isinstance(entry, str) and token in entry for entry in namemap)


def index_pngs(root: Path) -> dict[str, Path]:
    found: dict[str, Path] = {}
    if not root.exists():
        return found
    for path in root.rglob('*.png'):
        key = path.name.lower()
        prev = found.get(key)
        if prev is None or len(path.as_posix()) < len(prev.as_posix()):
            found[key] = path
    return found


def copy_icons(entries: list[dict[str, Any]], dest: Path, extra_fallbacks: list[str] | None = None) -> tuple[int, list[str]]:
    index = index_pngs(EXPORTS_ICONS)
    dest.mkdir(parents=True, exist_ok=True)
    for stale in dest.glob('*.png'):
        stale.unlink()
    copied = 0
    missing: list[str] = []
    for entry in entries:
        chosen: str | None = None
        src: Path | None = None
        candidates = [*(entry.pop('icons', []) or []), *(extra_fallbacks or [])]
        seen: set[str] = set()
        for icon in candidates:
            key = icon.lower()
            if key in seen:
                continue
            seen.add(key)
            hit = index.get(key)
            if hit:
                chosen = icon
                src = hit
                break
        entry['icon'] = chosen
        if not chosen or not src:
            missing.append(entry.get('name') or entry.get('persistenceId') or '?')
            continue
        (dest / chosen).write_bytes(src.read_bytes())
        copied += 1
    return copied, missing


def parse_building(path: Path, names: dict[str, str] | None = None) -> dict[str, Any] | None:
    posix = path.as_posix()
    if 'DerivedData' in posix or path.stem.endswith('_DerivedData'):
        return None
    if path.stem.startswith('DA_Agility'):
        return None
    data = load_json(path)
    namemap = data.get('NameMap') or []
    if not isinstance(namemap, list):
        namemap = []
    if 'BuildingPieces' not in posix and not namemap_has(namemap, 'BuildingPieceData'):
        return None
    strings = collect_strings(path)
    props = top_level_properties(data)
    pid = props.get('PersistenceID') if isinstance(props.get('PersistenceID'), str) else None
    if not pid or not is_real_pid(pid):
        pid = persistence_id(strings)
    if not pid:
        return None
    stem = re.sub(r'^BUILDPIECE_DA_', 'DA_', path.stem)
    fallback = pretty_ident(re.sub(r'^DA_', '', stem).replace('BaseBuilding_', ''))
    category = None
    # DisplayName is often a description sentence; keep the asset title.
    for entry in namemap:
        if isinstance(entry, str) and entry.startswith('BaseBuilding.'):
            category = entry.split('.')[-1]
            break
    if not category:
        parts = path.parts
        if 'BuildingPieces' in parts:
            idx = parts.index('BuildingPieces')
            if idx + 2 < len(parts):
                category = pretty_ident(parts[idx + 2])
    icons = [name for name in texture_names(namemap) if name.lower().startswith('t_icon_')]
    display_icon = soft_object_basename(props.get('DisplayIcon'))
    if display_icon:
        icons = [display_icon] + [name for name in icons if name.lower() != display_icon.lower()]
    title_key = props.get('DisplayName')
    if isinstance(title_key, str) and names and names.get(title_key):
        fallback = names[title_key]
    return {
        'persistenceId': pid,
        'name': fallback,
        'rowName': path.stem,
        'category': category,
        'icons': icons,
        'sourceAsset': path.name,
    }


def parse_spell(path: Path) -> dict[str, Any] | None:
    data = load_json(path)
    namemap = data.get('NameMap') or []
    if not isinstance(namemap, list):
        namemap = []
    if not namemap_has(namemap, 'UtilitySpellData'):
        return None
    strings = collect_strings(path)
    pid = persistence_id(strings)
    if not pid:
        return None
    fallback = pretty_ident(re.sub(r'^USD_', '', path.stem))
    textures = texture_names(namemap)
    icons = [name for name in textures if name.startswith('T_Skill_') and 'Tag' not in name]
    icons.extend(name for name in textures if name.startswith('T_Icon_') and 'Tag' not in name)
    skill = None
    for name in textures:
        match = re.match(r'T_Icon_Tag_Skill_([A-Za-z]+)\.png$', name)
        if match:
            skill = match.group(1)
            break
        match = re.match(r'T_Skill_([A-Za-z]+)_', name)
        if match and match.group(1) not in {'Icon'}:
            skill = match.group(1)
            break
    name, description = pick_spell_copy(strings, fallback)
    return {
        'persistenceId': pid,
        'name': name,
        'description': description,
        'rowName': path.stem,
        'skill': skill,
        'icons': icons,
        'sourceAsset': path.name,
    }


def parse_hook(path: Path) -> dict[str, Any] | None:
    strings = collect_strings(path)
    pid = persistence_id(strings)
    if not pid:
        return None
    fallback = pretty_ident(re.sub(r'^PH_', '', path.stem))
    return {
        'persistenceId': pid,
        'name': pick_display_name(strings, fallback) if pick_display_name(strings, fallback) != fallback else fallback,
        'rowName': path.stem,
        'sourceAsset': path.name,
    }


def parse_agility(path: Path) -> dict[str, Any] | None:
    strings = collect_strings(path)
    pid = persistence_id(strings)
    if not pid:
        return None
    fallback = pretty_ident(re.sub(r'^DA_AgilityGymCourse', 'Course ', path.stem))
    name = pick_display_name(strings, fallback)
    return {
        'persistenceId': pid,
        'name': name,
        'rowName': path.stem,
        'sourceAsset': path.name,
    }


def parse_ai(path: Path) -> dict[str, Any] | None:
    if not path.stem.startswith('BP_AI_') or not path.stem.endswith('_Data'):
        return None
    strings = collect_strings(path)
    pid = persistence_id(strings)
    if not pid:
        return None
    fallback = pretty_ident(re.sub(r'_Data$', '', re.sub(r'^BP_AI_', '', path.stem)))
    name = pick_display_name(strings, fallback)
    if name in {'BPTYPE Normal', 'Bptype Normal'}:
        name = fallback
    return {
        'persistenceId': pid,
        'name': name,
        'rowName': path.stem,
        'sourceAsset': path.name,
    }


def unique_by_id(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    for row in rows:
        by_id.setdefault(row['persistenceId'], row)
    values = list(by_id.values())
    values.sort(key=lambda row: (row.get('name') or '', row.get('rowName') or ''))
    return values


def slim(row: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in row.items() if value is not None}


def carry_spell_copy(spells: list[dict[str, Any]]) -> None:
    """Keep tooltip copy when a progress rebuild rewrites data/spells.json.

    Utility spell dumps only contain a string-table key such as Magic.Confuse.Name.
    Descriptions, levels, cooldowns, rune costs, and the display names that go
    with them are filled later by enrich_spells.py and have to survive the next
    extract.
    """
    path = DATA_DIR / 'spells.json'
    if not path.exists():
        return
    payload = load_json(path)
    previous = payload.get('spells') if isinstance(payload, dict) else None
    if not isinstance(previous, list):
        return
    by_id = {
        row['persistenceId']: row
        for row in previous
        if isinstance(row, dict) and isinstance(row.get('persistenceId'), str)
    }
    for spell in spells:
        old = by_id.get(spell.get('persistenceId'))
        if not isinstance(old, dict):
            continue
        had_dump_description = bool(spell.get('description'))
        for field in ('description', 'level', 'cooldown', 'runes'):
            if spell.get(field) in (None, '') and old.get(field) not in (None, ''):
                spell[field] = old[field]
        if not had_dump_description and spell.get('description') and old.get('name'):
            spell['name'] = old['name']


def write_catalog(name: str, key: str, rows: list[dict[str, Any]], extra_meta: dict[str, Any] | None = None) -> Path:
    payload = {
        'meta': {
            'usmap': current_usmap_name(),
            'count': len(rows),
            **(extra_meta or {}),
        },
        key: [slim(row) for row in rows],
    }
    out = DATA_DIR / f'{name}.json'
    write_json(out, payload)
    print(f'Wrote {len(rows)} {key} -> {out}')
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description='Normalize Progress-related dumps into data/*.json')
    parser.add_argument('--raw-root', type=Path, default=RAW_ROOT)
    args = parser.parse_args()
    root = args.raw_root
    if not root.exists():
        print(f'Missing raw root: {root}')
        return 1

    item_names: dict[str, str] = {}
    names_path = DATA_DIR / 'stringtables' / 'item_names.json'
    if names_path.exists():
        payload = load_json(names_path)
        raw_names = payload.get('names') if isinstance(payload, dict) else {}
        if isinstance(raw_names, dict):
            item_names = {str(key): str(value) for key, value in raw_names.items() if key and value}

    buildings = unique_by_id([
        row for path in root.rglob('*.json')
        if path.name.startswith(('DA_', 'BUILDPIECE_DA_', 'BUILDPIECE_ProcessingStation_'))
        for row in [parse_building(path, item_names)]
        if row
    ])
    spells = unique_by_id([
        row for path in root.rglob('USD_*.json')
        for row in [parse_spell(path)]
        if row
    ])
    hooks = unique_by_id([
        row for path in root.rglob('PH_*.json')
        for row in [parse_hook(path)]
        if row
    ])
    courses = unique_by_id([
        row for path in root.rglob('DA_AgilityGymCourse*.json')
        for row in [parse_agility(path)]
        if row
    ])
    ais = unique_by_id([
        row for path in root.rglob('BP_AI_*_Data.json')
        for row in [parse_ai(path)]
        if row
    ])

    carry_spell_copy(spells)
    building_copied, building_missing = copy_icons(buildings, DATA_DIR / 'buildings')
    spell_copied, spell_missing = copy_icons(spells, DATA_DIR / 'spells')

    write_catalog('buildings', 'buildings', buildings, {
        'iconsCopied': building_copied,
        'iconsMissing': building_missing[:40],
    })
    write_catalog('spells', 'spells', spells, {
        'iconsCopied': spell_copied,
        'iconsMissing': spell_missing,
    })
    write_catalog('hooks', 'hooks', hooks)
    write_catalog('agility', 'courses', courses)
    write_catalog('ais', 'ais', ais)
    write_json(DATA_DIR / 'vendors.json', {'meta': {'count': len(VENDORS)}, 'vendors': VENDORS})
    print(f'Wrote {len(VENDORS)} vendors -> {DATA_DIR / "vendors.json"}')
    print(f'Building icons: {building_copied} copied, {len(building_missing)} missing')
    print(f'Spell icons: {spell_copied} copied, {len(spell_missing)} missing')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
