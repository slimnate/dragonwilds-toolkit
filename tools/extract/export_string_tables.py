"""Export item string tables and normalize display names.

Reads cooked ``ST_*.uexp`` files (retoc to-legacy). ``ST_ItemNames`` and
``ST_ItemNames_*`` contribute every key. Other tables contribute ``Name_*``
keys, which newer items (farming tools, compost, buildings) use instead of
the PascalCase ``ST_ItemNames`` keys.

UnrealExporter JSON under exports/stringtables/ is still merged when present.
"""

from __future__ import annotations

import argparse
import json
import struct
import subprocess
import sys
from pathlib import Path
from typing import Any

from common import (
    EXPORTS_STRINGTABLES,
    REPO_ROOT,
    STRINGTABLES_DIR,
    TOOLS_BIN,
    current_usmap_name,
    load_json,
    write_json,
)
from export_icons import (
    DEFAULT_PAKS,
    MAPPINGS_NAME,
    default_exporter_root,
    ensure_unreal_exporter,
    run_exporter,
    sync_usmap,
)

CONFIG_TEMPLATE = Path(__file__).resolve().parent / 'configs' / 'dragonwilds-stringtables.json'


def write_runtime_config(
    exporter_root: Path,
    *,
    game_path: Path,
    output_path: Path,
) -> Path:
    template = json.loads(CONFIG_TEMPLATE.read_text(encoding='utf-8'))
    template['GamePath'] = str(game_path.resolve()).replace('\\', '/')
    template['OutputPath'] = str(output_path.resolve()).replace('\\', '/')
    template['MappingFileName'] = MAPPINGS_NAME

    configs_dir = exporter_root / 'configs'
    configs_dir.mkdir(parents=True, exist_ok=True)
    dest = configs_dir / 'dragonwilds-stringtables.json'
    dest.write_text(json.dumps(template, indent=2) + '\n', encoding='utf-8')
    print(f'Wrote config {dest}')
    return dest


def _string_from_entry(entry: Any) -> str | None:
    if isinstance(entry, str) and entry.strip():
        return entry.strip()
    if isinstance(entry, dict):
        for key in ('SourceString', 'LocalizedString', 'CultureInvariantString', 'Text', 'Value'):
            val = entry.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()
            if isinstance(val, dict):
                nested = _string_from_entry(val)
                if nested:
                    return nested
    return None


def extract_names_map(data: Any) -> dict[str, str]:
    """Parse UnrealExporter string table JSON (KeysToEntries)."""
    names: dict[str, str] = {}

    def add(key: Any, value: Any) -> None:
        if key is None:
            return
        k = str(key).strip()
        v = _string_from_entry(value)
        if k and v:
            names[k] = v

    def ingest_keys_to_entries(container: Any) -> None:
        if isinstance(container, dict):
            for k, v in container.items():
                add(k, v)
        elif isinstance(container, list):
            for row in container:
                if isinstance(row, dict):
                    add(row.get('Key') or row.get('Name'), row.get('Value') or row.get('SourceString') or row)

    def walk(node: Any) -> None:
        if isinstance(node, list):
            for entry in node:
                walk(entry)
            return
        if not isinstance(node, dict):
            return

        # Preferred shape from UnrealExporter / CUE4Parse
        string_table = node.get('StringTable')
        if isinstance(string_table, dict):
            ingest_keys_to_entries(string_table.get('KeysToEntries'))
            ingest_keys_to_entries(string_table.get('KeysToMetaData'))

        props = node.get('Properties')
        if isinstance(props, dict):
            walk(props)

        # Direct KeysToEntries on this object
        if 'KeysToEntries' in node:
            ingest_keys_to_entries(node.get('KeysToEntries'))

        if 'Exports' in node:
            walk(node.get('Exports'))
        if 'names' in node and isinstance(node['names'], dict):
            ingest_keys_to_entries(node['names'])

    walk(data)
    return names


LEGACY_STRINGTABLES = REPO_ROOT / 'exports' / 'legacy_stringtables'
RETOC = TOOLS_BIN / 'retoc' / 'retoc.exe'
STRING_TABLE_FILTERS = (
    '/Gameplay/Items/ST_',
)


def find_st_item_names_json(root: Path) -> Path | None:
    matches = sorted(root.rglob('ST_ItemNames.json'))
    return matches[0] if matches else None


def _read_fstring(data: bytes, index: int) -> tuple[str | None, int]:
    if index + 4 > len(data):
        return None, index
    length = struct.unpack_from('<i', data, index)[0]
    if length == 0:
        return '', index + 4
    if length < 0:
        chars = -length
        nbytes = chars * 2
        if chars > 8192 or index + 4 + nbytes > len(data):
            return None, index
        text = data[index + 4:index + 4 + nbytes].decode('utf-16le', 'replace').rstrip('\x00')
        return text, index + 4 + nbytes
    if length > 8192 or index + 4 + length > len(data):
        return None, index
    raw = data[index + 4:index + 4 + length]
    if not raw.endswith(b'\x00'):
        return None, index
    return raw[:-1].decode('utf-8', 'replace'), index + 4 + length


