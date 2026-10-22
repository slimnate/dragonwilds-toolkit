"""Resolve Weight / MaxStackSize / BaseDurability / VitalShield from multiple sources.

Most ITEM_ RawExports omit default-equal properties (UE unversioned sparse
serialization). Runtime values historically came from exports/_bootstrap_ItemID.json
(~792 entries). Newer / DLC items are often missing there.

Resolution order (first hit wins per field):
1. Already-set item fields (FModel props / prior merge)
2. Bootstrap by persistenceId
3. Bootstrap by display name (and Cooling- stripped variants)
4. Bootstrap family siblings (asset stem with material/cooling tokens removed)
5. Role heuristics (ammo, fish food, infusions, …)
6. High-confidence RawExport pairs (PowerLevel|common-stack then Weight)
"""

from __future__ import annotations

import re
import struct
from collections import Counter
from typing import Any

# Tokens stripped when building an asset "family" key for sibling inference.
_FAMILY_DROP = {
    'adamant', 'mithril', 'iron', 'steel', 'bronze', 'blurite', 'obsidian', 'dragon',
    'oak', 'ash', 'yew', 'willow', 'maple', 'magic', 'wood', 'wooden', 'stone', 'bone',
    'cooling', 'bodkin', 'barbed', 'fire', 'poisoned', 'raw', 'burnt', 'pristine',
    'cooked', 'fried', 'grilled', 'dried',
    't1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9',
    't01', 't02', 't03', 't04', 't05', 't06', 't07', 't08', 't09',
}


def family_key(source_asset: str | None) -> str | None:
    if not source_asset:
        return None
    stem = re.sub(r'\.(json|uasset)$', '', source_asset, flags=re.I)
    parts = []
    for p in stem.split('_'):
        if not p:
            continue
        low = p.lower()
        if low in _FAMILY_DROP:
            continue
        if re.fullmatch(r't0*[1-9]', low):
            continue
        parts.append(p)
    return '_'.join(parts) if parts else None


def wearable_family_key(wearable_row: str | None) -> str | None:
    """T07_Armour_Body_Heavy -> Armour_Body_Heavy for cross-tier sibling stats."""
    if not wearable_row:
        return None
    cleaned = re.sub(r'^T0*[1-9]_', '', wearable_row)
    cleaned = re.sub(r'^Armour_T0*[1-9]_', 'Armour_', cleaned)
    return cleaned or None


def _nice_float(v: float) -> bool:
    if v != v or v < 0 or v > 500:
        return False
    return abs(v * 100 - round(v * 100)) < 1e-3


def parse_rawexport_inventory_props(
    raw: bytes,
    *,
    known_power_level: int | None = None,
) -> dict[str, Any]:
    """Conservative RawExport decode — sparse blobs create many false positives."""
    if not raw or len(raw) < 40:
        return {}

    ascii_starts = [m.start() for m in re.finditer(rb'[A-Za-z0-9_-]{20,24}', raw)]
    prop_limit = min(ascii_starts) if ascii_starts else len(raw)

    stack_like = {10, 20, 25, 50, 99, 100, 200, 500, 999}
    out: dict[str, Any] = {}
    pl_hits: list[tuple[int, float]] = []
    stack_hits: list[tuple[int, int, float]] = []

    for i in range(24, min(prop_limit, len(raw) - 8)):
        iv = struct.unpack_from('<i', raw, i)[0]
        fv = struct.unpack_from('<f', raw, i + 4)[0]
        if not _nice_float(fv):
            continue
        if known_power_level is not None and iv == int(known_power_level) and 0.5 <= fv <= 100:
            pl_hits.append((i, round(fv, 5)))
        elif iv in stack_like and 0 <= fv <= 100:
            stack_hits.append((i, iv, round(fv, 5)))

    if pl_hits:
        _i, weight = max(pl_hits, key=lambda t: t[0])
        out['powerLevel'] = int(known_power_level)  # type: ignore[arg-type]
        out['weight'] = weight

    if 'weight' not in out and stack_hits:
        _i, stack, weight = max(stack_hits, key=lambda t: t[0])
        out['maxStackSize'] = stack
        out['weight'] = weight

    if 'weight' in out and float(out['weight']) >= 1:
        w = float(out['weight'])
        w_offs = [
            i for i in range(24, min(prop_limit, len(raw) - 3))
            if abs(struct.unpack_from('<f', raw, i)[0] - w) < 1e-4
        ]
        for woff in w_offs[:2]:
            for j in range(max(24, woff - 48), min(prop_limit - 3, woff + 64)):
                dv = struct.unpack_from('<i', raw, j)[0]
                if 400 <= dv <= 5000 and dv % 50 == 0:
                    out['baseDurability'] = dv
                    break
            if 'baseDurability' in out:
                break

    return out


