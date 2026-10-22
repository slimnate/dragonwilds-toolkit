"""Shared helpers for Dragonwilds item/recipe extraction."""

from __future__ import annotations

import base64
import json
import re
import struct
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
EXPORTS_RAW = REPO_ROOT / 'exports' / 'raw'
EXPORTS_LEGACY = REPO_ROOT / 'exports' / 'legacy'
EXPORTS_ICONS = REPO_ROOT / 'exports' / 'icons'
EXPORTS_STRINGTABLES = REPO_ROOT / 'exports' / 'stringtables'
DATA_DIR = REPO_ROOT / 'data'
ICONS_DIR = DATA_DIR / 'icons'
STRINGTABLES_DIR = DATA_DIR / 'stringtables'
USMAP_DIR = REPO_ROOT / 'usmap'
TOOLS_BIN = REPO_ROOT / 'tools' / 'bin'

PID_RE = re.compile(r'^[A-Za-z0-9_-]{20,24}$')
ROW_RE = re.compile(r'^[a-z][a-z0-9_]*$')


def load_json(path: Path) -> Any:
    text = path.read_text(encoding='utf-8-sig')
    return json.loads(text)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def current_usmap_name() -> str | None:
    maps = sorted(USMAP_DIR.glob('*.usmap'))
    return maps[-1].name if maps else None


def primary_export(data: Any) -> dict[str, Any] | None:
    exports = data.get('Exports') if isinstance(data, dict) else None
    if isinstance(exports, list) and exports and isinstance(exports[0], dict):
        return exports[0]
    return None


def top_level_properties(data: Any) -> dict[str, Any]:
    """Map export property name -> value from a mapped UAssetAPI NormalExport."""
    export = primary_export(data)
    raw = export.get('Data') if export else None
    if not isinstance(raw, list):
        return {}
    out: dict[str, Any] = {}
    for entry in raw:
        if isinstance(entry, dict) and isinstance(entry.get('Name'), str):
            out[entry['Name']] = entry.get('Value')
    return out


def as_number(value: Any) -> int | float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        rounded = round(value, 5)
        if rounded == int(rounded):
            return int(rounded)
        return rounded
    if isinstance(value, str):
        text = value.strip().lstrip('+')
        if not text:
            return None
        try:
            parsed: int | float = float(text) if '.' in text else int(text)
        except ValueError:
            return None
        return as_number(parsed)
    return None


def soft_object_basename(value: Any) -> str | None:
    """Texture basename from an FSoftObjectPath property value."""
    if not isinstance(value, dict):
        return None
    asset = value.get('AssetPath')
    package = None
    if isinstance(asset, dict):
        package = asset.get('PackageName') or asset.get('AssetName')
    elif isinstance(asset, str):
        package = asset
    if not isinstance(package, str) or not package:
        return None
    base = package.replace('\\', '/').split('/')[-1].split('.')[0]
    if not base or base == 'None':
        return None
    return f'{base}.png'


def collect_tag_names(value: Any) -> list[str]:
    tags: list[str] = []
    if isinstance(value, dict):
        tag = value.get('TagName')
        if isinstance(tag, str):
            tags.append(tag)
        elif value.get('Name') == 'TagName' and isinstance(value.get('Value'), str):
            tags.append(value['Value'])
        else:
            tags.extend(collect_tag_names(value.get('Value')))
    elif isinstance(value, list):
        for entry in value:
            tags.extend(collect_tag_names(entry))
    return tags


def import_object_name(data: Any, index: Any) -> str | None:
    """Resolve a UAssetAPI import index (negative) to ObjectName."""
    if isinstance(index, str):
        number = as_number(index)
        if number is None:
            return None
        index = int(number)
    if not isinstance(index, int) or index >= 0:
        return None
    imports = data.get('Imports') if isinstance(data, dict) else None
    if not isinstance(imports, list):
        return None
    slot = -index - 1
    if not 0 <= slot < len(imports) or not isinstance(imports[slot], dict):
        return None
    name = imports[slot].get('ObjectName')
    return name if isinstance(name, str) and name else None


