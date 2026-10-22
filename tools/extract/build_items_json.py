"""Build normalized data/items.json from exports and optional bootstrap ItemID.json."""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import re
from pathlib import Path
from typing import Any

from combat_stats import apply_combat_stats, attach_refs_during_parse
from common import (
    DATA_DIR,
    EXPORTS_LEGACY,
    EXPORTS_RAW,
    REPO_ROOT,
    STRINGTABLES_DIR,
    ascii_runs,
    as_number,
    categorize_from_name,
    categorize_from_path,
    collect_tag_names,
    current_usmap_name,
    display_name_from_props,
    extract_fstrings,
    fmodel_props,
    hint_token_order,
    humanize_asset_name,
    icon_from_namemap,
    icon_from_object_ref,
    is_junk_item_name,
    iter_json_files,
    load_json,
    persistence_from_props,
    pick_display_name_from_strings,
    pick_persistence_id,
    pick_row_name,
    soft_object_basename,
    top_level_properties,
    write_json,
)
from export_combat_tables import COMBAT_DATA_DIR, load_combat_tables
from inventory_props import (
    build_bootstrap_indexes,
    index_items_into_families,
    resolve_inventory_props,
)


def looks_like_junk_display(s: str) -> bool:
    if not s or len(s) < 2:
        return True
    compact = s.replace(' ', '')
    # Hex / GUID fragments mis-decoded as names
    if re.fullmatch(r'[0-9A-F ]{8,}', s, flags=re.I):
        return True
    if re.fullmatch(r'[0-9A-Fa-f-]{16,}', compact):
        return True
    if s.count(' ') >= 3 and all(len(p) <= 4 for p in s.split()):
        return True
    return False


def load_item_names_table(path: Path) -> dict[str, str]:
    """Load data/stringtables/item_names.json -> key/rowName -> display name."""
    if not path.exists():
        return {}
    data = load_json(path)
    if isinstance(data, dict) and isinstance(data.get('names'), dict):
        return {str(k): str(v) for k, v in data['names'].items() if v}
    if isinstance(data, dict):
        return {str(k): str(v) for k, v in data.items() if isinstance(v, str) and v}
    return {}


def _name_from_embedded_keys(item: dict[str, Any], names: dict[str, str]) -> str | None:
    """Match Name_* keys stored on the asset to ST_Farming / ST_ItemNames_SW."""
    raw_keys = item.get('stringKeys')
    if not isinstance(raw_keys, list):
        return None
    hints = set(hint_token_order(
        item.get('rowName') if isinstance(item.get('rowName'), str) else None,
        item.get('sourceAsset') if isinstance(item.get('sourceAsset'), str) else None,
    ))
    best: tuple[int, str] | None = None
    for key in raw_keys:
        if not isinstance(key, str) or not key.startswith('Name_'):
            continue
        value = names.get(key)
        if not value:
            continue
        overlap = len(hints & set(hint_token_order(key)))
        if best is None or overlap > best[0]:
            best = (overlap, value)
    return best[1] if best else None


def row_to_pascal_key(row: str) -> str | None:
    """Convert rowName like res_adhesive_acrid -> AdhesiveAcrid (ST_ItemNames key shape)."""
    cleaned = re.sub(
        r'^(weap_|ammo_|food_|potion_|armour_|armor_|res_|resource_|recipe_|mat_|item_)',
        '',
        row,
        flags=re.I,
    )
    parts = [p for p in cleaned.split('_') if p]
    if not parts:
        return None
    return ''.join(p[:1].upper() + p[1:] for p in parts)


