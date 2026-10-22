"""Build data/journal.json from extracted JOURNAL_ entry assets + string tables."""

from __future__ import annotations

import argparse
import json
import re
import struct
from collections import defaultdict
from pathlib import Path
from typing import Any

from common import (
    DATA_DIR,
    EXPORTS_ICONS,
    PID_RE,
    current_usmap_name,
    load_json,
    write_json,
)

LEGACY_ROOT = Path(__file__).resolve().parents[2] / 'exports' / 'legacy_journal'
ST_ROOT = Path(__file__).resolve().parents[2] / 'exports' / 'legacy_journal_st'
HEX32_RE = re.compile(r'^[0-9A-Fa-f]{32}$')
KEY_RE = re.compile(r'^[A-Za-z][A-Za-z0-9_.]*$')
NOISE_PREFIXES = (
    'DA_', 'USD_', 'PH_', 'ACDA_', 'SKILL_', 'ITEM_', 'RECIPE_', 'BUILD',
    'BP_', 'DT_', 'GE_', 'AM_', 'ST_', 'JOURNAL_', 'T_',
)

SKIP_STEMS = {
    'JOURNAL_Data',
}
SKIP_PREFIXES = (
    'JOURNAL_Category_',
    'JOURNAL_SC_',
)

SUBCATEGORY_LABELS = {
    'Ammo': 'Ammo',
    'Armour': 'Armour',
    'Artefacts': 'Artefacts',
    'Drinks': 'Drinks',
    'Factions': 'Factions',
    'Fauna': 'Fauna',
    'Flora': 'Flora',
    'Food': 'Food',
    'Gear': 'Gear',
    'Jewel': 'Jewellery',
    'Jewellery': 'Jewellery',
    'LoreScraps': 'Lore Scraps',
    'Materials': 'Resources',
    'People': 'People',
    'Places': 'Places',
    'Potions': 'Potions',
    'Resources': 'Resources',
    'Seeds': 'Flora',
    'Tools': 'Tools',
    'Tutorials': 'Tutorials',
    'Tutorial': 'Tutorials',
    'Weapons': 'Weapons',
}

CATEGORY_ORDER = ('World', 'Recipes', 'Knowledge')


def extract_fstrings(raw: bytes, maxn: int = 8000) -> list[str]:
    out: list[str] = []
    i = 0
    while i + 4 <= len(raw):
        n = struct.unpack_from('<i', raw, i)[0]
        if 2 <= n <= maxn and i + 4 + n <= len(raw):
            chunk = raw[i + 4:i + 4 + n]
            if chunk.endswith(b'\x00') and all(32 <= b < 127 or b == 0 for b in chunk):
                out.append(chunk[:-1].decode('ascii', errors='ignore'))
                i += 4 + n
                continue
        if n < 0:
            count = -n
            nbytes = count * 2
            if 2 <= count <= 4000 and i + 4 + nbytes <= len(raw):
                chunk = raw[i + 4:i + 4 + nbytes]
                if chunk.endswith(b'\x00\x00'):
                    try:
                        text = chunk.decode('utf-16-le').rstrip('\x00')
                        out.append(text)
                        i += 4 + nbytes
                        continue
                    except UnicodeDecodeError:
                        pass
        i += 1
    return out


def looks_like_key(value: str) -> bool:
    if not value or ' ' in value or len(value) > 120:
        return False
    if not KEY_RE.match(value):
        return False
    if value.endswith('.'):
        return False
    return True