def item_container_refs(data: Any, value: Any) -> list[tuple[str, int]]:
    """(ITEM_* object name, count) from an ItemDataContainer array property."""
    if not isinstance(value, list):
        return []
    refs: list[tuple[str, int]] = []
    for entry in value:
        if not isinstance(entry, dict):
            continue
        fields = entry.get('Value')
        if not isinstance(fields, list):
            continue
        by_name = {
            field.get('Name'): field.get('Value')
            for field in fields
            if isinstance(field, dict) and isinstance(field.get('Name'), str)
        }
        asset = import_object_name(data, by_name.get('ItemData'))
        if not asset or not asset.startswith('ITEM_'):
            continue
        count = as_number(by_name.get('Count'))
        refs.append((asset, int(count) if isinstance(count, (int, float)) else 1))
    return refs


def datatable_row_structs(data: Any) -> list[dict[str, Any]]:
    export = primary_export(data)
    table = export.get('Table') if export else None
    rows = table.get('Data') if isinstance(table, dict) else None
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict)]


def struct_field_map(value: Any) -> dict[str, Any]:
    if not isinstance(value, list):
        return {}
    return {
        field.get('Name'): field.get('Value')
        for field in value
        if isinstance(field, dict) and isinstance(field.get('Name'), str)
    }


def iter_json_files(root: Path, prefix: str) -> list[Path]:
    if not root.exists():
        return []
    prefix_u = prefix.upper()
    return sorted(
        p for p in root.rglob('*.json')
        if p.name.upper().startswith(prefix_u)
    )


def extract_fstrings(raw: bytes) -> list[str]:
    out: list[str] = []
    i = 0
    while i + 4 <= len(raw):
        n = struct.unpack_from('<i', raw, i)[0]
        if 2 <= n <= 256 and i + 4 + n <= len(raw):
            chunk = raw[i + 4:i + 4 + n]
            if chunk.endswith(b'\x00') and all(32 <= b < 127 or b == 0 for b in chunk):
                s = chunk[:-1].decode('ascii', errors='ignore')
                if s:
                    out.append(s)
                i += 4 + n
                continue
        i += 1
    return out


def ascii_runs(raw: bytes, min_len: int = 6) -> list[str]:
    return [m.decode('ascii') for m in re.findall(rb'[\x20-\x7e]{' + str(min_len).encode() + rb',}', raw)]


def pick_persistence_id(candidates: list[str]) -> str | None:
    # Prefer IDs that look like inventory/recipe PersistenceIDs (not pure lowercase row names).
    scored: list[tuple[int, str]] = []
    for c in candidates:
        if not PID_RE.match(c):
            continue
        if '_' in c and c.islower():
            continue
        score = 0
        if any(ch.isupper() for ch in c):
            score += 2
        if '-' in c or any(ch.isdigit() for ch in c):
            score += 1
        if len(c) == 22:
            score += 2
        scored.append((score, c))
    if not scored:
        return None
    scored.sort(key=lambda t: (-t[0], t[1]))
    return scored[0][1]


def pick_row_name(candidates: list[str]) -> str | None:
    for c in candidates:
        if ROW_RE.match(c) and ('_' in c) and not c.startswith('ITEM_') and not c.startswith('RECIPE_'):
            return c
    return None


def icon_from_object_ref(icon_obj: Any) -> str | None:
    if not icon_obj:
        return None
    if isinstance(icon_obj, str):
        text = icon_obj
    elif isinstance(icon_obj, dict):
        text = icon_obj.get('ObjectName') or icon_obj.get('AssetPathName') or ''
    else:
        return None
    m = re.search(r"Texture2D'([^']+)'", text)
    path = m.group(1) if m else text
    name = Path(path.replace('\\', '/').split('/')[-1]).name
    if not name:
        return None
    if not name.lower().endswith('.png'):
        name = f'{name}.png'
    return name


# Noise tokens that inflate overlap with skill-tag / UI chrome icons.
_ICON_NOISE_TOKENS = frozenset({
    'icon', 'tag', 'skill', 'skills', 'item', 'items', 'ui', 'art', 'texture',
    'inventory', 'big', 'small', '01', '02', '03', 'v2', 'v3', 'new',
})


def _tokenize_hint(*parts: str | None) -> set[str]:
    tokens: set[str] = set()
    for part in parts:
        if not part:
            continue
        cleaned = re.sub(r'^(ITEM_|RECIPE_|T_Icon_|T_icon_)', '', part, flags=re.I)
        cleaned = re.sub(r'\.(json|uasset|png)$', '', cleaned, flags=re.I)
        cleaned = re.sub(
            r'^(weap_|ammo_|food_|potion_|armour_|armor_|res_|resource_|recipe_|mat_|item_)',
            '',
            cleaned,
            flags=re.I,
        )
        for tok in re.split(r'[_\s./-]+', cleaned.lower()):
            if len(tok) >= 2 and tok not in _ICON_NOISE_TOKENS:
                tokens.add(tok)
    return tokens


