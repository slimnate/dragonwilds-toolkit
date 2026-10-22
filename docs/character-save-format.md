# Character save format (RuneScape: Dragonwilds)

On-disk format for **player characters** only. World saves under `SaveGames/` are SPUD binaries, documented in [world-save-format.md](world-save-format.md).

Unofficial. Derived from local `SaveCharacters` JSON (schema versions 53–80) plus Lua dumps in `dumps/LuaTypes/Dominion.lua`.

## File location

| Path | Role |
|---|---|
| `%LocalAppData%\RSDragonwilds\Saved\SaveCharacters\<name>.json` | Live character |
| `<name>.json.backup` | Game-written last copy |
| `<name>.json.<N>.verbackup` | Snapshot taken when `Version` advanced to `N` |

The editor writes `<name>.json.editorbackup` beside the file before overwrite.

## Encoding

- UTF-8, no BOM
- Valid JSON (no trailing commas)
- Pretty-printed Unreal style: **tab** indent, CRLF on Windows
- Objects: `"Key":` then newline then `{` at the same indent as the key
- Arrays: `"Key": [` on the same line; `[]` when empty
- Empty objects still occupy two lines (`{\n\t\t}`)

The game’s JSON parser is lenient. The editor still pretty-prints in this style so diffs stay readable.

## Identity formats

| Kind | Shape | Example | Used for |
|---|---|---|---|
| Persistence ID | 22-char URL-safe base64 (`A–Z a–z 0–9 _ -`), 16 bytes | `ilFiZ9GcsUC5EOSxOrE74w` | Item type (`ItemData`), recipes, skills, quests, journal, spells, buildings |
| Instance GUID | Same 22-char alphabet | `WsZxwEQUvuRq4GqcssyIPA` | Per-stack `GUID` in inventory (not the item type) |
| Hex GUID | 32 hex chars, no dashes | `6E2E128B41900B4390F89BA721730C01` | `char_guid`, world keys, shrines, kebbit burrows, hardcore world |
| DataTable row | `{ dataTable, rowName }` | `male_A_01` | Appearance |
| FVector text | `V(X=…, Y=…, Z=…)` | `V(X=42723.03, Y=170569.21, Z=-4208.00)` | `LastAccessibleLocation` |
| Mount asset | `MountDataAsset:DA_Mount_…` or `None` | Flying carpet / terrorbird | Mount loadout |
| Vendor tag | GameplayTag string | `Vendor.MoonGarou.Hawker` | Reputation |
| Blueprint class | Short UClass name | `BP_Station_Grill_C` | `ActorsInteractedWith` |

`ItemData` is an exact string match to `data/items.json` → `persistenceId` (and the editor’s bundled catalog `id`). Decode is optional: `ilFiZ9GcsUC5EOSxOrE74w` → FGuid-ish `6762518A-9CD1-40B1-B910-E4B13AB13BE3`.

There is **no coin field**. Vendor currency is a stacked item (e.g. Garou Chit in `PersonalInventory`).

## Root layout

### Flat (Version ≤ 67)

```text
Version, meta_data, SaveCount,
Character, Inventory, PersonalInventory, Loadout,
Progress, QuestProgress, RevealedLandmarks, RevealedFog,
Skills, [SkillPerks], Journal, MapCustomization, Spellcasting,
[Hardcore], Backup
```

`Customization` lives under `Character.Customization`.

### Wrapped (Version ≥ 75)

```text
Version, meta_data, SaveCount,
Customization, Hardcore,
GameProgress: {
  Version,   // mirrors file Version
  Character, Inventory, PersonalInventory, Loadout,
  Progress, QuestProgress, RevealedLandmarks, RevealedFog,
  Skills, Journal, MapCustomization, Spellcasting
},
Backup
```

**Editor rule:** detect `GameProgress` (or `Version >= 75`) and edit in the file’s native layout. Do not migrate flat ↔ wrapped.

### Version changelog (this corpus)

| Version | Notes |
|---|---|
| 53 | Flat. HairZone / FacialHairZone customization. `Character.GameplayEffects`. No `Hardcore`. |
| 56 | `Cosiness` status effect. Zones collapsed to hair presets. |
| 61 | `Hardcore` object. `Wither`. |
| 62 | Empty `SkillPerks: {}` may still exist. |
| 67 | `SkillPerks` gone. `Mount`, `SoulRift`, `BuildingsFavourited`, `VendorReputations`. `VitalShield` still on gear. `Toxicity` still on character. |
| 75 | `GameProgress` wrapper. Customization at root. No `Toxicity`. No `VitalShield` on slots. `UtilityMagic`. Extra status effects. `ShrinesUnlocked`. |
| 80 | `NumUpgradesApplied` on gear. `HydrationDrinkBuff`. `Potions`. `WalkedDistanceSinceXp`. `AgilityCourseScores`. Kebbit burrow lists. Loadout slot 4 (trinket) + `MaxSlotIndex` 9. |