def _boot_fields(entry: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for src, dst in (
        ('Weight', 'weight'),
        ('MaxStackSize', 'maxStackSize'),
        ('VitalShield', 'vitalShield'),
        ('PowerLevel', 'powerLevel'),
        ('BaseDurability', 'baseDurability'),
        ('IconFile', 'icon'),
    ):
        if entry.get(src) is not None:
            out[dst] = entry[src]
    return out


def build_bootstrap_indexes(bootstrap: dict[str, dict[str, Any]]) -> dict[str, Any]:
    by_name: dict[str, dict[str, Any]] = {}
    for entry in bootstrap.values():
        name = (entry.get('SourceString') or '').strip().lower()
        if name and name not in by_name:
            by_name[name] = entry
    return {'by_name': by_name}


def index_items_into_families(
    items: list[dict[str, Any]],
    bootstrap: dict[str, dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    by_family: dict[str, list[dict[str, Any]]] = {}

    def add(key: str | None, enriched: dict[str, Any]) -> None:
        if key:
            by_family.setdefault(key, []).append(enriched)

    for item in items:
        boot = bootstrap.get(item.get('persistenceId') or '')
        if not boot or boot.get('Weight') is None:
            continue
        enriched = dict(boot)
        if enriched.get('PowerLevel') is None and item.get('powerLevel') is not None:
            enriched = {**enriched, 'PowerLevel': item['powerLevel']}
        add(family_key(item.get('sourceAsset')), enriched)
        add(wearable_family_key(item.get('wearableRow')), enriched)
    return by_family


def _mode(values: list[Any]) -> Any | None:
    vals = [v for v in values if v is not None]
    if not vals:
        return None
    return Counter(vals).most_common(1)[0][0]


def props_from_family(
    item: dict[str, Any],
    by_family: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    keys = [
        family_key(item.get('sourceAsset')),
        wearable_family_key(item.get('wearableRow')),
    ]
    sibs: list[dict[str, Any]] = []
    seen: set[int] = set()
    for key in keys:
        if not key or key not in by_family:
            continue
        for s in by_family[key]:
            sid = id(s)
            if sid in seen:
                continue
            seen.add(sid)
            sibs.append(s)
    if not sibs:
        return {}

    out: dict[str, Any] = {}
    w = _mode([s.get('Weight') for s in sibs])
    stack = _mode([s.get('MaxStackSize') for s in sibs])
    vs = _mode([s.get('VitalShield') for s in sibs])
    if w is not None:
        out['weight'] = w
    if stack is not None:
        out['maxStackSize'] = stack
    if vs is not None:
        out['vitalShield'] = vs

    pl = item.get('powerLevel')
    dur_sibs = [s for s in sibs if s.get('BaseDurability') is not None]
    if dur_sibs:
        if isinstance(pl, (int, float)):
            dur_sibs.sort(
                key=lambda s: (
                    abs(int(s.get('PowerLevel') or 0) - int(pl)),
                    -int(s.get('PowerLevel') or 0),
                )
            )
        else:
            dur_sibs.sort(key=lambda s: -int(s.get('PowerLevel') or 0))
        out['baseDurability'] = dur_sibs[0]['BaseDurability']
    return out


def props_from_name_bootstrap(
    item: dict[str, Any],
    by_name: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    name = (item.get('name') or '').strip()
    if not name:
        return {}
    variants = [
        name,
        re.sub(r'^Cooling\s+', '', name, flags=re.I).strip(),
        re.sub(r'\s+Cooling\b', '', name, flags=re.I).strip(),
        name.replace('Cooling ', '').replace(' Cooling', '').strip(),
    ]
    if name.lower().startswith('cooling '):
        variants.append(name[8:].strip())
    for v in variants:
        hit = by_name.get(v.lower())
        if hit:
            return _boot_fields(hit)
    return {}


def props_from_role_heuristics(item: dict[str, Any]) -> dict[str, Any]:
    """Last-resort defaults for roles with stable inventory stats in bootstrap."""
    asset = (item.get('sourceAsset') or '').lower()
    name = (item.get('name') or '').lower()
    cat = item.get('category')
    path = (item.get('assetPath') or '').lower()
    blob = f'{asset} {name} {path}'
    out: dict[str, Any] = {}

    if cat == 'Ammo' or 'item_ammo_' in asset or '/ammo/' in path:
        return {'weight': 0, 'maxStackSize': 999, 'vitalShield': 0}

    if 'item_consumable_tea_' in asset or 'infusion' in name:
        return {'weight': 1, 'maxStackSize': 50, 'vitalShield': 0}

    if 'item_consumable_fish_' in asset or (
        cat == 'Consumables' and any(k in blob for k in ('fried', 'grilled', 'burnt'))
    ):
        return {'weight': 0.4, 'maxStackSize': 99, 'vitalShield': 0}

    if 'item_resources_fish_' in asset:
        return {'weight': 0.45, 'maxStackSize': 99, 'vitalShield': 0}

    if cat == 'Consumables' and 'potion' in blob:
        return {'weight': 1, 'maxStackSize': 50, 'vitalShield': 0}

    if cat == 'Armour' and ('cape' in blob or 'cloak' in blob or 'skillcape' in blob):
        return {'weight': 0, 'maxStackSize': 1, 'vitalShield': 0}

    if 'item_farming_seed_' in asset or (cat == 'Resources' and 'seed' in name):
        return {'weight': 0, 'maxStackSize': 999, 'vitalShield': 0}

    if cat == 'Jewellery' or 'trinket' in asset:
        return {'weight': 1, 'maxStackSize': 1, 'vitalShield': 0}

    if 'item_resources_' in asset and cat in {'Resources', 'Misc'}:
        return {'weight': 1, 'maxStackSize': 99, 'vitalShield': 0}

    if cat == 'Armour' and ('hat' in name or 'hat' in asset):
        return {'weight': 2, 'maxStackSize': 1, 'vitalShield': 0}

    if cat == 'KeysQuestJournal' or 'item_quest_' in asset or 'journal' in asset:
        return {'weight': 0, 'maxStackSize': 1, 'vitalShield': 0}

    if cat == 'Weapons' and ('deprecated' in asset or 'anima' in name):
        return {'weight': 0, 'maxStackSize': 1, 'vitalShield': 0}

    return out


def merge_props(dst: dict[str, Any], src: dict[str, Any]) -> int:
    filled = 0
    for key in ('weight', 'maxStackSize', 'vitalShield', 'powerLevel', 'baseDurability', 'icon'):
        if dst.get(key) is None and src.get(key) is not None:
            dst[key] = src[key]
            filled += 1
    return filled


def resolve_inventory_props(
    item: dict[str, Any],
    *,
    bootstrap: dict[str, dict[str, Any]],
    by_name: dict[str, dict[str, Any]],
    by_family: dict[str, list[dict[str, Any]]],
    raw_bytes: bytes | None = None,
) -> int:
    """Fill missing inventory fields on item. Returns count of fields added."""
    before = sum(
        1 for k in ('weight', 'maxStackSize', 'vitalShield', 'baseDurability', 'powerLevel')
        if item.get(k) is not None
    )
    filled = 0

    pid = item.get('persistenceId')
    if pid and pid in bootstrap:
        filled += merge_props(item, _boot_fields(bootstrap[pid]))

    filled += merge_props(item, props_from_name_bootstrap(item, by_name))
    filled += merge_props(item, props_from_family(item, by_family))
    filled += merge_props(item, props_from_role_heuristics(item))

    if raw_bytes:
        filled += merge_props(
            item,
            parse_rawexport_inventory_props(
                raw_bytes,
                known_power_level=item.get('powerLevel') if isinstance(item.get('powerLevel'), int) else None,
            ),
        )

    if item.get('weight') is not None and item.get('vitalShield') is None:
        item['vitalShield'] = 0
        filled += 1

    after = sum(
        1 for k in ('weight', 'maxStackSize', 'vitalShield', 'baseDurability', 'powerLevel')
        if item.get(k) is not None
    )
    return max(filled, after - before)
