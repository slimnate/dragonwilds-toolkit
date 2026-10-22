# Dragonwilds asset index (items & recipes)

Discovered from `RSDragonwilds-Windows.utoc` via `retoc list --path`. Refreshed against the 21 Oct 2026 install (shipping `++dominion+live-CL-251392`). Property mappings are `usmap/RSDragonwilds-5.6.1-251392+++dominion+live-0196ef29.usmap`.

Counts: **1705** `ITEM_*.uasset`, **1163** `RECIPE_*.uasset`. The item catalog is smaller (`data/items.json`) because mesh, deprecated, and test assets are dropped.

## Primary roots

| Kind | Typical paths |
|---|---|
| Items (base game) | `RSDragonwilds/Content/Gameplay/Items/...` |
| Equipment items | `RSDragonwilds/Content/Gameplay/Character/Player/Equipment/{Head,Body,Legs,Cape,Held,Ammo,Jewellery}/ITEM_*.uasset` |
| Feature-plugin items | `RSDragonwilds/Plugins/GameFeatures/{UmbralSands,DowdunReach,Fishing,...}/Content/Gameplay/.../ITEM_*.uasset` |
| Food recipes | `.../Gameplay/Items/Consumables/Food/Recipes/v3/{Crafted,Processed}/RECIPE_*.uasset` |
| Gear recipes | Same folders as equipment (`RECIPE_Armour_*`, `RECIPE_*Weapon*`) or `.../Gameplay/Items/Recipes/{Gear,Processed,BasicItemRecipes,FoodDrink,Ammo,Components,Fish}/` |
| Journal recipe unlocks | `.../Equipment/JournalEntries/.../RECIPE_Journal_*` and `Content/UI/JournalData/Entries/Recipes/...` (journal UI, not craft graphs) |
| Icons | `RSDragonwilds/Content/Art/UI/Icons/...` (and GameFeatures `…/Art/UI/Icons/…`); pipeline → `data/icons/` |

## Item folder taxonomy (from package paths)

Use path segments for categorization when `ItemFilterTags` are unavailable (UAssetAPI often emits `RawExport` for these Blueprints):

| Path contains | category | subcategory |
|---|---|---|
| `Equipment/Head` | Armour | Head |
| `Equipment/Body` | Armour | Body |
| `Equipment/Legs` | Armour | Legs |
| `Equipment/Cape` | Armour | Cape |
| `Equipment/Jewellery` / `Jewlery` | Jewellery | — |
| `Equipment/Ammo` | Ammo | — |
| `Equipment/Held` | Weapons or Tools | from asset name |
| `Items/Consumables/Food` | Consumables | Food |
| `Items/Consumables/Magic` | Consumables | Potions |
| `Items/Consumables/Tomes` | KeysQuestJournal | Tomes |
| `Items/Consumables/Misc` | Misc | — |
| `Items/Resources/<Type>` | Resources | `<Type>` (Metal, Mineral, Wood, Plant, Herb, Animal, Textiles, Key, Magic, Processed, …) |
| `Items/Quest` | KeysQuestJournal | Quest |
| `MeshData` / `Deprecated` / `TEST` | skip or Misc | — |

## Recipe identity

`RECIPE_*` assets are `RecipeData` objects (module `Dominion`). From RawExport FStrings + NameMap:

- PersistenceID (22-char base64url) — same ID family as save `RecipesUnlocked`
- Internal row name (e.g. `recipe_fried_onion_from_onion`)
- Soft refs to `ITEM_*` outputs/ingredients and often `SKILL_*`
- Crafting station GameplayTags (`Craft_Crafting_Table_*`, `Craft_Smithing_Forge_*`, `Process_Smelting_*`, campfire/cooking-pot markers, …)

## Related string tables / DataTables (not fully extracted in Phase 1)

Seen in item NameMaps:

- `ST_ItemNames`, `ST_ItemDescriptions`, `ST_ItemBuffs`
- `DT_FoodSustenance`, `DT_XPEvents_ConsumeItems`, `DT_XPEvents_Pickup`

## Extraction path used in this repo

1. `retoc to-legacy --version UE5_6 --filter "/ITEM_"` / `"/RECIPE_"` against `Content/Paks`
2. `UAssetGUI tojson … VER_UE5_6 RSDragonwilds` (mappings copied to `%AppData%\UAssetGUI\Mappings\`)
3. `tools/extract/*.py` normalize into `data/items.json` and `data/recipes.json`

FModel Raw JSON (`Properties` dict) is also accepted by the normalizers if you export that way later.
