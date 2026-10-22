# Dragonwilds Toolkit

Standalone Tauri 2 + React app for editing **character** saves (`SaveCharacters/*.json`) and **world** saves (`SaveGames/*.sav`).

Format notes: [character save format](docs/character-save-format.md) and [world save format](docs/world-save-format.md).

The item catalog and icons live in [`data/`](data/). Refresh them with the extract pipeline in [`tools/extract/`](tools/extract/) — see [item and recipe extraction](docs/item-data-extraction.md). A copy of `data/` is also kept in [rsdw-mods](https://github.com/slimnate/rsdw-mods) for the data viewer.

## Prerequisites

- Node 20+
- Rust (stable) + Windows MSVC build tools (for `tauri dev` / `tauri build`)
- Python 3.12+ when re-running the extract pipeline

## Run

```powershell
npm install
npm run icons
npm run tauri dev
```

`tauri dev` runs `catalog:pack` first. That copies a slim item/recipe catalog and PNG icons into `public/catalog/` so the app does not read `data/` at runtime. Re-run it after refreshing game data.

The app lists `%LocalAppData%\RSDragonwilds\Saved\SaveCharacters` and `SaveGames`. Switch Character / World above the file list. Close the game before overwriting a live file. Each Save writes `<name>.json.editorbackup` or `<name>.sav.editorbackup` first.

You can also Open… a backup from a local `saves/` folder (gitignored; not included in this repo).

## Verify serialize / catalog

```powershell
npm run catalog:pack
npm run roundtrip
npm run world:roundtrip
```

Round-trip checks read sample saves from `saves/`. Place those locally before running the scripts. `roundtrip` checks JSON equality and that inventory `ItemData` ids exist in the bundled catalog. `world:roundtrip` checks world `.sav` samples stay byte-identical until a field is edited.

## Jagex notes

Single-player cheats are allowed. Do not use edited characters to gain an unfair advantage in shared worlds.

Unofficial. Not affiliated with Jagex.