Lua aliases: `FCharacterCustomizationSaveData`, `FCharacterHardcoreState`, `FQuestProgress`, `FAgilityCourseCompletionData`, `FVendorReputation`, `EQuestState`, `ELoadoutSlot`.

---

## Property reference

Paths below are **gameplay-relative** (`GameProgress.*` on ≥75, else file root) unless marked `[root]`.

### `[root]` file header

| Path | Type | Meaning |
|---|---|---|
| `Version` | int | Schema version. **Do not bump** in the editor. |
| `SaveCount` | int | Times the game wrote this slot. |
| `Backup` | uint32 | Opaque token. **Leave unchanged.** |
| `meta_data.char_guid` | hex32 | Character identity. |
| `meta_data.char_name` | string | Display name (also the default filename stem). |
| `meta_data.char_type` | int | Observed `0` (normal). |
| `meta_data.worlds_playtime.<worldGuid>` | int | Per-world playtime / last-played stamp (dynamic keys). |
| `Hardcore.IsHardcore` | bool | ≥61. Lua `FCharacterHardcoreState.bIsHardcore`. |
| `Hardcore.AssociatedWorld` | hex32 | Bound world; all zeros if unbound. |
| `Customization` | object | ≥75 only at root. Same shape as `Character.Customization` on older files. |
| `GameProgress.Version` | int | ≥75; same as root `Version`. |

### Customization (`FCharacterCustomizationSaveData`)

Each slot is a DataTable row handle `{ dataTable, rowName }`.

| Field | DataTable path (typical) | Sample `rowName` |
|---|---|---|
| `CustomizationData.BodyType` | `DT_Customization_BodyType` | `male_A_01` |
| `Head` | `DT_Customization_FaceType` | `male_A_01`, `male_D_03` |
| `HairPreset` | `DT_Customization_HairPresets` | `Preset10`, `Preset23` |
| `FacialHairPreset` | `DT_Customization_FacialHairPresets` | `M_A_Preset1`, `M_D_Preset1` |
| `SkinTone` | `DT_Customization_SkinTone` | `SkinTone3` |
| `HairColor` | `DT_Customization_HairColor` | `Color5` |
| `EyeColor` | `DT_Customization_EyeColor` | `Color2` |
| `EyebrowColor` | `DT_Customization_EyebrowColor` | `Color5`, `Color7` |

v53 only: `HairZone1–5`, `FacialHairZone1–4` (per-zone meshes; later collapsed into presets). Keep `dataTable` asset paths when changing `rowName`.

### Character vitals

| Path | Type | Versions | Meaning |
|---|---|---|---|
| `Character.Playtime_sim` | float | all | Simulated seconds |
| `Character.Playtime_wall` | float | all | Wall-clock seconds |
| `Character.WalkedDistanceSinceXp` | number | 80 | Distance toward walk XP |
| `Character.Health.CurrentValue` | number | all | Current HP (max is not stored) |
| `Character.Stamina.CurrentValue` | number | all | Current stamina |
| `Character.Sustenance.SustenanceValue` | float | all | Hunger |
| `Character.Sustenance.SustenanceDecayBuffer` | number | all | |
| `Character.Hydration.HydrationValue` | float | all | Thirst |
| `Character.Hydration.HydrationDecayBuffer` | number | all | |
| `Character.Hydration.HydrationDrinkBuff.DrinkBuffPersistenceId` | pid | 80 | Active drink item |
| `Character.Hydration.HydrationDrinkBuff.DrinkBuffTimeRemaining` | float | 80 | Seconds left |
| `Character.Endurance.EnduranceValue` | float | all | Fatigue meter |
| `Character.Endurance.EnduranceDecayBuffer` | number | all | |
| `Character.Toxicity.ToxicityValue` | number | ≤67 | Removed by v75 |
| `Character.Toxicity.HighestToxicityValue` | number | ≤67 | |
| `Character.Food` | object | all | Always `{}` in this corpus |
| `Character.Potions` | object | 80 | Always `{}` here |
| `Character.UtilityMagic.Cooldowns` | array | ≥75 | Empty in samples |
| `Character.GameplayEffects.Instances` | array | 53–56 | Deprecated |
| `Character.LastAccessibleLocation.Position` | FVector string | all | Last safe position |
| `Character.Mount.MountEquipped` | string | ≥67 | `None` or `MountDataAsset:…` |
| `Character.Mount.MountsUnlockedList` | string[] | ≥67 | Unlocked mount assets |
| `Character.SoulRift.SoulRiftedDuration` | number | ≥67 | |
| `Character.SoulRift.PlayingImaruEvent` | bool | ≥67 | |
| `Character.SoulRift.PreSoulRiftHydration` | number | ≥67 | `-1` when unset |
| `Character.SoulRift.PreSoulRiftSustenance` | number | ≥67 | |
| `Character.SoulRift.PreSoulRiftEndurance` | number | ≥67 | |
| `Character.SoulRift.TrackedAI` | array | ≥67 | Empty in samples |

