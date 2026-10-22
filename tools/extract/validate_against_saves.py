"""Validate data/items.json and data/recipes.json against character saves."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

from common import DATA_DIR, REPO_ROOT, load_json


def _progress_containers(save: dict) -> list[dict]:
    containers: list[dict] = []
    if isinstance(save.get('Progress'), dict):
        containers.append(save['Progress'])
    game_progress = save.get('GameProgress')
    if isinstance(game_progress, dict) and isinstance(game_progress.get('Progress'), dict):
        containers.append(game_progress['Progress'])
    return containers


def _iter_inventory_slots(node: object) -> list[dict]:
    slots: list[dict] = []
    if isinstance(node, list):
        for slot in node:
            if isinstance(slot, dict):
                slots.append(slot)
    elif isinstance(node, dict):
        if 'ItemData' in node:
            slots.append(node)
        else:
            for val in node.values():
                slots.extend(_iter_inventory_slots(val))
    return slots


def collect_inventory_item_ids(save: dict) -> set[str]:
    ids: set[str] = set()
    roots: list[dict] = [save]
    game_progress = save.get('GameProgress')
    if isinstance(game_progress, dict):
        roots.append(game_progress)
    for root in roots:
        for key in ('Inventory', 'PersonalInventory', 'Loadout'):
            for slot in _iter_inventory_slots(root.get(key)):
                pid = slot.get('ItemData')
                if isinstance(pid, str) and pid:
                    ids.add(pid)
    return ids


def collect_picked_up_item_ids(save: dict) -> set[str]:
    ids: set[str] = set()
    for progress in _progress_containers(save):
        for key in ('ItemsPickedUp', 'MilestoneMaterialsPickedUp'):
            for pid in progress.get(key) or []:
                if isinstance(pid, str) and pid:
                    ids.add(pid)
    return ids


def collect_recipe_ids(save: dict) -> set[str]:
    ids: set[str] = set()
    for container in (save, *_progress_containers(save)):
        for key in ('RecipesUnlocked', 'RecipesNew'):
            for pid in container.get(key) or []:
                if isinstance(pid, str) and pid:
                    ids.add(pid)
    return ids


def main() -> int:
    parser = argparse.ArgumentParser(description='Validate extracted JSON against saves')
    parser.add_argument('--items', type=Path, default=DATA_DIR / 'items.json')
    parser.add_argument('--recipes', type=Path, default=DATA_DIR / 'recipes.json')
    default_saves = [
        p for p in (REPO_ROOT / 'saves').rglob('*.json')
        if p.parent.name == 'SaveCharacters'
        and '.verbackup' not in p.name
        and not p.name.endswith('.backup')
    ]
    parser.add_argument('--saves', type=Path, nargs='*', default=default_saves)
    args = parser.parse_args()

    items_data = load_json(args.items)
    items = items_data.get('items') if isinstance(items_data, dict) else items_data
    item_ids = {it['persistenceId'] for it in items if it.get('persistenceId')}

    recipe_ids: set[str] = set()
    if args.recipes.exists():
        recipes_data = load_json(args.recipes)
        recipes = recipes_data.get('recipes') if isinstance(recipes_data, dict) else recipes_data
        recipe_ids = {r['persistenceId'] for r in recipes if r.get('persistenceId')}

    inv_ids: set[str] = set()
    picked_ids: set[str] = set()
    save_recipe_ids: set[str] = set()
    save_files = [
        p for p in args.saves
        if p.exists() and not p.name.endswith('.backup') and '.verbackup' not in p.name
    ]
    for path in save_files:
        try:
            save = load_json(path)
        except Exception as exc:  # noqa: BLE001
            print(f'Could not read {path}: {exc}')
            continue
        if not isinstance(save, dict):
            continue
        inv_ids |= collect_inventory_item_ids(save)
        picked_ids |= collect_picked_up_item_ids(save)
        save_recipe_ids |= collect_recipe_ids(save)

    missing_inventory = sorted(inv_ids - item_ids)
    missing_picked = sorted(picked_ids - item_ids)
    missing_recipes = sorted(save_recipe_ids - recipe_ids) if recipe_ids else []
    cats = Counter((it.get('category') or 'Misc') for it in items)

    print(f'Items in DB: {len(item_ids)}')
    print(f'Recipes in DB: {len(recipe_ids)}')
    print(f'Save files: {len(save_files)}')
    print(f'Inventory/loadout ItemData ids: {len(inv_ids)}')
    print(f'ItemsPickedUp ids: {len(picked_ids)}')
    print(f'Recipe ids in saves: {len(save_recipe_ids)}')
    print(f'Missing inventory items: {len(missing_inventory)}')
    for pid in missing_inventory[:30]:
        print(f'  inv {pid}')
    print(f'Missing picked-up-only ids (often deprecated/world): {len(missing_picked)}')
    for pid in missing_picked[:30]:
        print(f'  picked {pid}')
    if recipe_ids:
        print(f'Missing recipes: {len(missing_recipes)}')
        for pid in missing_recipes[:30]:
            print(f'  recipe {pid}')
    print('Category counts:')
    for cat, n in sorted(cats.items(), key=lambda t: (-t[1], t[0])):
        print(f'  {cat}: {n}')

    report = {
        'itemCount': len(item_ids),
        'recipeCount': len(recipe_ids),
        'inventoryItemIds': len(inv_ids),
        'pickedUpItemIds': len(picked_ids),
        'saveRecipeIds': len(save_recipe_ids),
        'missingInventoryItems': missing_inventory,
        'missingPickedUpItems': missing_picked,
        'missingRecipes': missing_recipes,
        'categories': dict(cats),
    }
    out = DATA_DIR / 'validation_report.json'
    out.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(f'Wrote {out}')

    # Fail only if current inventory/loadout items are missing.
    # Some RecipesUnlocked IDs are absent from RECIPE_* assets (retired/vendor/other).
    if missing_recipes:
        coverage = 1.0 - (len(missing_recipes) / max(1, len(save_recipe_ids)))
        print(f'Recipe coverage vs saves: {coverage:.1%}')
    return 1 if missing_inventory else 0


if __name__ == '__main__':
    raise SystemExit(main())
