"""Build normalized data/recipes.json from RECIPE_*.json exports."""

from __future__ import annotations

import argparse
import base64
import datetime as dt
from pathlib import Path
from typing import Any

from common import (
    DATA_DIR,
    EXPORTS_RAW,
    ascii_runs,
    current_usmap_name,
    extract_fstrings,
    humanize_asset_name,
    item_container_refs,
    iter_json_files,
    load_json,
    namemap_item_assets,
    namemap_skills,
    namemap_station,
    pick_persistence_id,
    pick_row_name,
    station_icon_for,
    top_level_properties,
    write_json,
)


def asset_path_from_file(path: Path) -> str | None:
    posix = path.as_posix()
    if '/RSDragonwilds/' in posix:
        return 'RSDragonwilds/' + posix.split('/RSDragonwilds/', 1)[1].replace('.json', '.uasset')
    return None


_RECIPE_PREFIXES = (
    'process_',
    'create_',
    'cook_',
    'craft_',
    'journal_',
)
_TOKEN_NOISE = {
    'process',
    'create',
    'cook',
    'craft',
    'resources',
    'item',
    'recipe',
    'journal',
    'materials',
    'basic',
    'fuel',
}


def _recipe_stem_parts(self_name: str) -> tuple[set[str], set[str], set[str]]:
    """Split RECIPE_* stem into product / from / full token sets.

    For ``RECIPE_Process_Wax_Gypsum_From_Ground_Gypsum`` the product side is
    ``wax_gypsum`` and the from side is ``ground_gypsum``. Token overlap with
    the product side is the primary signal for the crafted output.
    """
    stem = self_name.replace('RECIPE_', '').lower()
    for prefix in _RECIPE_PREFIXES:
        if stem.startswith(prefix):
            stem = stem[len(prefix):]
            break

    product_part = stem
    from_part = ''
    if '_from_' in stem:
        product_part, from_part = stem.split('_from_', 1)

    def toks(part: str) -> set[str]:
        return {t for t in part.split('_') if t and t not in _TOKEN_NOISE}

    product = toks(product_part)
    frm = toks(from_part)
    full = toks(stem)
    return product, frm, full


def _asset_token_flat(asset: str) -> tuple[set[str], str]:
    tokens = {
        t for t in asset.replace('ITEM_', '').lower().split('_')
        if t and t not in _TOKEN_NOISE
    }
    return tokens, ''.join(tokens)


def _token_hits(needles: set[str], hay_tokens: set[str], hay_flat: str) -> int:
    hits = 0
    for t in needles:
        if t in hay_tokens or (len(t) >= 3 and t in hay_flat):
            hits += 1
    return hits


def pick_recipe_output(self_name: str, item_assets: list[str]) -> str | None:
    """Choose crafted output among NameMap ITEM_ refs.

    ``*_From_*`` recipes often share tokens between product and ingredient
    (e.g. gypsum in both Wax Gypsum and Ground Gypsum). Prefer the product
    side of the stem; break remaining ties with NameMap order (later = output).
    """
    if not item_assets:
        return None

    product, frm, full = _recipe_stem_parts(self_name)
    scored: list[tuple[int, int, str]] = []
    for idx, asset in enumerate(item_assets):
        tokens, flat = _asset_token_flat(asset)
        product_hits = _token_hits(product, tokens, flat)
        from_hits = _token_hits(frm, tokens, flat)
        full_hits = _token_hits(full, tokens, flat)
        # Weight product matches heavily; penalize looking like the "from" input.
        score = product_hits * 10 + full_hits - from_hits * 5
        low = asset.lower()
        if 'burnt' in low or '_raw_' in low or low.endswith('_raw'):
            score -= 20
        scored.append((score, idx, asset))

    scored.sort(key=lambda t: (-t[0], -t[1]))
    best_score, _, best = scored[0]
    if best_score > 0:
        return best

    # Fallback: first non-burnt / non-raw, else first NameMap item.
    for asset in item_assets:
        low = asset.lower()
        if 'burnt' in low or '_raw_' in low or low.endswith('_raw'):
            continue
        return asset
    return item_assets[0]