### Status effects (`Character.StatusEffects`)

Per-effect object: `{ Hash: uint32, Value: number, Active: [bool, …] }`. Hashes are stable across saves.

| Key | Hash | First seen | Extra |
|---|---|---|---|
| `Cold` | 1501092416 | ≤53 | |
| `Poison` | 1673355410 | ≤53 | |
| `Burning` | 1232270846 | ≤53 | |
| `Bleeding` | 3836059435 | ≤53 | |
| `Slow` | 897314269 | ≤53 | |
| `WellRested` | 2050017224 | ≤53 | |
| `Cosiness` | 334594781 | ≥56 | sibling `LastMaxCosiness` |
| `Wither` | 2596365627 | ≥61 | |
| `Scorch` | 617836362 | ≥75 | |
| `Chilled` | 3700132483 | ≥75 | |
| `Shocked` | 609174564 | ≥75 | |
| `OverEating` | 494801183 | ≥75 | |
| `SoulScourge` | 617425600 | ≥75 | |
| `AnimaCharge` | 3131721881 | ≥75 | `Attunement` (e.g. `None`), `Reset`; `Active` may be `[]` |
| `WellRestedDecayRate` | — | all | Sibling **number**, not an effect object |

### Inventory, personal storage, loadout

Three **sparse objects** keyed by decimal string slot index. Missing keys are empty slots. Sibling `MaxSlotIndex` is the capacity hint (`-1` if unused).

| Container | Role | Sample `MaxSlotIndex` |
|---|---|---|
| `Inventory` | Main bag. Since 1.0.1 the carried inventory is 40 slots: hotbar 8 (0–7) plus 32 bag slots (8–39). Runes start at 40, ammo at 64, quest at 88 | 80 (Nate), 94 (v80) |
| `PersonalInventory` | Materials / currency pouch | `-1` empty, `19` in use |
| `Loadout` | Equipment + hotbar | 8 (≤67), 9 (v80) |

#### Slot fields

| Field | When | Meaning |
|---|---|---|
| `GUID` | Real items | Instance id |
| `ItemData` | Real items | Catalog `persistenceId` |
| `Count` | Stackables | Stack size (omit for unique gear) |
| `Durability` | Tools / weapons / armour | Current durability |
| `VitalShield` | Wearables ≤67 | Charge; **gone ≥75** |
| `NumUpgradesApplied` | Gear in v80 | Upgrade count (0–3 seen) |
| `PlayerInventoryItemIndex` | Loadout hotbar only | Index into `Inventory` (pointer, not a copy) |

Observed combos: `{GUID, ItemData, Count}` · `{GUID, ItemData, Durability[, NumUpgradesApplied]}` · `{GUID, ItemData}` · `{PlayerInventoryItemIndex}`.

#### `ELoadoutSlot`

| Index | Name |
|---|---|
| 0 | Head |
| 1 | Body |
| 2 | Legs |
| 3 | Cape |
| 4 | Trinket (ring). Often absent before v80 |
| 5 | Ammo |
| 6 | MagicAmmo |
| 7 | HeldRight |
| 8 | HeldLeft |
| 9 | CrossbowBolts |
| 10 | FishingBait |
| 11 | Trinket2 (amulet). Added in 1.0.1; `ELoadoutSlot_MAX` is 12 on CL-251392 |

Slots 0–4 usually embed a full item. Slots 5+ are usually `{ PlayerInventoryItemIndex: N }`.

Lua `EInventorySlotType` (QuickAction, Runes, QuestItems, …) describes UI pages; it is **not** stored per slot.

### Skills

```json
"Skills": { "Skills": [ { "Id": "<pid>", "Xp": 234373 } ] }
```

- `Id` — skill asset persistence ID (not `ESkill` int)
- `Xp` — total XP; level curves live in game assets (not in the save)
- `SkillPerks: {}` may exist through v62; removed by v67

`ESkill`: Invalid, Agility, Artisan, Attack, Construction, Cooking, Defence, Herblore, Magic, Mining, Ranged, Runecrafting, Thieving, Woodcutting, Farming, Utility, Fishing.