def _stem_token(tok: str) -> str:
    """Light plural stem so seed/seeds match."""
    if len(tok) > 3 and tok.endswith('s') and not tok.endswith('ss'):
        return tok[:-1]
    return tok


def _edit_distance(a: str, b: str) -> int:
    if a == b:
        return 0
    if abs(len(a) - len(b)) > 2:
        return 99
    # Classic Levenshtein; tokens are short so this is cheap.
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        cur = [i]
        for j, cb in enumerate(b, start=1):
            ins = cur[j - 1] + 1
            delete = prev[j] + 1
            sub = prev[j - 1] + (0 if ca == cb else 1)
            cur.append(min(ins, delete, sub))
        prev = cur
    return prev[-1]


def _token_overlap_score(hints: set[str], stem_tokens: set[str]) -> int:
    """Exact + near-typo token overlap (Cadavaberry vs Cadaverberry)."""
    if not hints or not stem_tokens:
        return 0
    hint_norm = {_stem_token(t): t for t in hints}
    stem_norm = {_stem_token(t): t for t in stem_tokens}
    exact = set(hint_norm) & set(stem_norm)
    score = len(exact) * 10
    used_hints = set(exact)
    used_stems = set(exact)
    for hn, h in hint_norm.items():
        if hn in used_hints:
            continue
        best = 0
        best_sn: str | None = None
        for sn in stem_norm:
            if sn in used_stems:
                continue
            if len(hn) >= 4 and len(sn) >= 4 and (hn in sn or sn in hn):
                best = max(best, 7)
                best_sn = sn
                continue
            dist = _edit_distance(hn, sn)
            if dist == 1 and min(len(hn), len(sn)) >= 5:
                if best < 8:
                    best = 8
                    best_sn = sn
            elif dist == 2 and min(len(hn), len(sn)) >= 6:
                if best < 5:
                    best = 5
                    best_sn = sn
        if best and best_sn is not None:
            score += best
            used_hints.add(hn)
            used_stems.add(best_sn)
    return score


def icon_basename_from_path(entry: str) -> str | None:
    base = entry.replace('\\', '/').split('/')[-1].split('.')[0]
    if not re.search(r'T_[Ii]con', base):
        return None
    return f'{base}.png'


def icon_from_namemap(namemap: list[Any], *hint_parts: str | None) -> str | None:
    """Pick best T_Icon_* soft ref from NameMap, scored against row/asset hints."""
    hints = _tokenize_hint(*hint_parts)
    candidates: list[tuple[int, int, str]] = []
    seen: set[str] = set()
    for entry in namemap:
        if not isinstance(entry, str):
            continue
        path = entry.replace('\\', '/')
        lower = path.lower()
        icon = icon_basename_from_path(path)
        if not icon or icon.lower() in seen:
            continue
        seen.add(icon.lower())
        icon_lower = icon.lower()
        stem_tokens = _tokenize_hint(icon)
        rank = _token_overlap_score(hints, stem_tokens) if hints else 0
        if '/icons/seeds/' in lower or '/art/ui/icons/seeds/' in lower:
            rank += 15
        elif '/art/ui/icons/' in lower:
            rank += 5
        # Skill-tag / chrome icons share path tokens like "Farming" but are not item art.
        if 't_icon_tag_' in icon_lower or '/skills/' in lower or '/tags/' in lower:
            rank -= 50
        if 'journal' in lower:
            rank -= 20
        if '/plugins/marketplace/' in lower:
            rank -= 30
        candidates.append((-rank, len(icon), icon))
    if not candidates:
        return None
    candidates.sort()
    return candidates[0][2]


def camel_to_spaced(s: str) -> str:
    return ''.join((' ' + c if c.isupper() else c) for c in s).strip()


def spaced_tokens(s: str) -> list[str]:
    return [t.lower() for t in re.split(r'\s+', s) if t]


def hint_token_order(*hint_parts: str | None) -> list[str]:
    """Ordered tokens from rowName / asset stem (asset naming order)."""
    for part in hint_parts:
        if not part:
            continue
        cleaned = re.sub(r'^(ITEM_|RECIPE_)', '', part, flags=re.I)
        cleaned = re.sub(r'\.(json|uasset)$', '', cleaned, flags=re.I)
        cleaned = re.sub(
            r'^(weap_|ammo_|food_|potion_|armour_|armor_|res_|resource_|recipe_|mat_|item_)',
            '',
            cleaned,
            flags=re.I,
        )
        toks = [t for t in re.split(r'[_\s./-]+', cleaned.lower()) if len(t) >= 2]
        if toks:
            return toks
    return []