def parse_recipe(path: Path, item_by_asset: dict[str, str]) -> dict[str, Any] | None:
    data = load_json(path)
    if not isinstance(data, dict):
        return None

    namemap = data.get('NameMap') or []
    self_name = path.stem
    item_assets = namemap_item_assets(namemap, self_name=self_name)
    skills = namemap_skills(namemap)

    strings: list[str] = []
    exports = data.get('Exports') or []
    if exports:
        raw = exports[0].get('Data')
        if isinstance(raw, str):
            try:
                raw_bytes = base64.b64decode(raw)
                strings = extract_fstrings(raw_bytes) + ascii_runs(raw_bytes)
            except Exception:
                strings = []

    props = top_level_properties(data)
    pid = props.get('PersistenceID') if isinstance(props.get('PersistenceID'), str) else None
    row = props.get('InternalName') if isinstance(props.get('InternalName'), str) else None
    if not pid:
        pid = pick_persistence_id(strings)
    if not row:
        row = pick_row_name(strings)
    if not pid:
        return None

    asset_path = asset_path_from_file(path)
    station_tag, station = namemap_station(namemap, self_name=self_name, asset_path=asset_path or '')

    created = item_container_refs(data, props.get('ItemsCreated'))
    consumed = item_container_refs(data, props.get('ItemsConsumed'))
    output_count = None
    ingredient_counts: list[int] = []
    if created:
        output = created[0][0]
        output_count = created[0][1]
        ingredients = [asset for asset, _count in consumed]
        ingredient_counts = [count for _asset, count in consumed]
    else:
        output = pick_recipe_output(self_name, item_assets)
        ingredients = [a for a in item_assets if a != output]

    out_pid = item_by_asset.get(output) if output else None
    ing_pids = [item_by_asset[a] for a in ingredients if a in item_by_asset]

    name = humanize_asset_name(row or self_name)
    return {
        'persistenceId': pid,
        'rowName': row,
        'name': name,
        'skill': skills[0] if skills else None,
        'station': station,
        'stationTag': station_tag,
        'stationIcon': station_icon_for(station),
        'outputItemAsset': output,
        'outputPersistenceId': out_pid,
        'outputCount': output_count,
        'ingredientItemAssets': ingredients,
        'ingredientCounts': ingredient_counts or None,
        'ingredientPersistenceIds': ing_pids,
        'sourceAsset': path.name,
        'assetPath': asset_path,
    }


def load_item_asset_index(items_path: Path) -> dict[str, str]:
    """Map ITEM_* stem -> persistenceId from items.json."""
    if not items_path.exists():
        return {}
    data = load_json(items_path)
    items = data.get('items') if isinstance(data, dict) else data
    out: dict[str, str] = {}
    if not isinstance(items, list):
        return out
    for it in items:
        src = it.get('sourceAsset') or it.get('assetPath') or ''
        stem = Path(str(src)).stem
        if stem.startswith('ITEM_') and it.get('persistenceId'):
            out[stem] = it['persistenceId']
        # Also index by assetPath basename
        ap = it.get('assetPath')
        if ap:
            stem2 = Path(ap).stem
            if stem2.startswith('ITEM_') and it.get('persistenceId'):
                out[stem2] = it['persistenceId']
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description='Build data/recipes.json')
    parser.add_argument('--raw-root', type=Path, default=EXPORTS_RAW)
    parser.add_argument('--items', type=Path, default=DATA_DIR / 'items.json')
    parser.add_argument('--out', type=Path, default=DATA_DIR / 'recipes.json')
    args = parser.parse_args()

    item_by_asset = load_item_asset_index(args.items)
    files = iter_json_files(args.raw_root, 'RECIPE_')
    print(f'Scanning {len(files)} RECIPE_ json files')

    by_pid: dict[str, dict[str, Any]] = {}
    skipped = 0
    for path in files:
        # Skip pure journal UI packages? Keep them — they still unlock recipes.
        try:
            recipe = parse_recipe(path, item_by_asset)
        except Exception as exc:  # noqa: BLE001
            print(f' skip {path.name}: {exc}')
            skipped += 1
            continue
        if not recipe:
            skipped += 1
            continue
        by_pid[recipe['persistenceId']] = {k: v for k, v in recipe.items() if v is not None and v != []}

    recipes = list(by_pid.values())
    recipes.sort(key=lambda r: (r.get('name') or '').lower())

    # Cross-link report
    missing_outputs = sum(1 for r in recipes if r.get('outputItemAsset') and not r.get('outputPersistenceId'))
    payload = {
        'meta': {
            'game': 'RSDragonwilds',
            'usmap': current_usmap_name(),
            'generatedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
            'recipeCount': len(recipes),
            'rawFilesScanned': len(files),
            'skipped': skipped,
            'unresolvedOutputIds': missing_outputs,
        },
        'recipes': recipes,
    }
    write_json(args.out, payload)
    print(f'Wrote {len(recipes)} recipes -> {args.out} (unresolved outputs: {missing_outputs})')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