def resolve_string_table_name(item: dict[str, Any], names: dict[str, str]) -> str | None:
    if not names:
        return None
    name_key = item.get('_nameKey')
    if isinstance(name_key, str) and names.get(name_key):
        return names[name_key]
    lower_map = {k.lower(): v for k, v in names.items()}
    embedded = _name_from_embedded_keys(item, names)
    if embedded:
        return embedded
    keys: list[str] = []
    row = item.get('rowName')
    if isinstance(row, str) and row:
        keys.append(row)
        pascal = row_to_pascal_key(row)
        if pascal:
            keys.append(pascal)
    stem = (item.get('sourceAsset') or '').replace('.json', '').replace('.uasset', '')
    if stem:
        keys.append(stem)
        stripped = re.sub(r'^ITEM_', '', stem)
        keys.append(stripped)
        # ITEM_Resources_Adhesive_Acrid -> AdhesiveAcrid (last meaningful tokens)
        parts = [p for p in stripped.split('_') if p and p.lower() not in {
            'resources', 'resource', 'consumables', 'equipment', 'quest', 'ammo', 'weapons',
        }]
        if parts:
            keys.append(''.join(p[:1].upper() + p[1:] for p in parts))
            # Also try without category-ish prefixes already stripped: last 2–4 tokens
            for n in (2, 3, 4):
                if len(parts) >= n:
                    keys.append(''.join(p[:1].upper() + p[1:] for p in parts[-n:]))
    name = item.get('name')
    if isinstance(name, str) and name:
        keys.append(name.replace(' ', ''))

    seen: set[str] = set()
    for key in keys:
        if not key or key in seen:
            continue
        seen.add(key)
        if key in names:
            return names[key]
        hit = lower_map.get(key.lower())
        if hit:
            return hit
    return None


def parse_uassetapi_item(path: Path) -> dict[str, Any] | None:
    data = load_json(path)
    if not isinstance(data, dict) or 'Exports' not in data:
        return None

    # relative asset path guess
    asset_path = None
    posix = path.as_posix()
    marker = '/RSDragonwilds/'
    if marker in posix:
        asset_path = 'RSDragonwilds/' + posix.split(marker, 1)[1].replace('.json', '.uasset')
    elif 'Gameplay' in posix:
        idx = posix.lower().find('/gameplay/')
        if idx >= 0:
            asset_path = 'RSDragonwilds/Content' + posix[idx:].replace('.json', '.uasset')

    exports = data.get('Exports') or []
    if not exports:
        return None
    primary = exports[0]
    raw = primary.get('Data')
    strings: list[str] = []
    if isinstance(raw, str):
        try:
            raw_bytes = base64.b64decode(raw)
            strings = extract_fstrings(raw_bytes) + ascii_runs(raw_bytes)
        except Exception:
            strings = []

    pid = pick_persistence_id(strings)
    row = pick_row_name(strings)
    namemap = data.get('NameMap') or []

    display = pick_display_name_from_strings(
        strings,
        row=row,
        asset_stem=path.stem,
        looks_like_junk_display=looks_like_junk_display,
    )
    if not display or looks_like_junk_display(display):
        display = humanize_asset_name(row or path.stem)

    if is_junk_item_name(display) or is_junk_item_name(path.stem):
        return None
    if 'MeshData' in path.name:
        return None

    cat, sub = categorize_from_path(asset_path or path.as_posix(), path.stem)
    if cat == 'Misc':
        cat, sub = categorize_from_name(display + ' ' + path.stem)

    # Path-based subcategory beats Held default for ammo/bait under Held/
    tags = []
    for s in namemap:
        if isinstance(s, str) and s.startswith('Item.'):
            tags.append(s)
    if any('Ammo' in t or 'Bait' in t for t in tags):
        cat, sub = 'Ammo', None

    icon = icon_from_namemap(namemap, row, path.stem, display)
    string_keys = [
        s for s in strings
        if isinstance(s, str) and 0 < len(s) <= 96 and ' ' not in s and '/' not in s
    ]
    props = top_level_properties(data)
    item_numbers: dict[str, int | float] = {}
    name_key: str | None = None
    if props:
        prop_pid = props.get('PersistenceID')
        if isinstance(prop_pid, str) and prop_pid:
            pid = prop_pid
        prop_row = props.get('InternalName')
        if isinstance(prop_row, str) and prop_row:
            row = prop_row
        prop_name = props.get('Name')
        if isinstance(prop_name, str) and prop_name and prop_name not in string_keys:
            string_keys.append(prop_name)
        if isinstance(prop_name, str) and prop_name:
            name_key = prop_name
        prop_icon = soft_object_basename(props.get('Icon'))
        if prop_icon:
            icon = prop_icon
        for src_key, dst_key in (
            ('Weight', 'weight'),
            ('MaxStackSize', 'maxStackSize'),
            ('VitalShield', 'vitalShield'),
            ('PowerLevel', 'powerLevel'),
            ('BaseDurability', 'baseDurability'),
        ):
            number = as_number(props.get(src_key))
            if number is not None:
                item_numbers[dst_key] = number
        for tag in collect_tag_names(props.get('Category')) + collect_tag_names(props.get('ItemFilterTags')):
            if tag not in tags:
                tags.append(tag)

    item = {
        'persistenceId': pid,
        'name': display,
        'rowName': row,
        'category': cat,
        'subcategory': sub,
        'tags': tags,
        'icon': icon,
        'weight': item_numbers.get('weight'),
        'maxStackSize': item_numbers.get('maxStackSize'),
        'vitalShield': item_numbers.get('vitalShield'),
        'powerLevel': item_numbers.get('powerLevel'),
        'baseDurability': item_numbers.get('baseDurability'),
        'sourceAsset': path.name,
        'assetPath': asset_path,
        'stringKeys': string_keys,
        '_nameKey': name_key,
        '_source': 'uassetapi',
    }
    attach_refs_during_parse(item, namemap if isinstance(namemap, list) else None)
    return item