def pick_display_name_from_strings(
    strings: list[str],
    *,
    row: str | None,
    asset_stem: str | None,
    looks_like_junk_display,
) -> str | None:
    """Choose best CamelCase FString; prefer non-asset-order when alternates exist."""
    asset_order = hint_token_order(row, asset_stem)
    candidates: list[tuple[int, str]] = []
    seen: set[str] = set()

    for s in strings:
        if not s or s == row or s.startswith('ITEM_') or s.startswith('GE_'):
            continue
        if pick_persistence_id([s]):
            continue
        if '.' in s or s.startswith('recipe_') or s.startswith('food_') or s.startswith('weap_'):
            continue
        if '_' in s:
            continue
        if not (any(c.isupper() for c in s) and any(c.islower() for c in s)):
            continue
        spaced = camel_to_spaced(s)
        if looks_like_junk_display(spaced):
            continue
        key = spaced.lower()
        if key in seen:
            continue
        seen.add(key)
        tokens = spaced_tokens(spaced)
        score = 0
        if asset_order and tokens == asset_order:
            # Same order as row/asset → likely internal key, not localized title
            score -= 5
        elif asset_order and set(tokens) == set(asset_order) and tokens != asset_order:
            # Same words, different order → likely display title (Acrid Adhesive)
            score += 8
        if 2 <= len(tokens) <= 6:
            score += 1
        candidates.append((score, spaced))

    if not candidates:
        return None
    candidates.sort(key=lambda t: (-t[0], t[1]))
    return candidates[0][1]


def fmodel_props(data: Any) -> dict[str, Any] | None:
    """Return Properties dict from FModel-style export (list or dict)."""
    entries: list[Any]
    if isinstance(data, list):
        entries = data
    elif isinstance(data, dict):
        if 'Properties' in data:
            return data.get('Properties') or {}
        entries = [data]
    else:
        return None
    for entry in entries:
        if isinstance(entry, dict) and isinstance(entry.get('Properties'), dict):
            return entry['Properties']
    return None


def display_name_from_props(props: dict[str, Any]) -> str | None:
    name_obj = props.get('Name') or {}
    if isinstance(name_obj, dict):
        return (
            name_obj.get('SourceString')
            or name_obj.get('LocalizedString')
            or None
        )
    display = props.get('DisplayName')
    if isinstance(display, dict):
        return display.get('SourceString') or display.get('LocalizedString')
    return None


def persistence_from_props(props: dict[str, Any]) -> str | None:
    for key in ('PersistenceID', 'ItemID', 'PersistentID'):
        val = props.get(key)
        if isinstance(val, str) and val:
            return val
    return None


def namemap_item_assets(namemap: list[Any], self_name: str | None = None) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    for entry in namemap:
        if not isinstance(entry, str):
            continue
        base = entry.replace('\\', '/').split('/')[-1]
        if base.startswith('ITEM_') and not base.endswith('_C'):
            if self_name and base == self_name:
                continue
            if base not in seen:
                seen.add(base)
                found.append(base)
    return found


def namemap_skills(namemap: list[Any]) -> list[str]:
    out: list[str] = []
    for entry in namemap:
        if isinstance(entry, str) and entry.startswith('SKILL_'):
            base = entry.split('/')[-1]
            if base not in out:
                out.append(base)
    return out


# GameplayTags / processing markers on RECIPE_* NameMaps → player-facing station.
STATION_LABELS: dict[str, str] = {
    'Craft_Crafting_Table_Recipe_Tier1': 'Crafting Table',
    'Craft_Crafting_Table_Recipe_Tier2': 'Crafting Table',
    'Craft_Smithing_Forge_Tier3': 'Smithing Forge',
    'Craft_Smithing_Forge_Tier4': 'Smithing Forge',
    'Craft_Cooking_Range_Recipe': 'Cooking Range',
    'Craft_Herblore_Lab_Recipe': 'Brewing Cauldron',
    'Craft_Rune_Altar_Recipe': 'Rune Altar',
    'Process_Smelting_Tier3': 'Furnace',
    'Process_Smelting_Tier4': 'Furnace',
    'Process_Smelting_Tier5': 'Blast Furnace',
    'Process_Smelting_Tier6': 'Blast Furnace',
    'Pickup_Cooking_Pot_Processed_Item': 'Cooking Pot',
    'Pickup_Campfire_Processed_Item': 'Campfire',
    'Pickup_Campfire_Processed_Water': 'Campfire',
    'Fishing_Cook_Fish_Base': 'Campfire',
    'Build_Crafting_Station': 'Build menu',
    'Ore_Base': 'Grindstone',
}

