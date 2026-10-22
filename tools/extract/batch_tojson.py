"""Batch-convert legacy .uasset files to UAssetAPI JSON via UAssetGUI."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from common import EXPORTS_LEGACY, EXPORTS_RAW, REPO_ROOT, USMAP_DIR


def default_uassetgui() -> Path:
    return REPO_ROOT / 'tools' / 'bin' / 'UAssetGUI.exe'


def ensure_mappings(usmap: Path) -> str:
    # UAssetGUI reads %LOCALAPPDATA%\UAssetGUI\Mappings, not the Roaming AppData folder.
    maps_dir = Path(os.environ.get('LOCALAPPDATA', '')) / 'UAssetGUI' / 'Mappings'
    maps_dir.mkdir(parents=True, exist_ok=True)
    dest = maps_dir / 'RSDragonwilds.usmap'
    if not dest.exists() or dest.stat().st_size != usmap.stat().st_size:
        dest.write_bytes(usmap.read_bytes())
    return 'RSDragonwilds'


def is_raw_export(path: Path) -> bool:
    """True when UAssetGUI fell back to an unparsed export.

    Parallel UAssetGUI processes sometimes miss the mappings file and emit
    RawExport for assets that deserialize on a second pass.
    """
    if not path.exists() or path.stat().st_size == 0:
        return False
    text = path.read_bytes()
    return b'ExportTypes.RawExport' in text and b'ExportTypes.NormalExport' not in text and b'ExportTypes.DataTableExport' not in text


def convert_one(uag: Path, src: Path, dst: Path, version: str, mappings: str) -> tuple[Path, bool, str]:
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        proc = subprocess.run(
            [str(uag), 'tojson', str(src), str(dst), version, mappings],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        ok = dst.exists() and dst.stat().st_size > 0 and proc.returncode == 0
        msg = (proc.stderr or proc.stdout or '').strip()
        return src, ok, msg
    except Exception as exc:  # noqa: BLE001
        return src, False, str(exc)


def main() -> int:
    parser = argparse.ArgumentParser(description='Batch UAssetGUI tojson for ITEM_/RECIPE_ assets')
    parser.add_argument('--legacy-root', type=Path, default=EXPORTS_LEGACY)
    parser.add_argument('--out-root', type=Path, default=EXPORTS_RAW / 'Gameplay')
    parser.add_argument('--prefix', action='append', default=None, help='ITEM_ and/or RECIPE_ (default both)')
    parser.add_argument('--uassetgui', type=Path, default=default_uassetgui())
    parser.add_argument('--version', default='VER_UE5_6')
    parser.add_argument('--workers', type=int, default=6)
    parser.add_argument('--limit', type=int, default=0)
    parser.add_argument('--force', action='store_true')
    parser.add_argument(
        '--retry-raw',
        action='store_true',
        help='Reconvert outputs that are still RawExport, one at a time',
    )
    args = parser.parse_args()

    prefixes = args.prefix or ['ITEM_', 'RECIPE_']
    usmaps = sorted(USMAP_DIR.glob('*.usmap'))
    if not usmaps:
        print('No .usmap in usmap/', file=sys.stderr)
        return 1
    if not args.uassetgui.exists():
        print(f'UAssetGUI not found: {args.uassetgui}', file=sys.stderr)
        return 1

    mappings = ensure_mappings(usmaps[-1])
    assets: list[Path] = []
    for prefix in prefixes:
        assets.extend(sorted(args.legacy_root.rglob(f'{prefix}*.uasset')))
    if args.limit:
        assets = assets[: args.limit]

    # Preserve relative path under RSDragonwilds/ when present
    jobs: list[tuple[Path, Path]] = []
    for src in assets:
        rel = src.relative_to(args.legacy_root)
        dst = args.out_root / rel.with_suffix('.json')
        if args.retry_raw:
            if is_raw_export(dst):
                jobs.append((src, dst))
            continue
        if dst.exists() and not args.force:
            continue
        jobs.append((src, dst))

    print(f'Converting {len(jobs)} / {len(assets)} assets (workers={args.workers})')
    ok_n = fail_n = 0
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = [
            pool.submit(convert_one, args.uassetgui, src, dst, args.version, mappings)
            for src, dst in jobs
        ]
        for i, fut in enumerate(as_completed(futures), 1):
            src, ok, msg = fut.result()
            if ok:
                ok_n += 1
            else:
                fail_n += 1
                print(f'FAIL {src.name}: {msg}')
            if i % 100 == 0 or i == len(futures):
                print(f'  progress {i}/{len(futures)} ok={ok_n} fail={fail_n}')

    if args.workers > 1:
        leftover = [(src, dst) for src, dst in jobs if is_raw_export(dst)]
        if leftover:
            print(f'Retrying {len(leftover)} RawExport files one at a time')
            still_raw = 0
            for index, (src, dst) in enumerate(leftover, 1):
                _src, ok, msg = convert_one(args.uassetgui, src, dst, args.version, mappings)
                if not ok:
                    fail_n += 1
                    print(f'FAIL {src.name}: {msg}')
                elif is_raw_export(dst):
                    still_raw += 1
                if index % 100 == 0 or index == len(leftover):
                    print(f'  retry {index}/{len(leftover)} still_raw={still_raw}')
            if still_raw:
                print(f'{still_raw} files stayed RawExport after retry')

    print(f'Done. ok={ok_n} fail={fail_n} out={args.out_root}')
    return 0 if fail_n == 0 else 2


if __name__ == '__main__':
    raise SystemExit(main())