### Progress / unlocks

| Path | Element | Meaning | Version |
|---|---|---|---|
| `Progress.ItemsPickedUp` | item pid | First pickup / journal | all |
| `Progress.MilestoneMaterialsPickedUp` | item pid | Milestone materials | all |
| `Progress.RecipesUnlocked` / `RecipesNew` | recipe pid | Craft unlocks + “new” badge | all |
| `Progress.BuildingsUnlocked` / `BuildingPiecesNew` | building pid | Build menu | all |
| `Progress.BuildingsFavourited` | pid | Favourites | ≥67 |
| `Progress.SpellsUnlocked` / `SpellsNew` | spell pid | Spellbook | all |
| `Progress.ActorsInteractedWith` | BP class name | Interaction / FTUE hooks | all |
| `Progress.PlayerHooksTriggered` | pid | One-shot hooks | all |
| `Progress.KilledOnceAIs` | AI pid | Bestiary / first kill | all |
| `Progress.VendorReputations[]` | `{VendorReputationTag, VendorReputationAmount}` | Lua `FVendorReputation` | ≥67 |
| `Progress.ShrinesUnlocked` | hex32 | World object GUIDs | ≥75 |
| `Progress.KebbitBurrowsFound` / `KebbitBurrowsActivated` | hex32 | | 80 |
| `Progress.AgilityCourseScores[]` | `{CourseID, HighestUnlockedMedal, PersonalBestCompletionTime}` | `EAgilityCourseMedal`: 0 none, 1 bronze, 2 silver, 3 gold | 80 |

World **lodestone positions** are not in the character file (`FLodestoneData` lives on the world). Character-side shrine GUIDs and map fog/pins are the closest equivalent.

### Quests (`FQuestProgress`)

| Path | Type | Meaning |
|---|---|---|
| `QuestProgress.QuestTracked` | quest pid | Currently tracked |
| `QuestProgress.Quests[]` | object | |
| `….QuestId` | pid | |
| `….QuestState` | int | `EQuestState`: 0 Ungiven, 1 Given, 2 Complete |
| `….QuestObjective` | string | Objective name / text key |
| `….QuestBools[]` | `{QuestVariableName, QuestVariableValue}` | |
| `….QuestInts[]` | `{QuestVariableName, QuestVariableValue}` | e.g. `QuestBeat` |
| `QuestProgress.QuestLocations[]` | `{QuestLocationId, QuestLocationsState}` | Includes `*_FTUE_*` tutorial flags |

### Journal

| Path | Type |
|---|---|
| `Journal.UnlockedEntries[]` | journal pid |
| `Journal.UnreadEntries[]` | journal pid |

### Map / fog / pins

| Path | Type | Meaning |
|---|---|---|
| `RevealedFog.RevealedRegionsBitmap` | int bitfield | Grows as the map is explored (e.g. 63 → 268435455) |
| `RevealedFog.RevealedRegionsDetectionActive` | bool | |
| `RevealedLandmarks.RevealedLandmarkNames[]` | string | Empty in both main samples |
| `MapCustomization.Pins[]` | `{PinType: int, PinLocation: [x, y]}` | 2D map coords. `PinType` observed 1–5; enum is a raw uint8 in `UMapUIAPI.PlacePin` |

### Spell bar

| Path | Type | Meaning |
|---|---|---|
| `Spellcasting.SelectedSpells[]` | spell pid or `""` | Four spell wheels × 12 slots = 48 entries (late saves). Unused slots are empty strings. Wheel `n` occupies indices `n*12` .. `n*12+11`. |

---

## Not stored on the character

- Currency scalar (use item stacks)
- Max HP / max stamina
- Skill display names and level tables
- Active food buff payloads (`Food` is empty; drinks use `HydrationDrinkBuff`)
- World lodestone transforms
- Dedicated tutorial object (FTUE is quest locations / hooks)

## Round-trip rules (editor)

1. Parse with `JSON.parse`; write Unreal tab JSON.
2. Preserve unknown keys and key order (mutate the existing object).
3. Do not change `Version` or `Backup`.
4. Do not convert flat ↔ `GameProgress`.
5. Do not invent `ItemData` ids unless the user pastes a raw persistence ID.
6. Hotbar edits change only `PlayerInventoryItemIndex`.
7. New stacks get a fresh 22-char instance `GUID` (16 random bytes, base64url, no padding).
8. Omit empty inventory slots; keep `MaxSlotIndex`.

Jagex’s modding guidelines allow single-player cheats and forbid unfair advantages in **shared worlds**. Close the game before replacing a live save.