def parse_fmodel_item(path: Path) -> dict[str, Any] | None:
    data = load_json(path)
    props = fmodel_props(data)
    if props is None:
        return None
    name = display_name_from_props(props) or humanize_asset_name(path.stem)
    if is_junk_item_name(name):
        return None
    pid = persistence_from_props(props)
    if not pid:
        return None

    tags_raw = props.get('ItemFilterTags') or props.get('GameplayTags') or []
    tags: list[str] = []
    if isinstance(tags_raw, list):
        for t in tags_raw:
            if isinstance(t, str):
                tags.append(t)
            elif isinstance(t, dict) and 'TagName' in t:
                tags.append(str(t['TagName']))

    asset_path = path.as_posix()
    cat, sub = categorize_from_path(asset_path, path.stem)
    if cat == 'Misc':
        cat, sub = categorize_from_name(name + ' ' + path.stem)

    namemap = data.get('NameMap') if isinstance(data, dict) else None
    icon = icon_from_object_ref(props.get('Icon'))
    if not icon and isinstance(namemap, list):
        icon = icon_from_namemap(namemap, path.stem, name)

    item: dict[str, Any] = {
        'persistenceId': pid,
        'name': name,
        'category': cat,
        'subcategory': sub,
        'weight': props.get('Weight'),
        'maxStackSize': props.get('MaxStackSize'),
        'vitalShield': props.get('VitalShield'),
        'icon': icon,
        'tags': tags,
        'sourceAsset': path.name,
        'assetPath': None,
        '_source': 'fmodel',
    }
    if 'PowerLevel' in props:
        item['powerLevel'] = props['PowerLevel']
    if props.get('BaseDurability'):
        item['baseDurability'] = props['BaseDurability']
    attach_refs_during_parse(item, namemap if isinstance(namemap, list) else None)
    return item


def load_bootstrap(path: Path) -> dict[str, dict[str, Any]]:
    data = load_json(path)
    out: dict[str, dict[str, Any]] = {}
    if not isinstance(data, list):
        return out
    for entry in data:
        pid = entry.get('PersistenceID')
        if not pid:
            continue
        out[pid] = entry
    return out


def path_index_from_legacy() -> dict[str, str]:
    """Map ITEM_ stem -> package path."""
    idx: dict[str, str] = {}
    if not EXPORTS_LEGACY.exists():
        return idx
    for p in EXPORTS_LEGACY.rglob('ITEM_*.uasset'):
        rel = p.as_posix()
        if '/RSDragonwilds/' in rel:
            idx[p.stem] = 'RSDragonwilds/' + rel.split('/RSDragonwilds/', 1)[1]
        else:
            idx[p.stem] = rel
    return idx


def merge_bootstrap(item: dict[str, Any], boot: dict[str, Any] | None) -> dict[str, Any]:
    if not boot:
        return item
    item['name'] = boot.get('SourceString') or item.get('name')
    for src_key, dst_key in (
        ('Weight', 'weight'),
        ('MaxStackSize', 'maxStackSize'),
        ('VitalShield', 'vitalShield'),
        ('PowerLevel', 'powerLevel'),
        ('BaseDurability', 'baseDurability'),
        ('IconFile', 'icon'),
    ):
        if boot.get(src_key) is not None and item.get(dst_key) is None:
            item[dst_key] = boot[src_key]
    return item


def finalize_item(item: dict[str, Any]) -> dict[str, Any]:
    item.pop('_source', None)
    item.pop('stringKeys', None)
    item.pop('_nameKey', None)
    # Drop nulls for cleaner JSON
    return {k: v for k, v in item.items() if v is not None and v != []}


