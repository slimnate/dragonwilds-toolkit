"""Filter exported ITEM_*.json to inventory-like assets (copy or list)."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from common import BUILDING_KEYWORDS, EXPORTS_RAW, fmodel_props, is_junk_item_name, load_json


INVENTORY_KEYS = {
    'PersistenceID', 'ItemID', 'PersistentID',
    'Icon', 'Weight', 'MaxStackSize', 'BaseDurability',
    'PowerLevel', 'VitalShield', 'ItemFilterTags',
}


def looks_like_inventory(path: Path) -> bool:
    name = path.name
    if 'MeshData' in name or '_TEST_' in name.upper():
        return False
    if '/Deprecated/' in path.as_posix() or '\\Deprecated\\' in str(path):
        return False

    try:
        data = load_json(path)
    except Exception:
        return False

    props = fmodel_props(data)
    if props is not None:
        name_obj = props.get('Name') or {}
        display = ''
        if isinstance(name_obj, dict):
            display = (name_obj.get('SourceString') or name_obj.get('LocalizedString') or '')
        if is_junk_item_name(display) or is_junk_item_name(path.stem):
            return False
        if any(k in props for k in INVENTORY_KEYS):
            return True
        return False

    # UAssetAPI RawExport path: keep ITEM_ that aren't mesh/building by filename/path
    posix = path.as_posix().lower()
    if any(kw in posix for kw in BUILDING_KEYWORDS):
        return False
    if is_junk_item_name(path.stem):
        return False
    # Equipment MeshData companions often include MeshData in name — already filtered
    return path.name.upper().startswith('ITEM_')


def main() -> int:
    parser = argparse.ArgumentParser(description='Copy inventory-like ITEM_*.json exports')
    parser.add_argument('source', nargs='?', type=Path, default=EXPORTS_RAW)
    parser.add_argument('--target', type=Path, default=None)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    kept = skipped = 0
    for path in sorted(args.source.rglob('ITEM_*.json')):
        if not looks_like_inventory(path):
            skipped += 1
            if args.dry_run:
                print(f' skip {path.name}')
            continue
        kept += 1
        if args.target:
            dest = args.target / path.name
            if args.dry_run:
                print(f' keep {path.name}')
            else:
                args.target.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, dest)
        elif args.dry_run:
            print(f' keep {path.name}')

    print(f'Kept {kept}, skipped {skipped}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
