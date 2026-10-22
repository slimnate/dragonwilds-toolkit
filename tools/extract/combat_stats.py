"""Attach resolved combat stats onto normalized item dicts."""

from __future__ import annotations

import re
from typing import Any

from export_combat_tables import COMBAT_DATA_DIR, load_combat_tables

WEAPON_FAMILY_PATH = [
    ('AbyssalWhip', 'AbyssalWhip'),
    ('Toktz', 'Toktz-ket-xil'),
    ('Greatsword', 'Greatsword'),
    ('GreatSword', 'Greatsword'),
    ('Greataxe', 'Greataxe'),
    ('GreatAxe', 'Greataxe'),
    ('Warhammer', 'Warhammer'),
    ('Scimitar', 'Scimitar'),
    ('Crossbow', 'Crossbow'),
    ('Dagger', 'Dagger'),
    ('Sword', 'Sword'),
    ('Mace', 'Club'),
    ('Club', 'Club'),
    ('Shield', 'Shield'),
    ('Staff', 'Wands'),
    ('Wand', 'Wands'),
]

BOW_HINTS = ('bow', 'longbow', 'shortbow')

# Fallback when PowerLevel is missing from bootstrap/props (e.g. UmbralSands adamant).
MATERIAL_POWER_LEVEL: list[tuple[str, int]] = [
    ('adamant', 7),
    ('mithril', 6),
    ('obsidian', 7),
    ('steel', 5),
    ('iron', 4),
    ('bronze', 2),
    ('blurite', 3),
    ('yew', 7),
    ('maple', 6),
    ('willow', 5),
    ('oak', 3),
    ('ash', 2),
]


def infer_power_level(item: dict[str, Any]) -> int | None:
    pl = item.get('powerLevel')
    if isinstance(pl, (int, float)) and 1 <= int(pl) <= 9:
        return int(pl)
    for text in (item.get('sourceAsset'), item.get('assetPath'), item.get('wearableRow')):
        if not text:
            continue
        m = re.search(r'(?:^|[_\-/])T0*([1-9])(?:[_\-/]|$)', str(text), flags=re.I)
        if m:
            return int(m.group(1))
    blob = ' '.join(
        str(item.get(k) or '') for k in ('name', 'sourceAsset', 'assetPath')
    ).lower()
    for mat, level in MATERIAL_POWER_LEVEL:
        if mat in blob:
            return level
    return None


def infer_weapon_family(item: dict[str, Any], namemap: list[Any] | None = None) -> str | None:
    path = (item.get('assetPath') or item.get('sourceAsset') or '').replace('\\', '/')
    lower = path.lower()
    for needle, family in WEAPON_FAMILY_PATH:
        if needle.lower() in lower:
            return family
    name = (item.get('name') or '').lower()
    for needle, family in WEAPON_FAMILY_PATH:
        if needle.lower() in name:
            return family
    if namemap:
        for entry in namemap:
            if not isinstance(entry, str):
                continue
            base = entry.replace('\\', '/').split('/')[-1]
            if base in (
                'Sword', 'Dagger', 'Club', 'Scimitar', 'Greatsword', 'Greataxe',
                'Warhammer', 'Shield', 'Crossbow', 'Wands', 'AbyssalWhip', 'Toktz-ket-xil',
                'Tools', 'Unarmed',
            ):
                return base
    return None


def infer_power_curve(item: dict[str, Any]) -> str:
    path = (item.get('assetPath') or item.get('sourceAsset') or '').lower()
    name = (item.get('name') or '').lower()
    sub = (item.get('subcategory') or '').lower()
    blob = f'{path} {name} {sub}'
    if any(h in blob for h in BOW_HINTS) and 'crossbow' not in blob:
        return 'Bows'
    return 'Weapons'