def main() -> int:
    parser = argparse.ArgumentParser(description='Build data/items.json')
    parser.add_argument('--raw-root', type=Path, default=EXPORTS_RAW)
    parser.add_argument('--bootstrap', type=Path, default=REPO_ROOT / 'exports' / '_bootstrap_ItemID.json')
    parser.add_argument(
        '--item-names',
        type=Path,
        default=STRINGTABLES_DIR / 'item_names.json',
        help='Normalized ST_ItemNames map (key -> display name)',
    )
    parser.add_argument('--out', type=Path, default=DATA_DIR / 'items.json')
    parser.add_argument('--by-category-dir', type=Path, default=DATA_DIR / 'by-category')
    args = parser.parse_args()

    bootstrap = load_bootstrap(args.bootstrap) if args.bootstrap.exists() else {}
    item_names = load_item_names_table(args.item_names)
    legacy_paths = path_index_from_legacy()
    combat_tables = load_combat_tables(COMBAT_DATA_DIR)
    combat_ready = bool(
        combat_tables.get('powerCurves')
        or combat_tables.get('wearable')
        or combat_tables.get('damageNegation')
    )

    by_pid: dict[str, dict[str, Any]] = {}
    skipped = 0
    names_from_table = 0
    combat_enriched = 0
    inventory_filled_fields = 0
    inventory_touched = 0

    files = iter_json_files(args.raw_root, 'ITEM_')
    files_by_name = {p.name: p for p in files}
    print(f'Scanning {len(files)} ITEM_ json files under {args.raw_root}')
    if item_names:
        print(f'Loaded {len(item_names)} ST_ItemNames entries from {args.item_names}')
    if combat_ready:
        print(
            f'Loaded combat tables from {COMBAT_DATA_DIR} '
            f'(curves={len(combat_tables.get("powerCurves") or {})}, '
            f'negation={len(combat_tables.get("damageNegation") or {})}, '
            f'wearable={len(combat_tables.get("wearable") or {})})'
        )
    else:
        print(f'No combat tables in {COMBAT_DATA_DIR} (run export_combat_tables.py)')
    print(f'Bootstrap entries: {len(bootstrap)}')

    for path in files:
        item = parse_fmodel_item(path)
        if item is None:
            item = parse_uassetapi_item(path)
        if item is None:
            skipped += 1
            continue

        # Attach package path from legacy extract when missing
        if not item.get('assetPath') and path.stem in legacy_paths:
            item['assetPath'] = legacy_paths[path.stem]
            cat, sub = categorize_from_path(item['assetPath'], path.stem)
            if cat != 'Misc' or not item.get('category') or item.get('category') == 'Misc':
                item['category'], item['subcategory'] = cat, sub

        pid = item.get('persistenceId')
        if not pid:
            # Try bootstrap match by exact name later — skip for now
            skipped += 1
            continue

        item = merge_bootstrap(item, bootstrap.get(pid))
        # Prefer path category over weak bootstrap "Basic Item", but keep tag-driven Ammo/Food
        tags = item.get('tags') or []
        tag_cat = None
        if any('Item.Food' in t or t.endswith('.Food') for t in tags):
            tag_cat = ('Consumables', 'Food')
        elif any('Ammo' in t or 'Bait' in t for t in tags):
            tag_cat = ('Ammo', None)
        elif any('Potion' in t for t in tags):
            tag_cat = ('Consumables', 'Potions')

        if tag_cat:
            item['category'], item['subcategory'] = tag_cat
        elif item.get('assetPath'):
            cat, sub = categorize_from_path(item['assetPath'], path.stem)
            if cat != 'Misc':
                item['category'], item['subcategory'] = cat, sub

        # Name priority: bootstrap SourceString > ST_ItemNames > parsed display > humanize fallback
        boot = bootstrap.get(pid) or {}
        st_name = resolve_string_table_name(item, item_names)
        if boot.get('SourceString'):
            item['name'] = boot['SourceString']
        elif st_name:
            item['name'] = st_name
            names_from_table += 1
        elif looks_like_junk_display(item.get('name') or ''):
            item['name'] = humanize_asset_name(item.get('rowName') or path.stem)
        item['name'] = re.sub(r'\s+', ' ', item.get('name') or '').strip()

        # If still no icon, try NameMap again after bootstrap (no-op if already set)
        if not item.get('icon'):
            # Re-load namemap only when needed is expensive; icon already set in parsers.
            pass

        prev = by_pid.get(pid)
        if prev is None or (prev.get('weight') is None and item.get('weight') is not None):
            by_pid[pid] = item

    # Add bootstrap-only entries not found in exports (still useful)
    for pid, boot in bootstrap.items():
        if pid in by_pid:
            continue
        name = boot.get('SourceString') or pid
        cat, sub = categorize_from_name(name)
        item = {
            'persistenceId': pid,
            'name': name,
            'category': cat,
            'subcategory': sub,
            'weight': boot.get('Weight'),
            'maxStackSize': boot.get('MaxStackSize'),
            'vitalShield': boot.get('VitalShield'),
            'powerLevel': boot.get('PowerLevel'),
            'baseDurability': boot.get('BaseDurability'),
            'icon': boot.get('IconFile'),
            'sourceAsset': None,
            'tags': [],
        }
        st_name = resolve_string_table_name(item, item_names)
        if st_name and not boot.get('SourceString'):
            item['name'] = st_name
            names_from_table += 1
        by_pid[pid] = item

    # Fill missing weight/stack/durability from RawExport, name/family bootstrap, role heuristics.
    boot_indexes = build_bootstrap_indexes(bootstrap)
    by_family = index_items_into_families(list(by_pid.values()), bootstrap)
    for item in by_pid.values():
        raw_bytes = None
        src = item.get('sourceAsset')
        needs_raw = (
            item.get('weight') is None
            or item.get('maxStackSize') is None
            or (
                item.get('category') in {'Weapons', 'Armour', 'Tools', 'Jewellery'}
                and item.get('baseDurability') is None
            )
        )
        if needs_raw and src and src in files_by_name:
            try:
                data = load_json(files_by_name[src])
                exports = data.get('Exports') if isinstance(data, dict) else None
                if isinstance(exports, list) and exports:
                    blob = exports[0].get('Data')
                    if isinstance(blob, str):
                        raw_bytes = base64.b64decode(blob)
            except Exception:
                raw_bytes = None
        added = resolve_inventory_props(
            item,
            bootstrap=bootstrap,
            by_name=boot_indexes['by_name'],
            by_family=by_family,
            raw_bytes=raw_bytes,
        )
        if added:
            inventory_filled_fields += added
            inventory_touched += 1

    if combat_ready:
        for item in by_pid.values():
            before = (
                item.get('weaponPower'),
                item.get('damageNegation'),
                item.get('defense'),
            )
            apply_combat_stats(item, combat_tables)
            after = (
                item.get('weaponPower'),
                item.get('damageNegation'),
                item.get('defense'),
            )
            if after != before and any(after):
                combat_enriched += 1

    items = [finalize_item(v) for v in by_pid.values()]
    items.sort(key=lambda x: (x.get('name') or '').lower())

    with_icon = sum(1 for i in items if i.get('icon'))
    with_weight = sum(1 for i in items if i.get('weight') is not None)
    with_stack = sum(1 for i in items if i.get('maxStackSize') is not None)
    with_dur = sum(1 for i in items if i.get('baseDurability') is not None)
    payload = {
        'meta': {
            'game': 'RSDragonwilds',
            'usmap': current_usmap_name(),
            'generatedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
            'itemCount': len(items),
            'rawFilesScanned': len(files),
            'skipped': skipped,
            'bootstrapCount': len(bootstrap),
            'stringTableNames': len(item_names),
            'namesFromStringTable': names_from_table,
            'itemsWithIcon': with_icon,
            'itemsWithWeight': with_weight,
            'itemsWithStack': with_stack,
            'itemsWithDurability': with_dur,
            'inventoryPropsTouched': inventory_touched,
            'inventoryPropsFieldsFilled': inventory_filled_fields,
            'combatEnriched': combat_enriched,
        },
        'items': items,
    }
    write_json(args.out, payload)
    print(
        f'Wrote {len(items)} items -> {args.out} '
        f'(icons {with_icon}, weight {with_weight}, stack {with_stack}, dur {with_dur}, '
        f'ST names {names_from_table}, combat {combat_enriched})'
    )

    # Optional split by category
    if args.by_category_dir:
        args.by_category_dir.mkdir(parents=True, exist_ok=True)
        buckets: dict[str, list[dict[str, Any]]] = {}
        for it in items:
            buckets.setdefault(it.get('category') or 'Misc', []).append(it)
        for cat, rows in buckets.items():
            write_json(args.by_category_dir / f'{cat}.json', rows)
        print(f'Wrote {len(buckets)} category files -> {args.by_category_dir}')

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
