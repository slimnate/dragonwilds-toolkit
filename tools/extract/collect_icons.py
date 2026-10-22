"""Copy item-referenced icon PNGs from exports/icons into data/icons/.

Reads unique `icon` basenames from data/items.json, finds matching files under
exports/icons/ (recursive), and copies them flat into data/icons/{basename}.
Prints coverage and lists missing icons. Soft-fails (exit 0) when some icons
are missing so the JSON pipeline can still complete; use --strict to fail.

When an exact basename is missing, tries versioned suffixes (`_1`) and a
conservative edit-distance match for author typos (e.g. Cadaverberry vs
Cadavaberry). Fuzzy hits are copied under the *requested* basename so the
viewer path stays stable.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

from common import DATA_DIR, EXPORTS_ICONS, ICONS_DIR, _edit_distance, load_json, write_json


def index_pngs(root: Path) -> dict[str, list[Path]]:
    """Map lowercase basename -> all matching paths."""
    by_name: dict[str, list[Path]] = {}
    if not root.exists():
        return by_name
    for path in root.rglob('*.png'):
        by_name.setdefault(path.name.lower(), []).append(path)
    return by_name


def collect_needed_icons(items_path: Path, recipes_path: Path | None = None) -> list[str]:
    data = load_json(items_path)
    items = data.get('items') if isinstance(data, dict) else None
    if not isinstance(items, list):
        raise SystemExit(f'Unexpected items shape in {items_path}')
    names: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        icon = item.get('icon')
        if isinstance(icon, str) and icon.lower().endswith('.png'):
            names.add(icon)
    if recipes_path and recipes_path.exists():
        recipes_data = load_json(recipes_path)
        recipes = recipes_data.get('recipes') if isinstance(recipes_data, dict) else None
        if isinstance(recipes, list):
            for recipe in recipes:
                if not isinstance(recipe, dict):
                    continue
                icon = recipe.get('stationIcon')
                if isinstance(icon, str) and icon.lower().endswith('.png'):
                    names.add(icon)
    return sorted(names)


def prefer_icon_path(matches: list[Path]) -> Path:
    """Prefer game UI icons over marketplace / skill charger duplicates."""

    def score(path: Path) -> tuple[int, int, str]:
        parts = path.as_posix().lower()
        rank = 0
        if '/art/ui/icons/seeds/' in parts:
            rank += 120
        if '/art/ui/icons/' in parts:
            rank += 100
        if '/plugins/marketplace/' in parts:
            rank -= 50
        if '/skill_chargers/' in parts:
            rank -= 20
        if '/skills/' in parts or '/tags/' in parts:
            rank -= 40
        if '/potion_inventory_big/' in parts:
            rank -= 5
        # Prefer shorter paths (usually the canonical inventory icon)
        return (-rank, len(parts), parts)

    return sorted(matches, key=score)[0]


def resolve_icon_source(
    name: str,
    indexed: dict[str, list[Path]],
) -> tuple[Path | None, str | None]:
    """Return (source path, resolution note). Note is set when not an exact match."""
    key = name.lower()
    matches = indexed.get(key, [])
    if matches:
        return (prefer_icon_path(matches) if len(matches) > 1 else matches[0]), None

    stem = Path(name).stem
    stem_l = stem.lower()
    for suffix in ('_1', '_2', '_v2', '_v3'):
        alt = f'{stem_l}{suffix}.png'
        matches = indexed.get(alt, [])
        if matches:
            chosen = prefer_icon_path(matches) if len(matches) > 1 else matches[0]
            return chosen, f'versioned:{chosen.name}'

    # Conservative typo match on long T_Icon_* stems only.
    if len(stem_l) < 10:
        return None, None
    best_dist = 99
    best_key: str | None = None
    ties = 0
    for other_key in indexed:
        other_stem = Path(other_key).stem
        if not other_stem.lower().startswith('t_icon'):
            continue
        dist = _edit_distance(stem_l, other_stem.lower())
        if dist > 2 or dist == 0:
            continue
        if dist < best_dist:
            best_dist = dist
            best_key = other_key
            ties = 1
        elif dist == best_dist:
            ties += 1
    if best_key and ties == 1:
        matches = indexed[best_key]
        chosen = prefer_icon_path(matches) if len(matches) > 1 else matches[0]
        return chosen, f'fuzzy:{chosen.name}'
    return None, None


def main() -> int:
    parser = argparse.ArgumentParser(description='Collect item icons into data/icons/')
    parser.add_argument('--items', type=Path, default=DATA_DIR / 'items.json')
    parser.add_argument('--recipes', type=Path, default=DATA_DIR / 'recipes.json')
    parser.add_argument('--src', type=Path, default=EXPORTS_ICONS)
    parser.add_argument('--out', type=Path, default=ICONS_DIR)
    parser.add_argument(
        '--report',
        type=Path,
        default=DATA_DIR / 'icon_coverage.json',
        help='Write coverage JSON report',
    )
    parser.add_argument('--strict', action='store_true', help='Exit 1 if any icon is missing')
    parser.add_argument('--clean', action='store_true', help='Remove existing data/icons/*.png first')
    args = parser.parse_args()

    if not args.items.exists():
        print(f'Missing items JSON: {args.items}', file=sys.stderr)
        return 1

    needed = collect_needed_icons(args.items, args.recipes)
    indexed = index_pngs(args.src)
    args.out.mkdir(parents=True, exist_ok=True)

    if args.clean:
        for old in args.out.glob('*.png'):
            old.unlink()

    copied: list[str] = []
    missing: list[str] = []
    ambiguous: list[dict[str, object]] = []
    resolved: list[dict[str, str]] = []

    for name in needed:
        src, note = resolve_icon_source(name, indexed)
        if src is None:
            missing.append(name)
            continue
        exact_matches = indexed.get(name.lower(), [])
        if len(exact_matches) > 1 and note is None:
            ambiguous.append({
                'icon': name,
                'chosen': str(src.relative_to(args.src)),
                'paths': [str(p.relative_to(args.src)) for p in exact_matches],
            })
        if note:
            resolved.append({
                'requested': name,
                'resolved': note,
                'source': str(src.relative_to(args.src)),
            })
        # Keep viewer path = requested basename (even when source file was typo/versioned).
        dest = args.out / name
        shutil.copy2(src, dest)
        copied.append(name)

    report = {
        'needed': len(needed),
        'copied': len(copied),
        'missing': len(missing),
        'ambiguous': len(ambiguous),
        'resolved': len(resolved),
        'src': str(args.src),
        'out': str(args.out),
        'missingIcons': missing,
        'ambiguousIcons': ambiguous,
        'resolvedIcons': resolved,
    }
    write_json(args.report, report)

    print(
        f'Icons: {len(copied)}/{len(needed)} copied -> {args.out} '
        f'(missing {len(missing)}, ambiguous {len(ambiguous)}, resolved {len(resolved)})'
    )
    if missing:
        preview = ', '.join(missing[:12])
        more = f' (+{len(missing) - 12} more)' if len(missing) > 12 else ''
        print(f'Missing: {preview}{more}')
    if resolved:
        preview = ', '.join(f"{r['requested']}->{r['resolved']}" for r in resolved[:6])
        more = f' (+{len(resolved) - 6} more)' if len(resolved) > 6 else ''
        print(f'Resolved: {preview}{more}')
    print(f'Report: {args.report}')

    if args.strict and missing:
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
