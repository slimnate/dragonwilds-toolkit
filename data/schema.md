# Item / recipe JSON schema

Normalized outputs live in `data/items.json` and `data/recipes.json`.

## `data/items.json`

```json
{
  "meta": {
    "game": "RSDragonwilds",
    "source": "retoc+UAssetGUI|FModel|bootstrap",
    "usmap": "filename.usmap",
    "generatedAt": "ISO-8601",
    "itemCount": 0
  },
  "items": [ /* Item */ ]
}
```

### Item

| Field | Type | Notes |
|---|---|---|
| `persistenceId` | string | Save `ItemData` / inventory id. Full character JSON: [`docs/character-save-format.md`](../docs/character-save-format.md) |
| `name` | string | Display title. Prefer `ST_ItemNames` / bootstrap; else RawExport CamelCase; else humanized row/asset |
| `rowName` | string? | Internal row id from asset (e.g. `res_adhesive_acrid`) |
| `category` | string | Weapons, Armour, Jewellery, Tools, Ammo, Consumables, Resources, MagicMaterials, KeysQuestJournal, Misc |
| `subcategory` | string? | e.g. Melee, Food, Metal, Seeds |
| `weight` | number? | |
| `maxStackSize` | number? | |
| `vitalShield` | number? | |
| `powerLevel` | number? | Gear tier 1–9 (sometimes inferred from `T0N` in asset/row) |
| `powerLevelInferred` | boolean? | True when `powerLevel` came from tier tag, not bootstrap/props |
| `baseDurability` | number? | |
| `icon` | string? | Texture basename + `.png` from Properties, bootstrap, or NameMap `T_Icon_*` (files in `data/icons/`) |
| `tags` | string[] | GameplayTags / ItemFilterTags when known |
| `sourceAsset` | string | `ITEM_….json` / `.uasset` basename |
| `assetPath` | string? | Package path under `RSDragonwilds/...` |
| `equipmentKind` | string? | `held` \| `wearable` from class soft refs |
| `damageTypes` | string[]? | e.g. `DamageType.Physical.Slash` |
| `combatSkills` | string[]? | e.g. `SKILL_Attack` |
| `weaponFamily` | string? | Negation row key: `Sword`, `Dagger`, `Wands`, … |
| `powerCurve` | string? | `Weapons` or `Bows` |
| `weaponPower` | number? | `DT_PlayerWeaponPowerLevels[curve][powerLevel]` |
| `damageNegation` | number? | `DT_PlayerDamageNegation[family][powerLevel]` |
| `abilities` | object? | `{ primary, special, specialName, block }` from `PA_*` / `ST_WeaponAttacks` |
| `wearableRow` | string? | `DT_WearableEquipment` row id |
| `defense` | object? | `{ armourValue, meleeResistance, rangedResistance, magicResistance }` |

## `data/combat/`

Normalized DataTable dumps used when building items:

| File | Contents |
|---|---|
| `weapon_power_levels.json` | Curves `Weapons` / `Bows` — 9 floats for PowerLevel 1–9 |
| `damage_negation.json` | Per weapon family — 9 floats |
| `wearable_equipment.json` | Armour/cape/jewellery rows with resistance fields |
| `weapon_attacks.json` | Unique special labels from `ST_WeaponAttacks` |

## `data/recipes.json`

```json
{
  "meta": { "recipeCount": 0, "...": "..." },
  "recipes": [ /* Recipe */ ]
}
```

### Recipe

| Field | Type | Notes |
|---|---|---|
| `persistenceId` | string | Save `RecipesUnlocked` id |
| `rowName` | string? | e.g. `recipe_fried_onion_from_onion` |
| `name` | string? | Humanized from row/asset name when no localized title |
| `skill` | string? | e.g. `SKILL_Cooking` |
| `station` | string? | Crafting station display name (Crafting Table, Furnace, Campfire, …) |
| `stationTag` | string? | Source GameplayTag / NameMap marker (e.g. `Craft_Crafting_Table_Recipe_Tier2`) |
| `stationIcon` | string? | Texture basename + `.png` from `Art/UI/Icons/Stations_*` (files in `data/icons/`) |
| `outputItemAsset` | string? | `ITEM_*` basename |
| `outputPersistenceId` | string? | Resolved via items index when possible |
| `ingredientItemAssets` | string[] | `ITEM_*` basenames from NameMap |
| `ingredientPersistenceIds` | string[] | Resolved when possible |
| `sourceAsset` | string | `RECIPE_….json` basename |
| `assetPath` | string? | |

## Raw inputs

- **Preferred (full props):** FModel Raw JSON with `Properties` (community `ITEM_*.json` shape).
- **Automated (this repo):** UAssetAPI JSON from `UAssetGUI tojson` — often `RawExport` base64; parsers recover PersistenceID / row names from FStrings, `T_Icon_*` from NameMap, and display titles from `ST_ItemNames` (`data/stringtables/item_names.json`).
- **String tables:** `RSDragonwilds/Content/Gameplay/Items/ST_ItemNames.uasset` (keys like `AdhesiveAcrid` → `Acrid Adhesive`).

## `data/stringtables/item_names.json`

```json
{
  "meta": { "count": 0, "source": "…/ST_ItemNames.json" },
  "names": { "AdhesiveAcrid": "Acrid Adhesive" }
}
```
