# Item & recipe data extraction (RuneScape: Dragonwilds)

Extract inventory items and crafting recipes from cooked game assets into normalized JSON under [`data/`](../data/).

For FModel browsing, see the [FModel guide](https://github.com/slimnate/rsdw-mods/blob/main/docs/fmodel-guide.md). Schema: [`data/schema.md`](../data/schema.md). Asset map: [`data/ASSET_INDEX.md`](../data/ASSET_INDEX.md).

## Outputs

| File | Contents |
|---|---|
| [`data/items.json`](../data/items.json) | ~1.1k items keyed by `persistenceId` (save `ItemData`) |
| [`data/recipes.json`](../data/recipes.json) | ~1k recipes keyed by `persistenceId` (save `Progress.RecipesUnlocked`) |
| [`data/by-category/*.json`](../data/by-category/) | Items split by category |
| [`data/stringtables/item_names.json`](../data/stringtables/item_names.json) | Normalized `ST_ItemNames` key → display title |
| [`data/icons/`](../data/icons/) | PNG icons referenced by `items[].icon` (committed; refresh after patches) |
| [`data/icon_coverage.json`](../data/icon_coverage.json) | Collect report: copied / missing / ambiguous |
| [`data/validation_report.json`](../data/validation_report.json) | Coverage vs local character saves |

Local modding/reference only — respect [Jagex modding guidelines](https://legal.jagex.com/docs/policies/runescape-dragonwilds-community-modding-guidelines). Do not redistribute ripped art as a paid product.

## Prerequisites

1. Game install with `RSDragonwilds/Content/Paks/`
2. Current `.usmap` in [`usmap/`](../usmap/) (re-dump with UE4SS after patches — [debug tools](https://github.com/slimnate/rsdw-mods/blob/main/docs/ue4ss-debug-tools.md))
3. Python 3.12+
4. Tools (downloaded once into `tools/bin/`, gitignored):
   - [retoc](https://github.com/trumank/retoc/releases) — `tools/bin/retoc/retoc.exe`
   - [UAssetGUI](https://github.com/atenfyr/UAssetGUI/releases) — `tools/bin/UAssetGUI.exe`
   - [UnrealExporter](https://github.com/whotookzakum/UnrealExporter/releases) — auto-downloaded by `export_icons.py` / `export_string_tables.py` into `tools/bin/UnrealExporter/`

Optional: [FModel](https://github.com/slimnate/rsdw-mods/blob/main/docs/fmodel-guide.md) Raw JSON export of `Gameplay` also works with the same Python normalizers (`Properties` shape).

## Refresh after a game patch

```powershell
# From repo root
$paks = "C:\Program Files (x86)\Steam\steamapps\common\RSDragonwilds\RSDragonwilds\Content\Paks"
$retoc = ".\tools\bin\retoc\retoc.exe"
$legacy = ".\exports\legacy"

# 1) Re-dump usmap into usmap\ (batch_tojson copies it to %LOCALAPPDATA%\UAssetGUI\Mappings\)
# 2) Re-extract ITEM_ / RECIPE_ as legacy assets
& $retoc to-legacy --version UE5_6 --filter "/ITEM_" $paks $legacy
& $retoc to-legacy --version UE5_6 --filter "/RECIPE_" $paks $legacy

# 3) Convert + normalize (+ string tables + icon PNG export/collect)
Set-Location .\tools\extract
python run_pipeline.py --from-game --workers 10
```

Or step-by-step:

```powershell
python batch_tojson.py --prefix ITEM_ --prefix RECIPE_ --workers 10
python export_string_tables.py  # ST_ItemNames -> data/stringtables/item_names.json
python build_items_json.py
python build_recipes_json.py
python export_icons.py          # UnrealExporter -> exports/icons/ (opens a console window)
python collect_icons.py --clean # -> data/icons/ + data/icon_coverage.json
python validate_against_saves.py
```

Icon-only / string-table-only refresh:

```powershell
python export_string_tables.py
python build_items_json.py
python export_icons.py
python collect_icons.py --clean
# Reuse existing dumps:
python export_string_tables.py --skip-export
python run_pipeline.py --skip-tojson --skip-icon-export --skip-string-table-export
```

If `python` is the Windows Store stub, use the real interpreter, e.g. `%LOCALAPPDATA%\Programs\Python\Python312\python.exe`.

`exports/` and `tools/bin/` are gitignored. Commit updated `data/*.json`, `data/stringtables/`, and `data/icons/` when the dump looks good.

Validation expectations:

- **Inventory/loadout** ItemData IDs should all resolve (exit code 0 requires this).
- **RecipesUnlocked** may include IDs not present as `RECIPE_*` assets (retired/vendor/other) — coverage ~90%+ is normal; see `data/validation_report.json`.
- **ItemsPickedUp** can reference deprecated world/interactable ids outside the item catalog.

## Pipeline

```text
Content/Paks (IoStore)
  -> retoc to-legacy (ITEM_ / RECIPE_)
  -> UAssetGUI tojson (VER_UE5_6 + usmap)
  -> retoc ST_ItemNames, ST_Farming, ST_ItemNames_SW, and the other Gameplay/Items string tables
  -> normalize Name_* + ST_ItemNames keys -> data/stringtables/item_names.json
  -> build_items_json.py / build_recipes_json.py
  -> data/items.json + data/recipes.json
  -> UnrealExporter (icon textures -> PNG in exports/icons/)
  -> collect_icons.py -> data/icons/ (+ icon_coverage.json)
  -> validate_against_saves.py
```

Combat DataTables (`export_combat_tables.py`) run before `build_items_json.py` when `exports/legacy_combat/` is present, writing `data/combat/`.

### Display names

Priority when building an item:

1. Bootstrap `SourceString` (if present)
2. **`ST_ItemNames`** via [`data/stringtables/item_names.json`](../data/stringtables/item_names.json) (keys are usually PascalCase like `AdhesiveAcrid` → `Acrid Adhesive`)
3. RawExport CamelCase FStrings (prefer display-order over asset/row token order when both exist)
4. Humanized `rowName` / asset stem fallback

Many Blueprints are UAssetAPI `RawExport` only. Do **not** trust naive `humanize(rowName)` alone — that produced wrong titles like "Adhesive Acrid" instead of "Acrid Adhesive".

### Categories

Path under the package wins over name heuristics:

- `Equipment/Head|Body|Legs|Cape` → Armour; `Jewellery`, `Ammo` as named
- **`Equipment/Held` is not always a weapon.** Subfolders first:
  - `Farming/Seeds`, `TreePlanting`, or `*seed*` → Resources / Seeds
  - `Shovel`, `FishingRod`, `FishingNet`, `Bucket`, `Pickaxe`, `Hatchet`, `Torch`, `Hammer`, other `Farming/` tools → Tools (`spade` counts as a shovel synonym)
  - Remaining Held gear → Weapons (Melee / Ranged / Magic by name)
- `Items/Resources/…`, Consumables, Quest/Key, etc. as before

### Combat stats

Flat “Damage” / “Defense” are **not** on each `ITEM_*`. The pipeline joins shared DataTables from `exports/legacy_combat/` (via `export_combat_tables.py` → `data/combat/`):

| Table | Joined as |
|---|---|
| `DT_PlayerWeaponPowerLevels` | `weaponPower` from `powerLevel` + `Weapons`/`Bows` curve |
| `DT_PlayerDamageNegation` | `damageNegation` from `weaponFamily` + `powerLevel` |
| `DT_WearableEquipment` | `defense.*` from `wearableRow` (NameMap) |
| `ST_WeaponAttacks` | `abilities.specialName` for uniques |

Also from each item NameMap: `damageTypes`, `abilities` (`PA_Attack_*` / block / magic), `combatSkills`.

Refresh combat tables after a balance patch:

```powershell
# retoc-filter those DT_/ST_WeaponAttacks paths into exports/legacy_combat, tojson them, then:
python export_combat_tables.py
python build_items_json.py
```

### Icons

Sources (first wins after merge):

1. FModel `Properties.Icon` / bootstrap `IconFile`
2. **NameMap `T_Icon_*` soft refs** — scored against row/asset tokens with near-typo matching; prefers `Art/UI/Icons` (especially `…/Seeds/`); heavily penalizes skill-tag chrome (`T_Icon_Tag_*`, `/Skills/`, `/Tags/`)

Then `collect_icons.py` copies basenames into `data/icons/`. If the exact file is missing it may resolve versioned (`_1`) or unique edit-distance near-matches and still write the **requested** filename.

Notes:

- Inventory fields (`weight`, `maxStackSize`, `vitalShield`, `baseDurability`) come from, in order:
  1. FModel `Properties` when present
  2. Bootstrap [`exports/_bootstrap_ItemID.json`](../exports/_bootstrap_ItemID.json) by `persistenceId`
  3. Bootstrap by display name (incl. Cooling variants)
  4. Sibling inference (same weapon/armour family across materials/tiers)
  5. Role heuristics (ammo stacks, infusions, fish food, capes, seeds, …)
  6. Conservative RawExport decode when PowerLevel/stack anchors are clear
- Many RawExports omit default-equal properties (sparse unversioned serialization), so siblings/heuristics are required for DLC/newer items.
- Icon export config: [`tools/extract/configs/dragonwilds-icons.json`](../tools/extract/configs/dragonwilds-icons.json). String tables: [`tools/extract/configs/dragonwilds-stringtables.json`](../tools/extract/configs/dragonwilds-stringtables.json).
- `export_icons.py` opens a **new console window** on Windows (Spectre.Console). `export_string_tables.py` reads cooked tables with retoc unless `--unreal-exporter` is set.
- After a patch: re-run string tables + icons, then commit `data/stringtables/`, `data/icons/`, and JSON dumps.

## Alternate: FModel-only

1. Configure FModel with the current usmap; load `RSDragonwilds-Windows.utoc`.
2. Export `Content/Gameplay` (and GameFeatures Gameplay folders) as Raw JSON into `exports/raw/`.
3. Run `python export_string_tables.py`, `python build_items_json.py`, and `python build_recipes_json.py` (skip `batch_tojson` if JSON already has `Properties`).

## Scripts

| Script | Role |
|---|---|
| `batch_tojson.py` | Parallel `UAssetGUI tojson` |
| `clean_items.py` | Optional filter/copy of inventory-like `ITEM_*.json` |
| `export_string_tables.py` | Export/normalize `ST_ItemNames` → `data/stringtables/` |
| `export_combat_tables.py` | Decode equipment DTs → `data/combat/` |
| `build_items_json.py` | Normalize items (+ NameMap icons + ST names + combat joins) |
| `build_recipes_json.py` | Normalize recipes + cross-link to items |
| `export_icons.py` | Download/run UnrealExporter → `exports/icons/` |
| `collect_icons.py` | Copy item-referenced PNGs → `data/icons/` |
| `validate_against_saves.py` | Compare against `saves/**/SaveCharacters/*.json` |
| `run_pipeline.py` | tojson → string tables → items → recipes → icons → validate |
