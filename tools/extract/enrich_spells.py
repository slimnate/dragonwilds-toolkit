"""Merge wiki Infobox Spell fields into data/spells.json.

Raw USD dumps are gitignored; this fills names/descriptions/levels/cooldowns
from https://dragonwilds.runescape.wiki while keeping persistence IDs and icons
from the extracted catalog.
"""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from common import DATA_DIR, write_json

WIKI_API = 'https://dragonwilds.runescape.wiki/api.php'
UA = 'rsdw-mods-spell-enricher/1.0 (local extract; https://github.com/)'

ROW_ALIASES = {
    'usd_accesspersonalchest': 'personal chest',
    'usd_treequipment': 'bark to bones',
    'usd_fishcyclone': 'fishnado',
    'usd_detectanimavents': 'summon elemental spirits',
    'usd_detectore': 'summon stone spirits',
    'usd_detectorealt': '',
    'usd_farming_compost': 'mucksplosion',
    'usd_harvest': 'uproot',
    'usd_corruptionarrows': 'spectral arrows',
    'usd_ferociousfurnace': 'superheat',
    'usd_speedupstation': 'overdrive',
    'usd_pileemup': 'trunk totem',
    'usd_snaretrap': 'snare',
    'usd_farming_rapidgrowth': 'rapid growth',
    'usd_farming_compost': 'mucksplosion',
    'usd_axtralprojection': 'axtral projection',
    'usd_enchantchefstools': '',
}

NOISE_NAMES = {
    'pickaxe',
    'fishing rod',
    'fishing rod equipped',
    'woodcutting veteran',
    'harvest spell',
}


def norm(value: str) -> str:
    text = value.lower()
    text = re.sub(r'\(spell\)', '', text)
    text = re.sub(r'[^a-z0-9]+', '', text)
    return text


def api(params: dict[str, str]) -> dict[str, Any]:
    query = urllib.parse.urlencode({**params, 'format': 'json'})
    req = urllib.request.Request(f'{WIKI_API}?{query}', headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.loads(response.read().decode('utf-8'))


def category_titles() -> list[str]:
    titles: list[str] = []
    cont: dict[str, str] = {}
    while True:
        payload = api({
            'action': 'query',
            'list': 'categorymembers',
            'cmtitle': 'Category:Spells',
            'cmlimit': '100',
            'cmnamespace': '0',
            **cont,
        })
        for row in payload.get('query', {}).get('categorymembers', []):
            title = row.get('title')
            if title and title != 'Spells':
                titles.append(title)
        cont_token = payload.get('continue', {})
        if not cont_token:
            break
        cont = {key: str(value) for key, value in cont_token.items()}
    return titles


def parse_infobox(text: str) -> dict[str, str]:
    match = re.search(r'\{\{Infobox Spell\b(.*?)\n\}\}', text, re.S | re.I)
    if not match:
        return {}
    body = match.group(1)
    fields: dict[str, str] = {}
    for raw in re.split(r'\n\|', body):
        if '=' not in raw:
            continue
        key, value = raw.split('=', 1)
        key = key.strip().lower()
        value = re.sub(r'\s+', ' ', value).strip()
        value = re.sub(r'\[\[([^|\]]+\|)?([^\]]+)\]\]', r'\2', value)
        # Adjacent {{RuneReq|Air=20}}{{RuneReq|Astral=10}} must stay pipe-separated.
        value = re.sub(r'\{\{RuneReq\|([^}]+)\}\}', lambda match: f'{match.group(1)}|', value)
        value = value.removesuffix('|').strip(' |')
        value = re.sub(r"'{2,}", '', value)
        if key and value:
            fields[key] = value
    return fields


def fetch_pages(titles: list[str]) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    for i in range(0, len(titles), 20):
        chunk = titles[i:i + 20]
        payload = api({
            'action': 'query',
            'prop': 'revisions',
            'rvprop': 'content',
            'rvslots': 'main',
            'titles': '|'.join(chunk),
        })
        pages = payload.get('query', {}).get('pages', {})
        for page in pages.values():
            title = page.get('title') or ''
            revisions = page.get('revisions') or []
            if not revisions:
                continue
            slot = revisions[0].get('slots', {}).get('main', {})
            text = slot.get('*') or ''
            fields = parse_infobox(text)
            if not fields:
                continue
            name = fields.get('name') or title
            fields['name'] = name
            fields['page'] = title
            out[norm(name)] = fields
            out[norm(title)] = fields
    return out


def cooldown_seconds(value: str | None) -> float | None:
    if not value:
        return None
    match = re.search(r'([\d.]+)\s*s', value, re.I)
    if match:
        return float(match.group(1))
    match = re.search(r'[\d.]+', value)
    return float(match.group(0)) if match else None


def level_number(value: str | None) -> int | None:
    if not value:
        return None
    match = re.search(r'\d+', value)
    return int(match.group(0)) if match else None


def lookup(wiki: dict[str, dict[str, str]], spell: dict[str, Any]) -> dict[str, str] | None:
    row = str(spell.get('rowName') or '').lower()
    alias = ROW_ALIASES.get(row)
    candidates = [
        alias,
        spell.get('name'),
        re.sub(r'^USD_', '', str(spell.get('rowName') or ''), flags=re.I),
    ]
    for candidate in candidates:
        if not candidate:
            continue
        hit = wiki.get(norm(str(candidate)))
        if hit:
            return hit
    return None


def main() -> int:
    path = DATA_DIR / 'spells.json'
    payload = json.loads(path.read_text(encoding='utf-8'))
    spells: list[dict[str, Any]] = payload.get('spells') or []
    extra = [
        'Enfeeble',
        'Vengeance',
        'Enchant Weapon: Earth',
        'Enchant Weapon: Water',
        'Phase Dash',
        'Recall',
        'Overdrive',
        'Personal Chest (spell)',
        'Bark To Bones',
    ]
    titles = list(dict.fromkeys(category_titles() + extra))
    wiki = fetch_pages(titles)
    matched = 0
    renamed = 0
    for spell in spells:
        hit = lookup(wiki, spell)
        if not hit:
            continue
        if hit.get('skill') and spell.get('skill'):
            if norm(str(hit['skill'])) != norm(str(spell['skill'])):
                continue
        matched += 1
        current = str(spell.get('name') or '')
        wiki_name = hit.get('name') or current
        via_alias = bool(ROW_ALIASES.get(str(spell.get('rowName') or '').lower()))
        if wiki_name and wiki_name != current:
            if current.lower() in NOISE_NAMES or via_alias or norm(current) == norm(wiki_name):
                spell['name'] = wiki_name
                renamed += 1
        if hit.get('description') and not spell.get('description'):
            spell['description'] = hit['description']
        if hit.get('skill') and not spell.get('skill'):
            spell['skill'] = hit['skill']
        level = level_number(hit.get('level'))
        if level is not None:
            spell['level'] = level
        cooldown = cooldown_seconds(hit.get('cooldown'))
        if cooldown is not None:
            spell['cooldown'] = cooldown
        if hit.get('runes'):
            spell['runes'] = hit['runes']
    payload['meta'] = {
        **(payload.get('meta') or {}),
        'wikiMatched': matched,
        'wikiRenamed': renamed,
    }
    write_json(path, payload)
    print(f'Matched {matched}/{len(spells)} spells, renamed {renamed} -> {path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