def parse_st_map(strings: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    i = 0
    while i < len(strings) and (not strings[i] or strings[i].startswith('ST_')):
        i += 1
    while i < len(strings):
        key = strings[i]
        if not looks_like_key(key):
            i += 1
            continue
        if i + 1 >= len(strings):
            break
        value = strings[i + 1]
        nxt = strings[i + 2] if i + 2 < len(strings) else ''
        if looks_like_key(value) and nxt and (not looks_like_key(nxt) or len(nxt) > 80):
            out[key] = ''
            i += 1
            continue
        out[key] = value
        i += 2
    return out


def pretty_ident(value: str) -> str:
    text = re.sub(r'([a-z])([A-Z])', r'\1 \2', value)
    text = text.replace('_', ' ')
    text = re.sub(r'\s+', ' ', text).strip()
    return text.title() if text else value


def is_real_pid(value: str) -> bool:
    if not PID_RE.match(value):
        return False
    if HEX32_RE.match(value):
        return False
    if value.startswith(NOISE_PREFIXES):
        return False
    letters = [ch for ch in value if ch.isalpha()]
    if letters and (all(ch.isupper() for ch in letters) or all(ch.islower() for ch in letters)):
        return False
    return True


def persistence_id(strings: list[str]) -> str | None:
    for value in strings:
        if is_real_pid(value):
            return value
    return None


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


def load_st_tables(root: Path) -> dict[str, str]:
    merged: dict[str, str] = {}
    if not root.exists():
        return merged
    for path in sorted(root.rglob('ST_*.uexp')):
        table = parse_st_map(extract_fstrings(path.read_bytes()))
        for key, value in table.items():
            if key not in merged and value:
                merged[key] = value
    return merged


def load_item_lookups() -> tuple[dict[str, str], dict[str, str], dict[str, str]]:
    names: dict[str, str] = {}
    names_path = DATA_DIR / 'stringtables' / 'item_names.json'
    if names_path.exists():
        payload = load_json(names_path)
        raw = payload.get('names') if isinstance(payload, dict) else {}
        if isinstance(raw, dict):
            names = {str(key): str(value) for key, value in raw.items() if key and value}

    by_name: dict[str, str] = {}
    by_row: dict[str, str] = {}
    items_path = DATA_DIR / 'items.json'
    if items_path.exists():
        payload = load_json(items_path)
        for item in payload.get('items') or []:
            icon = item.get('icon')
            name = item.get('name')
            row = item.get('rowName')
            if isinstance(icon, str) and icon:
                if isinstance(name, str) and name:
                    by_name.setdefault(name.lower(), icon)
                if isinstance(row, str) and row:
                    by_row.setdefault(row.lower(), icon)
    for key, label in names.items():
        icon = by_name.get(label.lower())
        if icon:
            by_row.setdefault(key.lower(), icon)
    return names, by_name, by_row


def load_ai_names() -> dict[str, str]:
    path = DATA_DIR / 'ais.json'
    if not path.exists():
        return {}
    payload = load_json(path)
    out: dict[str, str] = {}
    for row in payload.get('ais') or []:
        name = row.get('name')
        stem = str(row.get('rowName') or '').replace('BP_AI_', '').replace('_Data', '')
        if isinstance(name, str) and name:
            if stem:
                out.setdefault(stem.lower(), name)
            out.setdefault(re.sub(r'[^a-z0-9]+', '', name.lower()), name)
    return out


def classify_path(path: Path) -> tuple[str, str]:
    posix = path.as_posix()
    if '/DeletedEntries/' in posix or '/Deleted/' in posix:
        return 'Deleted', 'Deleted'
    category = 'Other'
    subcategory = 'Other'
    parts = list(path.parts)
    if 'Entries' in parts:
        idx = parts.index('Entries')
        rest = [part for part in parts[idx + 1:-1] if part]
        if rest:
            head = rest[0]
            if head in {'World', 'Recipes', 'Knowledge'}:
                category = head
                if len(rest) > 1:
                    subcategory = rest[1]
            else:
                subcategory = head
    stem = path.stem
    if category == 'Other':
        if '_World_' in stem or stem.startswith('JOURNAL_World_'):
            category = 'World'
        elif '_Recipes_' in stem or '_Recipe_' in stem or stem.startswith('JOURNAL_Recipes_'):
            category = 'Recipes'
        elif '_Know_' in stem or stem.startswith('JOURNAL_Know_'):
            category = 'Knowledge'
    if subcategory in {'Meals', 'Seeds'}:
        subcategory = 'Food' if subcategory == 'Meals' else 'Flora'
    return category, subcategory


def name_from_stem(stem: str) -> str:
    rest = re.sub(r'^JOURNAL_', '', stem)
    rest = re.sub(
        r'^(World_|Recipes_|Recipe_|Know_|Knowledge_|MQ_)',
        '',
        rest,
    )
    rest = re.sub(
        r'^(Factions_|Fauna_|Flora_|Materials_|Ammo_|Armour_|Drinks_|Food_|Potions_|'
        r'Resources_|Tools_|Weapons_|Jewel_|Gear_|LoreScraps_|People_|Places_|'
        r'Tutorials_|Tutorial_|Empty_|Seeds_)',
        '',
        rest,
    )
    return pretty_ident(rest)


def texture_names(blob: str) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for match in re.findall(r'T_[A-Za-z0-9_]+', blob):
        if 'Tag' in match:
            continue
        icon = f'{match}.png'
        key = icon.lower()
        if key in seen:
            continue
        seen.add(key)
        names.append(icon)
    journal_first = [name for name in names if 'Journal' in name]
    other = [name for name in names if 'Journal' not in name and name.startswith('T_Icon_')]
    return journal_first + other


def pick_row_key(strings: list[str], stem: str) -> str | None:
    skip = {stem, 'None', 'Class', 'Package'}
    candidates: list[str] = []
    for value in strings:
        if value in skip or not looks_like_key(value):
            continue
        if '.' in value:
            continue
        if value.startswith(NOISE_PREFIXES):
            continue
        if HEX32_RE.match(value) or is_real_pid(value):
            continue
        if len(value) < 3 or len(value) > 48:
            continue
        candidates.append(value)
    if not candidates:
        return None
    candidates.sort(key=lambda value: (-candidates.count(value), -len(value)))
    return candidates[0]


def pick_title_key(strings: list[str]) -> str | None:
    for value in strings:
        if value.endswith('.Title') or value.endswith('_DisplayName') or value.endswith('.Title.FemaleAuthor'):
            return value
    return None


def pick_text_keys(strings: list[str], title_key: str | None) -> list[str]:
    keys: list[str] = []
    if title_key:
        for suffix in ('.Text', '_Text', '.Text.FemaleAuthor'):
            candidate = title_key.replace('.Title.FemaleAuthor', suffix).replace('.Title', suffix).replace('_DisplayName', suffix)
            if candidate != title_key:
                keys.append(candidate)
    for value in strings:
        if (value.endswith('.Text') or value.endswith('_Text') or value.endswith('.Text.FemaleAuthor')) and value not in keys:
            keys.append(value)
    return keys


def slim(row: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in row.items() if value not in (None, '', [], False)}


def assign_icons(entries: list[dict[str, Any]]) -> tuple[int, int]:
    index = index_pngs(EXPORTS_ICONS)
    index.update(index_pngs(DATA_DIR / 'icons'))
    copied = 0
    missing = 0
    for entry in entries:
        chosen: str | None = None
        for icon in entry.pop('icons', []) or []:
            if index.get(icon.lower()):
                chosen = icon
                break
        entry['icon'] = chosen
        if chosen:
            copied += 1
        else:
            missing += 1
    return copied, missing


def parse_entry(
    path: Path,
    tables: dict[str, str],
    item_names: dict[str, str],
    item_icons_by_name: dict[str, str],
    item_icons_by_row: dict[str, str],
    ai_names: dict[str, str],
) -> dict[str, Any] | None:
    if path.stem in SKIP_STEMS or path.stem.startswith(SKIP_PREFIXES):
        return None
    category, subcategory = classify_path(path)
    uexp = path.with_suffix('.uexp')
    strings = extract_fstrings(uexp.read_bytes()) if uexp.exists() else []
    pid = persistence_id(strings)
    if not pid:
        return None
    asset_blob = path.read_bytes().decode('latin-1', errors='ignore')
    icons = texture_names(asset_blob)
    item_row = next((value for value in strings if value in item_names), None)
    row_key = item_row or pick_row_key(strings, path.stem)
    title_key = pick_title_key(strings)
    text_keys = pick_text_keys(strings, title_key)

    name = None
    if title_key and tables.get(title_key):
        name = tables[title_key]
    if not name and item_row:
        name = item_names[item_row]
    if not name and row_key and item_names.get(row_key):
        name = item_names[row_key]
    if not name and row_key:
        compact = re.sub(r'[^a-z0-9]+', '', row_key.lower())
        name = ai_names.get(row_key.lower()) or ai_names.get(compact)
    pages = [tables[key] for key in text_keys if tables.get(key)]
    if not pages:
        for value in strings:
            text = tables.get(value)
            if text and (' ' in text or len(text) > 24) and not looks_like_key(text):
                pages = [text]
                break
    fallback = name_from_stem(path.stem)
    if not name:
        name = fallback

    if name:
        icon = item_icons_by_name.get(name.lower())
        if icon and icon not in icons:
            icons.append(icon)
    if row_key:
        icon = item_icons_by_row.get(row_key.lower())
        if icon and icon not in icons:
            icons.append(icon)

    location = None
    for value in strings:
        if value in {'Brynmoor', 'Ghornfell', 'Ashenfall', 'Fellhollow', 'Umbral Sands', 'Whispering Swamp'}:
            location = value
            break

    group = None
    if title_key:
        parts = [part for part in title_key.replace('_DisplayName', '').split('.') if part]
        parts = [part for part in parts if part not in {'Title', 'Text', 'FemaleAuthor', 'Name'} and not part.isdigit()]
        if len(parts) >= 2:
            group = pretty_ident(parts[1])
        elif len(parts) == 1 and parts[0] not in {'One', 'Two', 'Three', 'Four', 'Five'}:
            group = pretty_ident(parts[0])

    if category == 'Deleted':
        category = 'Knowledge' if '_Know_' in path.stem else 'Recipes' if '_Recipes_' in path.stem or '_Recipe_' in path.stem else 'World'

    return {
        'persistenceId': pid,
        'name': name,
        'description': '\n\n'.join(pages) if pages else None,
        'pages': pages or None,
        'category': category if category in CATEGORY_ORDER else 'Knowledge',
        'subcategory': SUBCATEGORY_LABELS.get(subcategory, pretty_ident(subcategory)),
        'group': group,
        'location': location,
        'rowName': row_key,
        'sourceAsset': path.name,
        'deprecated': '/Deleted' in path.as_posix() or None,
        'icons': icons,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description='Normalize journal entry dumps into data/journal.json')
    parser.add_argument('--legacy-root', type=Path, default=LEGACY_ROOT)
    parser.add_argument('--st-root', type=Path, default=ST_ROOT)
    args = parser.parse_args()
    if not args.legacy_root.exists():
        print(f'Missing journal legacy root: {args.legacy_root}')
        return 1

    tables = load_st_tables(args.st_root)
    item_names, item_icons_by_name, item_icons_by_row = load_item_lookups()
    ai_names = load_ai_names()
    print(f'Loaded {len(tables)} string-table keys, {len(item_names)} item names')

    entries: list[dict[str, Any]] = []
    seen: set[str] = set()
    for path in sorted(args.legacy_root.rglob('JOURNAL_*.uasset')):
        row = parse_entry(path, tables, item_names, item_icons_by_name, item_icons_by_row, ai_names)
        if not row or row['persistenceId'] in seen:
            continue
        seen.add(row['persistenceId'])
        entries.append(row)

    entries.sort(key=lambda row: (
        CATEGORY_ORDER.index(row['category']) if row['category'] in CATEGORY_ORDER else 9,
        row.get('subcategory') or '',
        row.get('name') or '',
    ))
    copied, missing = assign_icons(entries)
    counts: dict[str, int] = defaultdict(int)
    for row in entries:
        counts[row['category']] += 1

    payload = {
        'meta': {
            'usmap': current_usmap_name(),
            'count': len(entries),
            'stringKeys': len(tables),
            'iconsCopied': copied,
            'iconsMissing': missing,
            'byCategory': dict(counts),
        },
        'entries': [slim(row) for row in entries],
    }
    out = DATA_DIR / 'journal.json'
    write_json(out, payload)
    print(f'Wrote {len(entries)} journal entries -> {out}')
    print(f'Icons: {copied} copied, {missing} missing')
    print('By category:', dict(counts))

    saves = list((Path(__file__).resolve().parents[2] / 'saves').rglob('Nate.json'))
    if saves:
        data = json.loads(saves[0].read_text(encoding='utf-8'))
        journal = data.get('Journal') or data.get('GameProgress', {}).get('Journal') or {}
        unlocked = [pid for pid in journal.get('UnlockedEntries') or [] if isinstance(pid, str)]
        known = {row['persistenceId'] for row in entries}
        hit = sum(1 for pid in unlocked if pid in known)
        print(f'Nate coverage: {hit}/{len(unlocked)} unlocked ids matched')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