def parse_string_table_uexp(path: Path) -> tuple[str, dict[str, str]]:
    """Decode a cooked string table. Header is 6 bytes, then name, count, pairs."""
    data = path.read_bytes()
    index = 6
    table_name, index = _read_fstring(data, index)
    if not table_name or index + 4 > len(data):
        raise ValueError(f'No string table header in {path}')
    count = struct.unpack_from('<I', data, index)[0]
    index += 4
    names: dict[str, str] = {}
    for _ in range(count):
        key, index = _read_fstring(data, index)
        value, index = _read_fstring(data, index)
        if key is None or value is None:
            raise ValueError(f'Short string table {path} after {len(names)} entries')
        if key and value:
            names[key] = value
    return table_name, names


def names_from_uexp_tables(root: Path) -> dict[str, str]:
    """Item titles from ST_ItemNames*, plus Name_* keys from the other tables."""
    names: dict[str, str] = {}
    if not root.exists():
        return names
    for path in sorted(root.rglob('ST_*.uexp')):
        table_name, entries = parse_string_table_uexp(path)
        if table_name.startswith('ST_ItemNames'):
            names.update(entries)
            print(f'  {path.name}: {table_name} +{len(entries)} titles')
            continue
        titled = {key: value for key, value in entries.items() if key.startswith('Name_')}
        names.update(titled)
        print(f'  {path.name}: {table_name} +{len(titled)} Name_ keys')
    return names


def retoc_string_tables(game_path: Path, dest: Path) -> None:
    if not RETOC.exists():
        raise SystemExit(f'retoc not found: {RETOC}')
    if not game_path.exists():
        raise SystemExit(f'Game path not found: {game_path}')
    dest.mkdir(parents=True, exist_ok=True)
    for asset_filter in STRING_TABLE_FILTERS:
        cmd = [
            str(RETOC), 'to-legacy', '--version', 'UE5_6',
            '--filter', asset_filter, str(game_path), str(dest),
        ]
        print('>', ' '.join(cmd))
        proc = subprocess.run(cmd, check=False)
        if proc.returncode != 0:
            raise SystemExit(proc.returncode)


def normalize_item_names(src_root: Path, out_path: Path, legacy_root: Path) -> int:
    names = names_from_uexp_tables(legacy_root)
    json_src = find_st_item_names_json(src_root)
    if json_src:
        exported = extract_names_map(load_json(json_src))
        # Cooked tables win on key clashes; JSON fills anything they missed.
        merged = dict(exported)
        merged.update(names)
        names = merged
        print(f'  merged UnrealExporter JSON {json_src.name} ({len(exported)} keys)')
    if not names:
        raise SystemExit(
            f'No item names under {legacy_root} or {src_root}. '
            'Re-extract string tables (export_string_tables.py).'
        )

    payload = {
        'meta': {
            'source': str(legacy_root.as_posix()),
            'usmap': current_usmap_name(),
            'count': len(names),
        },
        'names': dict(sorted(names.items(), key=lambda kv: kv[0].lower())),
    }
    write_json(out_path, payload)
    print(f'Wrote {len(names)} names -> {out_path}')
    return len(names)


def main() -> int:
    parser = argparse.ArgumentParser(description='Export/normalize item string tables for display titles')
    parser.add_argument('--game-path', type=Path, default=DEFAULT_PAKS)
    parser.add_argument('--out', type=Path, default=EXPORTS_STRINGTABLES)
    parser.add_argument('--legacy-root', type=Path, default=LEGACY_STRINGTABLES)
    parser.add_argument('--normalized', type=Path, default=STRINGTABLES_DIR / 'item_names.json')
    parser.add_argument('--exporter-root', type=Path, default=default_exporter_root())
    parser.add_argument('--force-download', action='store_true')
    parser.add_argument(
        '--skip-export',
        action='store_true',
        help='Only normalize existing cooked string tables / JSON',
    )
    parser.add_argument(
        '--unreal-exporter',
        action='store_true',
        help='Also dump string tables with UnrealExporter (needs a current usmap)',
    )
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    if not args.skip_export:
        if args.dry_run:
            print(f'Would extract string tables from {args.game_path} -> {args.legacy_root}')
            return 0
        retoc_string_tables(args.game_path, args.legacy_root)

    if args.unreal_exporter and not args.skip_export:
        if not args.game_path.exists():
            print(f'Game path not found: {args.game_path}', file=sys.stderr)
            return 1
        exe = ensure_unreal_exporter(args.exporter_root, force=args.force_download)
        exe_dir = exe.parent
        sync_usmap(exe_dir)
        args.out.mkdir(parents=True, exist_ok=True)
        config_path = write_runtime_config(exe_dir, game_path=args.game_path, output_path=args.out)
        cmd = [str(exe), config_path.name]
        print('>', ' '.join(cmd))
        if args.dry_run:
            return 0
        print('Launching UnrealExporter in a new console window…')
        code = run_exporter(cmd, exe_dir)
        if code != 0:
            print(f'UnrealExporter exited {code}', file=sys.stderr)
            return code

    if args.dry_run:
        return 0

    normalize_item_names(args.out, args.normalized, args.legacy_root)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
