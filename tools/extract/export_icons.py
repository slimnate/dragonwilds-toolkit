"""Export item icon textures as PNG via UnrealExporter (CUE4Parse).

Downloads UnrealExporter into tools/bin/ on first run (gitignored), syncs the
current usmap into its mappings folder, then exports icon textures into
exports/icons/ (gitignored). Run collect_icons.py afterward to copy basenames
referenced by data/items.json into data/icons/.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

from common import EXPORTS_ICONS, TOOLS_BIN, USMAP_DIR, current_usmap_name

UNREAL_EXPORTER_VERSION = '2.0.0'
UNREAL_EXPORTER_URL = (
    f'https://github.com/whotookzakum/UnrealExporter/releases/download/'
    f'v{UNREAL_EXPORTER_VERSION}/UnrealExporter-{UNREAL_EXPORTER_VERSION}.zip'
)
DEFAULT_PAKS = Path(
    r'C:\Program Files (x86)\Steam\steamapps\common\RSDragonwilds'
    r'\RSDragonwilds\Content\Paks'
)
CONFIG_TEMPLATE = Path(__file__).resolve().parent / 'configs' / 'dragonwilds-icons.json'
MAPPINGS_NAME = 'RSDragonwilds.usmap'


def default_exporter_root() -> Path:
    return TOOLS_BIN / 'UnrealExporter'


def find_exporter_exe(root: Path) -> Path | None:
    direct = root / 'UnrealExporter.exe'
    if direct.exists():
        return direct
    matches = sorted(root.rglob('UnrealExporter.exe'))
    return matches[0] if matches else None


def ensure_unreal_exporter(root: Path, force: bool = False) -> Path:
    exe = find_exporter_exe(root)
    if exe and not force:
        return exe

    root.mkdir(parents=True, exist_ok=True)
    zip_path = TOOLS_BIN / f'UnrealExporter-{UNREAL_EXPORTER_VERSION}.zip'
    if force or not zip_path.exists():
        print(f'Downloading UnrealExporter {UNREAL_EXPORTER_VERSION}…')
        urllib.request.urlretrieve(UNREAL_EXPORTER_URL, zip_path)

    print(f'Extracting {zip_path.name} -> {root}')
    if root.exists() and force:
        shutil.rmtree(root)
    root.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, 'r') as zf:
        zf.extractall(root)

    exe = find_exporter_exe(root)
    if not exe:
        raise SystemExit(f'UnrealExporter.exe not found under {root} after extract')
    return exe


def sync_usmap(exporter_root: Path) -> Path:
    usmaps = sorted(USMAP_DIR.glob('*.usmap'))
    if not usmaps:
        raise SystemExit(f'No .usmap in {USMAP_DIR}')
    src = usmaps[-1]
    mappings_dir = exporter_root / 'mappings'
    mappings_dir.mkdir(parents=True, exist_ok=True)
    dest = mappings_dir / MAPPINGS_NAME
    if not dest.exists() or dest.stat().st_size != src.stat().st_size:
        dest.write_bytes(src.read_bytes())
        print(f'Synced usmap {src.name} -> {dest}')
    else:
        print(f'Usmap already current: {dest.name} ({current_usmap_name()})')
    return dest


def write_runtime_config(
    exporter_root: Path,
    *,
    game_path: Path,
    output_path: Path,
    template_path: Path,
) -> Path:
    template = json.loads(template_path.read_text(encoding='utf-8'))
    template['GamePath'] = str(game_path.resolve()).replace('\\', '/')
    template['OutputPath'] = str(output_path.resolve()).replace('\\', '/')
    template['MappingFileName'] = MAPPINGS_NAME

    configs_dir = exporter_root / 'configs'
    configs_dir.mkdir(parents=True, exist_ok=True)
    dest = configs_dir / template_path.name
    dest.write_text(json.dumps(template, indent=2) + '\n', encoding='utf-8')
    print(f'Wrote config {dest}')
    return dest


def run_exporter(cmd: list[str], cwd: Path) -> int:
    """Run UnrealExporter in a new console.

    Spectre.Console calls AnsiConsole.Clear() on startup; that throws
    'The handle is invalid' when stdin/stdout are not a real Windows console
    (e.g. some IDE / redirected shells). CREATE_NEW_CONSOLE avoids that.
    """
    creationflags = 0
    if sys.platform == 'win32':
        creationflags = subprocess.CREATE_NEW_CONSOLE  # type: ignore[attr-defined]
    proc = subprocess.run(cmd, cwd=str(cwd), check=False, creationflags=creationflags)
    return proc.returncode


def main() -> int:
    parser = argparse.ArgumentParser(description='Export Dragonwilds icon textures as PNG')
    parser.add_argument(
        '--game-path',
        type=Path,
        default=DEFAULT_PAKS,
        help='Game root or Content/Paks directory',
    )
    parser.add_argument('--out', type=Path, default=EXPORTS_ICONS, help='PNG output root')
    parser.add_argument('--exporter-root', type=Path, default=default_exporter_root())
    parser.add_argument('--force-download', action='store_true')
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Download/sync/write config only; do not run UnrealExporter',
    )
    parser.add_argument(
        '--config',
        type=Path,
        default=CONFIG_TEMPLATE,
        help='UnrealExporter config template (default: all icons)',
    )
    args = parser.parse_args()

    if not args.game_path.exists():
        print(f'Game path not found: {args.game_path}', file=sys.stderr)
        print('Pass --game-path to your RSDragonwilds Content/Paks folder.', file=sys.stderr)
        return 1
    if not args.config.exists():
        print(f'Missing config template: {args.config}', file=sys.stderr)
        return 1

    exe = ensure_unreal_exporter(args.exporter_root, force=args.force_download)
    # UnrealExporter resolves configs/mappings relative to the exe directory
    exe_dir = exe.parent
    sync_usmap(exe_dir)
    args.out.mkdir(parents=True, exist_ok=True)
    config_path = write_runtime_config(
        exe_dir,
        game_path=args.game_path,
        output_path=args.out,
        template_path=args.config,
    )

    cmd = [str(exe), config_path.name]
    print('>', ' '.join(cmd))
    print(f'  (cwd={exe_dir})')
    if args.dry_run:
        print('Dry run — skipping UnrealExporter invoke')
        return 0

    print('Launching UnrealExporter in a new console window…')
    code = run_exporter(cmd, exe_dir)
    if code != 0:
        print(f'UnrealExporter exited {code}', file=sys.stderr)
        return code

    pngs = list(args.out.rglob('*.png'))
    print(f'Export finished: {len(pngs)} PNG(s) under {args.out}')
    if not pngs:
        print(
            'No PNGs found. Check the UnrealExporter console for errors '
            '(engine version, mappings, export path regex).',
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