STATION_ICONS: dict[str, str] = {
    'Crafting Table': 'T_Icon_Station_Crafting_Bench.png',
    'Smithing Forge': 'T_Icon_Station_Blacksmiths_Bench.png',
    'Cooking Range': 'T_Icon_Station_Cooking_Range.png',
    'Brewing Cauldron': 'T_Icon_Station_Cauldron.png',
    'Rune Altar': 'T_Icon_Station_Rune_Altar.png',
    'Furnace': 'T_Icon_Station_Furnace.png',
    'Blast Furnace': 'T_Icon_Station_Crucible.png',
    'Cooking Pot': 'T_Icon_Grill.png',
    'Campfire': 'T_Icon_Station_Campfire.png',
    'Grindstone': 'T_Icon_Station_Grindstone.png',
    'Jewelry Bench': 'T_Icon_Jeweller_Bench.png',
    'Build menu': 'T_Icon_Plans_Icon_Buildings.png',
}


def station_icon_for(label: str | None) -> str | None:
    if not label:
        return None
    return STATION_ICONS.get(label)



def namemap_station(
    namemap: list[Any],
    *,
    self_name: str = '',
    asset_path: str = '',
) -> tuple[str | None, str | None]:
    """Return (stationTag, station display name) from a recipe NameMap."""
    for entry in namemap:
        if isinstance(entry, str) and entry in STATION_LABELS:
            return entry, STATION_LABELS[entry]
    for entry in namemap:
        if not isinstance(entry, str):
            continue
        if entry == 'RuneRecipeData' or entry.endswith('RuneCrafting'):
            return entry, 'Rune Altar'
    blob = self_name.lower()
    path = asset_path.lower()
    if blob.startswith('recipe_trinket_'):
        return None, 'Jewelry Bench'
    if ('/jewellery/' in path or '/jewlery/' in path) and 'vendor' not in blob and 'journal' not in blob:
        return None, 'Jewelry Bench'
    return None, None


BUILDING_KEYWORDS = {
    'roof', 'wall', 'floor', 'foundation', 'door', 'window', 'stair', 'beam', 'pillar',
    'ramp', 'ceiling', 'arch', 'column', 'railing', 'balcony', 'deck', 'fence', 'gate',
    'blueprint', 'structure', 'plot', 'frame', 'support', 'tile', 'panel', 'trim',
    'chimney', 'post', 'trimming', 'ledger', 'joist', 'meshdata',
}


def is_junk_item_name(name: str) -> bool:
    tokens = set(re.split(r'[^a-z0-9]+', name.lower()))
    return any(kw in tokens for kw in BUILDING_KEYWORDS)


