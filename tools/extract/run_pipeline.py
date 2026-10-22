"""Run the full extract pipeline.

`--from-game` pulls ITEM_, RECIPE_, combat tables, and string tables out of
the installed paks with retoc (UE 5.6) before the normalizers run.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parents[1]
RETOC = REPO_ROOT / 'tools' / 'bin' / 'retoc' / 'retoc.exe'
DEFAULT_PAKS = Path(
    r'C:\Program Files (x86)\Steam\steamapps\common\RSDragonwilds'
    r'\RSDragonwilds\Content\Paks'
)
COMBAT_FILTERS = (
    '/DT_PlayerWeaponPowerLevels.uasset',
    '/DT_PlayerDamageNegation.uasset',
    '/DT_WearableEquipment.uasset',
    '/ST_WeaponAttacks.uasset',
)
BUILDING_FILTERS = (
    '/DA_BaseBuilding_',
    '/BUILDPIECE_',
)


def run(cmd: list[str]) -> None:
    print('>', ' '.join(cmd))
    proc = subprocess.run(cmd, cwd=str(ROOT), check=False)
    if proc.returncode != 0:
        raise SystemExit(proc.returncode)


def resolve_paks(path: Path) -> Path:
    if (path / 'RSDragonwilds-Windows.utoc').exists():
        return path
    for candidate in (
        path / 'RSDragonwilds' / 'Content' / 'Paks',
        path / 'Content' / 'Paks',
    ):
        if (candidate / 'RSDragonwilds-Windows.utoc').exists():
            return candidate
    return path


def retoc_extract(paks: Path, asset_filter: str, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    run([
        str(RETOC), 'to-legacy', '--version', 'UE5_6',
        '--filter', asset_filter, str(paks), str(dest),
    ])


def extract_from_game(paks: Path, workers: int) -> None:
    if not RETOC.exists():
        raise SystemExit(f'retoc not found: {RETOC}')
    if not paks.exists():
        raise SystemExit(f'Game path not found: {paks}')

    legacy = REPO_ROOT / 'exports' / 'legacy'
    raw = REPO_ROOT / 'exports' / 'raw'
    if legacy.exists():
        shutil.rmtree(legacy)
    for child in ('Gameplay', 'RSDragonwilds'):
        path = raw / child
        if path.exists():
            shutil.rmtree(path)

    retoc_extract(paks, '/ITEM_', legacy)
    retoc_extract(paks, '/RECIPE_', legacy)
    run([sys.executable, 'batch_tojson.py', '--prefix', 'ITEM_', '--prefix', 'RECIPE_', '--workers', str(workers)])

    combat = REPO_ROOT / 'exports' / 'legacy_combat'
    if combat.exists():
        shutil.rmtree(combat)
    for asset_filter in COMBAT_FILTERS:
        retoc_extract(paks, asset_filter, combat)
    run([
        sys.executable, 'batch_tojson.py',
        '--legacy-root', str(combat),
        '--out-root', str(combat),
        '--prefix', 'DT_', '--prefix', 'ST_',
        '--workers', '4', '--force',
    ])

    progress_legacy = REPO_ROOT / 'exports' / 'legacy_progress'
    progress_raw = REPO_ROOT / 'exports' / 'raw_progress'
    for asset_filter in BUILDING_FILTERS:
        retoc_extract(paks, asset_filter, progress_legacy)
    run([
        sys.executable, 'batch_tojson.py',
        '--legacy-root', str(progress_legacy),
        '--out-root', str(progress_raw),
        '--prefix', 'DA_', '--prefix', 'BUILDPIECE_',
        '--workers', str(workers), '--force',
    ])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        '--from-game',
        action='store_true',
        help='retoc the installed paks (ITEM_, RECIPE_, combat, buildings) before normalizing',
    )
    parser.add_argument(
        '--game-path',
        default=None,
        help='Game root or Content/Paks. Also passed to icon / string-table export',
    )
    parser.add_argument('--skip-tojson', action='store_true')
    parser.add_argument('--skip-icons', action='store_true', help='Skip icon export + collect')
    parser.add_argument(
        '--skip-icon-export',
        action='store_true',
        help='Skip UnrealExporter; only collect from existing exports/icons',
    )
    parser.add_argument(
        '--skip-string-tables',
        action='store_true',
        help='Skip ST_ItemNames export/normalize',
    )
    parser.add_argument(
        '--skip-string-table-export',
        action='store_true',
        help='Skip retoc for string tables; only normalize existing cooked tables',
    )
    parser.add_argument(
        '--skip-combat-tables',
        action='store_true',
        help='Skip export_combat_tables.py (uses existing data/combat if present)',
    )
    parser.add_argument('--workers', type=int, default=8)
    args = parser.parse_args()

    py = sys.executable
    paks = resolve_paks(Path(args.game_path) if args.game_path else DEFAULT_PAKS)
    if args.from_game:
        extract_from_game(paks, args.workers)
    elif not args.skip_tojson:
        run([py, 'batch_tojson.py', '--prefix', 'ITEM_', '--prefix', 'RECIPE_', '--workers', str(args.workers)])

    if not args.skip_string_tables:
        st_cmd = [py, 'export_string_tables.py']
        if args.game_path:
            st_cmd.extend(['--game-path', args.game_path])
        if args.skip_string_table_export:
            st_cmd.append('--skip-export')
        run(st_cmd)

    if not args.skip_combat_tables:
        run([py, 'export_combat_tables.py'])

    run([py, 'build_items_json.py'])
    run([py, 'build_recipes_json.py'])
    progress_raw = REPO_ROOT / 'exports' / 'raw_progress'
    if progress_raw.exists():
        run([py, 'build_progress_json.py'])

    if not args.skip_icons:
        if not args.skip_icon_export:
            export_cmd = [py, 'export_icons.py']
            if args.game_path:
                export_cmd.extend(['--game-path', args.game_path])
            run(export_cmd)
        run([py, 'collect_icons.py', '--clean'])

    run([py, 'validate_against_saves.py'])
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
