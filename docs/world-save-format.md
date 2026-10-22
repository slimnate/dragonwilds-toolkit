# World save format (RuneScape: Dragonwilds)

On-disk format for **world slots** only. Character JSON is documented in [character-save-format.md](character-save-format.md).

Unofficial. Derived from local `SaveGames/*.sav` (SPUD system versions 3–8) plus [sinbad/SPUD](https://github.com/sinbad/SPUD) `SpudData.h` and `dumps/LuaTypes/Dominion.lua`.

## File location

| Path | Role |
|---|---|
| `%LocalAppData%\RSDragonwilds\Saved\SaveGames\<slot>.sav` | Packed world slot. This is the file the editor opens and writes. |
| `<slot>.sav.backup` | Game-written last copy |
| `<slot>.sav.<N>.verbackup` | Snapshot taken when the save revision advanced |
| `SpudCache\*.lvl` | Same `LEVL` chunks, paged out while a session is running. Not a second source of truth. |

The editor writes `<slot>.sav.editorbackup` beside the file before overwrite. `EnhancedInputUserSettings.sav` is input config, not a world.

Samples:

| Backup | Slots | Difficulty seen |
|---|---|---|
| `saves/8-10-26-save-bak` | `HelloWorld`, `BonesRTheirMoney`, `N8+K8=GR8` | Normal. `N8+K8=GR8` also stores `Difficulty.Environment.FriendlyFire`. |
| `saves/09-25-26-save-bak` | those three, plus `test-standard`, `test-custom`, `CR34T0R` | Normal, Custom (full `Difficulty.*` scale list), Creative |

## Container

Little-endian. Every chunk is `char[4] magic`, `uint32 length` (payload only), then payload. The file itself is a `SAVE` chunk: the length is the byte count after the 8-byte header.

```text
SAVE
  INFO     system version, empty title, ISO timestamp, optional SHOT, CINF
  GLOB     current level name, META, GOBS, GLAI
  LVLS
    LEVL   level name, META, LATS, SATS, DATS
```

`META` holds `VERS` (user data model int32), `CNIX` (class name strings), `CLST`, and `PNIX` (property name strings). Each level has its own dictionaries. `CLST` is a list of `CDVE` wrappers, and each wrapper holds one `CDEF`. The wrapper index is the class id used by `NOBJ` and `SPWN`. `GLAI` is a Dragonwilds chunk after `GOBS` inside `GLOB`; its payload is copied verbatim.

Any other 4-letter uppercase chunk whose length lands on the parent end is kept the same way, so an unknown chunk is not dropped on save.

`NOBJ` is a placed or global object: `uint32 classId` (system version ≥ 4), `FString` name, then `CORA`, `PROP`, `CUST`. `SPWN` is a runtime actor: `classId`, 16-byte guid, then the same three chunks. `KILL` is a destroyed level actor name.

Newer files (system version ≥ 7) insert 8 bytes `0A 02 00 00 F9 03 00 00` after the level name and inside `INFO` before the empty title. Those bytes are Unreal archive versions. The parser keeps any gap that is not a known chunk.

Do not bump SPUD system version, `VERS`, or `Meta_SaveFileRevision`.

## Strings and ids

Unreal `FString`: `int32` byte length including the trailing NUL, then ANSI bytes. Length `0` is empty. Negative length is UTF-16.

`FGuid` is 16 raw bytes, also stored in `CINF` as `GUID_A`–`GUID_D` (`uint32` each, file order). Character files refer to the same id as 32 hex characters (`Hardcore.AssociatedWorld`, `meta_data.worlds_playtime`).

## CINF summary

`CINF` is the load-screen header. It is a name list, an offset table, and a byte blob. Field width comes from the offsets, not from a type tag.

| Field | Width | Notes |
|---|---|---|
| `VERSION` | int32 | Observed 8 and 9. Not the character schema version. |
| `GUID_A`–`GUID_D` | uint32 × 4 | `WorldSaveGuid` |
| `WorldName`, `WorldMapName` | FString | Map is `L_World` |
| `FriendlyFire` | uint8 | |
| `SurvivalDifficulty` | int32 | `ESurvivalDifficulty`: 0 Normal, 1 Hard, 2 Creative, 3 Custom |
| `HardcoreState` | int32 | `EWorldHardcoreState`: 0 uninitialised, 1 inactive, 2 active, 3 failed, 4 succeeded |
| `Difficulty.*` | float32 | Present on Custom worlds, and `Difficulty.Environment.FriendlyFire` on some older slots. Bool-like settings are stored as 0 or 1. |
| `TimeOfSave` | int64 | Unreal ticks. The ISO timestamp in `INFO` is the human-readable copy. |
| `SessionPrivacy` | int32 | `EDomSessionPrivacy` |
| `SessionPasswd` | FString | Empty is a zero length, not a blank string |
| `CrossplayEnabled` | int32 | |
| `WorldOwnerId`, `WorldNameOwner`, `LastSavedBy` | FString | |
| `Meta_SaveFileRevision` | int32 | Leave unchanged |

`test-custom.sav` scales: thirst kills, carry capacity, keep inventory, gravestone cap, damage, health, lifeward, resistances, stamina, reset XP on death, spell cooldown, spell cost, teleport cost, XP gain, endurance drain, hydration drain, sustenance drain.

## Gameplay objects

`PROP` uses the same offset table. The `CDEF` `uint16` type is SPUD `ESpudStorageType`:

| Value | Type |
|---|---|
| 0–9 | uint8, uint16, uint32, uint64, int8, int16, int32, int64, float, double |
| 0x17 | guid (16 bytes) |
| 0x1E / 0x1F / 0x20 | string / name / text |
| 0x40 | opaque Unreal record (`TMap`, custom struct) |
| 0x1000 | array flag. Payload is `uint16` count, then elements. |

`PersistenceSubsystem` → `WorldSaveSettings` mirrors `CINF`, with different widths: `SurvivalDifficulty` and `HardcoreState` are uint16, `bFriendlyFire` is uint8, and `CustomDifficultySettings` is an opaque map. A difficulty edit has to update both copies. Inside that map each entry is an `FString` tag, an `FString` `None`, then a float32. Floats can be replaced in place.

`WorldProgressManager` holds defeated bosses, world hooks, and tagged progress. `BP_InGameTimeActor` / `BP_WeatherActor` hold the clock and `WeathersJSONData`. Resource nodes, chests, dropped items, and buildings are per-level actors. `JsonInventory` and `ItemDataPersistenceId` use the same persistence ids as character items. `CORA` (transform) stays byte-preserved.

Cell levels are named `RSACell12800_X*_Y*`. They are a group inside a page, not separate navigation.