def categorize_from_path(asset_path: str, asset_name: str) -> tuple[str, str | None]:
    p = asset_path.replace('\\', '/')
    n = asset_name.lower()

    if '/Equipment/Head' in p:
        return 'Armour', 'Head'
    if '/Equipment/Body' in p:
        return 'Armour', 'Body'
    if '/Equipment/Legs' in p:
        return 'Armour', 'Legs'
    if '/Equipment/Cape' in p:
        return 'Armour', 'Cape'
    if '/Equipment/Jewellery' in p or '/Equipment/Jewlery' in p:
        return 'Jewellery', None
    if '/Equipment/Ammo' in p:
        return 'Ammo', None
    if '/Equipment/Held' in p:
        # Held covers tools, farming seeds, and weapons — use subfolders first.
        if (
            '/Farming/Seeds' in p
            or '/TreePlanting' in p
            or '/Seeds/' in p
            or 'seed' in n
        ):
            return 'Resources', 'Seeds'
        held_tool_folders = (
            '/Shovel', '/FishingRod', '/FishingNet', '/Bucket', '/Pickaxe',
            '/Hatchet', '/Torch', '/Hammer', '/Farming/',
        )
        if any(folder in p for folder in held_tool_folders):
            return 'Tools', None
        tool_keys = (
            'pickaxe', 'hatchet', 'axe_logging', 'logging', 'shovel', 'spade',
            'hammer', 'bucket', 'watering', 'torch', 'hoe', 'sickle', 'trowel',
            'secateur', 'fishing', 'net',
        )
        if any(k in n for k in tool_keys):
            return 'Tools', None
        if 'staff' in n:
            return 'Weapons', 'Magic'
        if 'bow' in n or 'crossbow' in n:
            return 'Weapons', 'Ranged'
        # Weapon-type folders under Held (Sword, Dagger, …) → Melee by default
        return 'Weapons', 'Melee'
    if '/Consumables/Food' in p:
        return 'Consumables', 'Food'
    if '/Consumables/Magic' in p or 'potion' in n or 'infusion' in n:
        return 'Consumables', 'Potions'
    if '/Consumables/Tomes' in p or 'tome' in n:
        return 'KeysQuestJournal', 'Tomes'
    if '/Resources/' in p:
        m = re.search(r'/Resources/([^/]+)/', p)
        sub = m.group(1) if m else None
        if sub and sub.lower() in {'magic', 'rune', 'runes'}:
            return 'MagicMaterials', sub
        if 'rune' in n or 'essence' in n:
            return 'MagicMaterials', sub
        return 'Resources', sub
    if '/Quest/' in p or '/Key/' in p:
        return 'KeysQuestJournal', 'Quest' if '/Quest/' in p else 'Key'
    return 'Misc', None


def categorize_from_name(name: str) -> tuple[str, str | None]:
    """Fallback name heuristics (after path)."""
    n = name.lower()
    rules: list[tuple[tuple[str, ...], str, str | None]] = [
        (('seed',), 'Resources', 'Seeds'),
        # Tools before weapon `axe` so pickaxe/hatchet do not become Melee.
        (('pickaxe', 'hatchet', 'shovel', 'spade', 'hammer', 'bucket', 'torch', 'secateur', 'fishing'), 'Tools', None),
        (('sword', 'scimitar', 'dagger', 'mace', 'whip', 'maul', 'warhammer', 'battleaxe', 'axe'), 'Weapons', 'Melee'),
        (('bow', 'crossbow'), 'Weapons', 'Ranged'),
        (('staff',), 'Weapons', 'Magic'),
        (('shield', 'kite', 'buckler', 'defender'), 'Armour', 'Shield'),
        (('helm', 'cowl', 'hood', 'hat'), 'Armour', 'Head'),
        (('platebody', 'body', 'robe', 'tunic', 'chest'), 'Armour', 'Body'),
        (('platelegs', 'legs', 'chaps'), 'Armour', 'Legs'),
        (('cape', 'cloak', 'skillcape'), 'Armour', 'Cape'),
        (('ring',), 'Jewellery', 'Ring'),
        (('amulet', 'necklace', 'pendant'), 'Jewellery', 'Amulet'),
        (('arrow', 'bolt'), 'Ammo', None),
        (('potion', 'infusion'), 'Consumables', 'Potions'),
        (('pie', 'stew', 'soup', 'roast', 'fried', 'dried', 'toastie', 'kebab', 'meat', 'fish', 'berry', 'potato', 'onion', 'mushroom', 'cabbage'), 'Consumables', 'Food'),
        (('rune', 'essence'), 'MagicMaterials', None),
        (('ore',), 'Resources', 'Metal'),
        (('bar',), 'Resources', 'Metal'),
        (('logs', 'plank', 'wood'), 'Resources', 'Wood'),
        (('herb', 'grimy'), 'Resources', 'Herb'),
        (('tome',), 'KeysQuestJournal', 'Tomes'),
        (('key',), 'KeysQuestJournal', 'Key'),
    ]
    for keys, cat, sub in rules:
        if any(k in n for k in keys):
            return cat, sub
    return 'Misc', None


def humanize_asset_name(asset: str) -> str:
    base = re.sub(r'^(ITEM_|RECIPE_)', '', asset)
    base = re.sub(r'\.(json|uasset)$', '', base, flags=re.I)
    # Strip common row prefixes
    base = re.sub(
        r'^(weap_|ammo_|food_|potion_|armour_|armor_|res_|resource_|recipe_|mat_|item_)',
        '',
        base,
        flags=re.I,
    )
    base = base.replace('_', ' ')
    base = re.sub(r'\s+', ' ', base).strip()
    return base.title()