def extract_combat_refs(namemap: list[Any], item: dict[str, Any]) -> dict[str, Any]:
    """Pull soft refs / tags from NameMap relevant to combat display."""
    damage_types: list[str] = []
    abilities: dict[str, str] = {}
    wearable_row: str | None = None
    equipment_kind: str | None = None
    skills: list[str] = []
    wear_keys: set[str] = set()

    combat_skills = {
        'SKILL_Attack', 'SKILL_Ranged', 'SKILL_Magic', 'SKILL_Defense',
    }

    for entry in namemap:
        if not isinstance(entry, str):
            continue
        if entry.startswith('DamageType.'):
            damage_types.append(entry)
            continue
        if entry in ('HeldEquipmentData', 'WearableEquipmentData'):
            equipment_kind = 'held' if entry.startswith('Held') else 'wearable'
            continue

        path = entry.replace('\\', '/')
        base = path.split('/')[-1]
        if base.endswith('_C'):
            base = base[:-2]

        if base in combat_skills or entry in combat_skills:
            skills.append(base if base in combat_skills else entry)
            continue

        if base.startswith('PA_'):
            low = base.lower()
            if 'special' in low:
                abilities.setdefault('special', base)
            elif 'block' in low:
                abilities.setdefault('block', base)
            elif 'magicattack_primary' in low:
                abilities.setdefault('primary', base)
            elif 'magicattack_secondary' in low:
                abilities.setdefault('special', base)
            elif 'attack' in low or low.startswith('pa_aim_'):
                abilities.setdefault('primary', base)
            continue

        if 'MeshData' in base:
            continue
        if re.match(
            r'^(Armour_|T0\d+_Armour_|Cape_|Jewellery_|Item_Trinket_|ITEM_Armour_Head_|ITEM_Trinket_)',
            base,
        ):
            wear_keys.add(base)

    if wear_keys:
        preferred = sorted(
            wear_keys,
            key=lambda s: (
                0 if re.match(r'^T0\d+_Armour_', s) else
                1 if s.startswith('Armour_') else
                2 if s.startswith('Cape_') else
                3,
                len(s),
            ),
        )
        wearable_row = preferred[0]

    out: dict[str, Any] = {}
    if damage_types:
        out['damageTypes'] = sorted(set(damage_types))
    if abilities:
        out['abilities'] = abilities
    if wearable_row:
        out['wearableRow'] = wearable_row
    if equipment_kind:
        out['equipmentKind'] = equipment_kind
    if skills:
        out['combatSkills'] = sorted(set(skills))
    return out


def _curve_value(curve: list[float] | None, power_level: int | None) -> float | None:
    if not curve or power_level is None:
        return None
    idx = power_level - 1
    if 0 <= idx < len(curve):
        return curve[idx]
    return None


def apply_combat_stats(item: dict[str, Any], tables: dict[str, Any] | None = None) -> dict[str, Any]:
    """Resolve DT lookups onto an item in-place and return it."""
    tables = tables or load_combat_tables(COMBAT_DATA_DIR)
    cat = item.get('category')
    pl = infer_power_level(item)
    if pl is not None and item.get('powerLevel') is None:
        item['powerLevel'] = pl
        item['powerLevelInferred'] = True

    # Wearable / armour / jewellery / cape
    wear_row = item.get('wearableRow')
    wear_tables = tables.get('wearable') or {}
    if wear_row and wear_row in wear_tables:
        row = wear_tables[wear_row]
        defense = {k: row[k] for k in (
            'armourValue', 'meleeResistance', 'rangedResistance', 'magicResistance', 'maxVitalShield',
        ) if k in row}
        if defense:
            item['defense'] = defense
    elif cat in ('Armour', 'Jewellery') and not wear_row:
        # Try source stem against wearable keys
        stem = re.sub(r'^ITEM_', '', (item.get('sourceAsset') or '').replace('.json', '').replace('.uasset', ''))
        # Adventurers body asset -> Armour_T1_Body_Adventurers
        candidates = [
            stem,
            stem.replace('Armour_', 'Armour_') ,
            re.sub(r'^Armour_T(\d+)_', lambda m: f'T{int(m.group(1)):02d}_Armour_', stem),
        ]
        for cand in candidates:
            if cand in wear_tables:
                item['wearableRow'] = cand
                row = wear_tables[cand]
                defense = {k: row[k] for k in (
                    'armourValue', 'meleeResistance', 'rangedResistance', 'magicResistance', 'maxVitalShield',
                ) if k in row}
                if defense:
                    item['defense'] = defense
                break

    # Held weapons / tools / shields
    is_weaponish = cat in ('Weapons', 'Tools', 'Ammo') or item.get('equipmentKind') == 'held'
    if is_weaponish and cat != 'Ammo':
        family = item.get('weaponFamily') or infer_weapon_family(item)
        curve_name = item.get('powerCurve') or infer_power_curve(item)
        if family:
            item['weaponFamily'] = family
        item['powerCurve'] = curve_name
        curves = tables.get('powerCurves') or {}
        weapon_power = _curve_value(curves.get(curve_name), pl)
        if weapon_power is not None:
            item['weaponPower'] = weapon_power
        neg = tables.get('damageNegation') or {}
        if family and family in neg:
            dn = _curve_value(neg[family], pl)
            if dn is not None:
                item['damageNegation'] = dn

        # Unique special display labels from ST_WeaponAttacks
        attacks = tables.get('weaponAttacks') or {}
        special_label = None
        for key, val in attacks.items():
            if not key.endswith('Special'):
                continue
            prefix = key[: -len('Special')]
            blob = ' '.join(str(item.get(k) or '') for k in (
                'name', 'sourceAsset', 'assetPath', 'weaponFamily',
            )).replace(' ', '').lower()
            if prefix.lower() in blob.replace('_', '').lower():
                special_label = val
                break
        if special_label:
            abilities = dict(item.get('abilities') or {})
            abilities['specialName'] = special_label
            item['abilities'] = abilities

    return item


def attach_refs_during_parse(item: dict[str, Any], namemap: list[Any] | None) -> None:
    if not namemap:
        return
    refs = extract_combat_refs(namemap, item)
    item.update(refs)
