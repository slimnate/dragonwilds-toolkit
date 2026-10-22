"""Build data/quests.json from extracted Quest_ + ST_ assets."""

from __future__ import annotations

import argparse
import base64
import re
import struct
from pathlib import Path
from typing import Any

from common import (
    DATA_DIR,
    PID_RE,
    camel_to_spaced,
    current_usmap_name,
    write_json,
)

RAW_ROOT = Path(__file__).resolve().parents[2] / 'exports' / 'raw_quests'
LEGACY_ROOT = Path(__file__).resolve().parents[2] / 'exports' / 'legacy_quests'

HEX32_RE = re.compile(r'^[0-9A-Fa-f]{32}$')
KEY_RE = re.compile(r'^[A-Za-z][A-Za-z0-9_.]*$')
WORD_NUM = {
    'Zero': '0',
    'One': '1',
    'Two': '2',
    'Three': '3',
    'Four': '4',
    'Five': '5',
    'Six': '6',
    'Seven': '7',
    'Eight': '8',
    'Nine': '9',
}
NAME_KEYS = (
    'QuestName',
    'Quest.Name',
    'QuestTitle',
    'Quest_Title',
    'Title',
)
DESC_KEYS = (
    'QuestDesc',
    'Quest.Description',
    'Quest.Desc',
    'QuestDescription',
    'Quest_Description',
    'Description',
)
NAMEMAP_SKIP = {
    'Package',
    'Class',
    'StringTable',
    'QuestData',
    'Default__QuestData',
    'CoreUObject',
    'Engine',
    'Dominion',
}
MAIN_STEMS = {
    'Quest_DragonSlayer',
    'Quest_DeathQuestMain',
    'Quest_SW_MainQuest',
    'Quest_UmS_MainQuest',
    'Quest_DR_MainQuest',
}


def extract_fstrings(raw: bytes, maxn: int = 1200) -> list[str]:
    out: list[str] = []
    i = 0
    while i + 4 <= len(raw):
        n = struct.unpack_from('<i', raw, i)[0]
        if 2 <= n <= maxn and i + 4 + n <= len(raw):
            chunk = raw[i + 4:i + 4 + n]
            if chunk.endswith(b'\x00') and all(32 <= b < 127 or b == 0 for b in chunk):
                s = chunk[:-1].decode('ascii', errors='ignore')
                if s:
                    out.append(s)
                i += 4 + n
                continue
        if n < 0:
            count = -n
            nbytes = count * 2
            if 2 <= count <= 600 and i + 4 + nbytes <= len(raw):
                chunk = raw[i + 4:i + 4 + nbytes]
                if chunk.endswith(b'\x00\x00'):
                    try:
                        s = chunk.decode('utf-16-le').rstrip('\x00')
                        if s:
                            out.append(s)
                            i += 4 + nbytes
                            continue
                    except UnicodeDecodeError:
                        pass
        i += 1
    return out


def parse_st_map(strings: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    i = 0
    if strings and strings[0].startswith('ST_'):
        i = 1
    while i < len(strings):
        key = strings[i]
        if '\x00' in key or not KEY_RE.match(key) or len(key) > 120:
            i += 1
            continue
        if i + 1 >= len(strings):
            break
        value = strings[i + 1]
        if '\x00' in value:
            i += 1
            continue
        out[key] = value
        i += 2
    return out


def load_json(path: Path) -> Any:
    return __import__('json').loads(path.read_text(encoding='utf-8-sig'))


def export_bytes(json_path: Path) -> bytes:
    data = load_json(json_path)
    exports = data.get('Exports') or []
    raw = exports[0].get('Data') if exports and isinstance(exports[0], dict) else None
    if isinstance(raw, str) and raw:
        return base64.b64decode(raw)
    return b''


def uexp_bytes(json_path: Path) -> bytes:
    rel = json_path.as_posix()
    marker = '/raw_quests/'
    if marker in rel:
        legacy = Path(rel.replace('/raw_quests/', '/legacy_quests/', 1)).with_suffix('.uexp')
        if legacy.exists():
            return legacy.read_bytes()
    sibling = LEGACY_ROOT / json_path.name
    alt = sibling.with_suffix('.uexp')
    return alt.read_bytes() if alt.exists() else b''


def collect_strings(json_path: Path) -> list[str]:
    out: list[str] = []
    for blob in (export_bytes(json_path), uexp_bytes(json_path)):
        if not blob:
            continue
        for value in extract_fstrings(blob):
            if '\x00' in value:
                continue
            cleaned = value.strip()
            if cleaned:
                out.append(cleaned)
    return out


def is_real_pid(value: str) -> bool:
    if not PID_RE.match(value):
        return False
    if HEX32_RE.match(value):
        return False
    if value.startswith(('Quest_', 'ST_', 'QF_', 'Objective', 'Task')):
        return False
    if any(token in value for token in ('Title', 'Description', 'Objective', 'Defeat', 'QuestName')):
        return False
    if value.islower() and '_' in value:
        return False
    if '_' in value and value[0].isupper() and not any(ch.isdigit() for ch in value):
        return False
    letters = [ch for ch in value if ch.isalpha()]
    if letters and (all(ch.isupper() for ch in letters) or all(ch.islower() for ch in letters)):
        return False
    return True


def persistence_id(strings: list[str]) -> str | None:
    for value in strings:
        if is_real_pid(value):
            return value
    return None


def namemap_stems(namemap: list[Any]) -> list[str]:
    stems: list[str] = []
    seen: set[str] = set()
    for entry in namemap:
        if not isinstance(entry, str):
            continue
        base = entry.replace('\\', '/').split('/')[-1].split('.')[0]
        if base.startswith('ST_') and base not in seen:
            seen.add(base)
            stems.append(base)
    return stems


def sibling_st_stems(json_path: Path) -> list[str]:
    return sorted(p.stem for p in json_path.parent.glob('ST_*.json'))


def bind_table(
    json_path: Path,
    namemap: list[Any],
    tables: dict[str, dict[str, str]],
) -> dict[str, str]:
    refs: list[str] = []
    for stem in namemap_stems(namemap) + sibling_st_stems(json_path):
        if stem in tables and stem not in refs:
            refs.append(stem)
    quest_stem = json_path.stem.replace('Quest_', '', 1)
    for candidate in (f'ST_{quest_stem}', f'ST_{json_path.stem}', f'ST_{quest_stem}_v2'):
        if candidate in tables and candidate not in refs:
            refs.append(candidate)
    refs.sort(key=lambda stem: -st_score(stem, json_path.stem))
    merged: dict[str, str] = {}
    for stem in refs:
        for key, value in tables[stem].items():
            if key not in merged:
                merged[key] = value
    return merged


def is_generic_key(key: str) -> bool:
    if key in NAME_KEYS or key in DESC_KEYS:
        return True
    if key in {'Title', 'Description', 'QuestTitle'}:
        return True
    if re.match(r'^(QuestObjective|Quest\.Objective|Objective)[\._]?\d+[a-z]?$', key):
        return True
    if re.match(r'^Objective(Zero|One|Two|Three|Four|Five|Six|Seven|Eight|Nine)$', key):
        return True
    if re.match(r'^Task\d+\.(Name|name|Description|Desc)$', key):
        return True
    if key in {'Quest.Name', 'Quest.Description', 'Quest.Desc'}:
        return True
    return False


def lookup_key(key: str, bound: dict[str, str], tables: dict[str, dict[str, str]]) -> str | None:
    if key in bound:
        return bound[key]
    if is_generic_key(key):
        return None
    hits = [table[key] for table in tables.values() if key in table]
    if len(hits) == 1:
        return hits[0]
    return None


def st_score(st_stem: str, quest_stem: str) -> int:
    quest = quest_stem.lower().replace('quest_', '')
    table = st_stem.lower().replace('st_', '')
    score = 0
    if table == quest or table == f'{quest}_v2' or table.rstrip('v2').rstrip('_') == quest:
        score += 50
    if quest in table or table in quest:
        score += 20
    for token in re.findall(r'tribe[abc]|task\d+|ftue_[a-z0-9]+|mappingthesands2?', quest):
        compact = token.replace('_', '')
        if compact and compact in table.replace('_', ''):
            score += 15
    return score


def is_name_key(key: str) -> bool:
    lower = key.lower()
    return (
        key in NAME_KEYS
        or lower.endswith('.name')
        or lower.endswith('_name')
        or lower.endswith('_title')
        or lower.endswith('questname')
        or lower == 'title'
        or bool(re.match(r'^task\d+\.name$', lower))
    )


def is_desc_key(key: str) -> bool:
    lower = key.lower()
    return (
        key in DESC_KEYS
        or lower.endswith('.description')
        or lower.endswith('.desc')
        or lower.endswith('_desc')
        or lower.endswith('_description')
        or lower.endswith('questdesc')
        or lower.endswith('questdescription')
        or lower == 'description'
    )


def is_objective_key(key: str) -> bool:
    lower = key.lower()
    if 'title' in lower and 'objective' not in lower:
        return False
    return (
        'objective' in lower
        or key.startswith('QuestObjective')
        or '.Objective' in key
    )


def ftue_prefix(stem: str) -> str | None:
    match = re.match(r'^Quest_FTUE_(.+)$', stem)
    if not match:
        return None
    token = match.group(1)
    aliases = {
        'WardStones': 'WS_',
        'RtftJ': 'RTftJ_',
        'FS': 'FS_',
        'GS': 'GS_',
        'LO': 'LO_',
        'RC': 'RC_',
        'RM': 'RM_',
    }
    return aliases.get(token)


def resolve_name(
    stem: str,
    fkeys: list[str],
    strings: list[str],
    bound: dict[str, str],
    tables: dict[str, dict[str, str]],
) -> str:
    for key in fkeys:
        if is_name_key(key):
            text = lookup_key(key, bound, tables)
            if text:
                return text
    prefix = ftue_prefix(stem)
    if prefix:
        for suffix in ('Title', 'QuestName', 'name', 'Name'):
            text = lookup_key(f'{prefix}{suffix}', bound, tables)
            if text:
                return text
    for key in NAME_KEYS:
        text = lookup_key(key, bound, tables)
        if text:
            return text
    for key in fkeys:
        pretty = name_from_key(key)
        if pretty:
            return pretty
    for value in inline_texts(strings):
        if value.startswith('[PH]'):
            return value.replace('[PH]', '', 1).strip()
        if 3 <= len(value.split()) <= 6 and not value.endswith('.'):
            return value
    rest = stem.replace('Quest_', '', 1).replace('_', ' ')
    return camel_to_spaced(rest) or stem


def resolve_description(stem: str, fkeys: list[str], bound: dict[str, str], tables: dict[str, dict[str, str]]) -> str | None:
    for key in fkeys:
        if is_desc_key(key):
            text = lookup_key(key, bound, tables)
            if text:
                return text
    prefix = ftue_prefix(stem)
    if prefix:
        for suffix in ('Desc', 'Description', 'QuestDesc', 'QuestDescription'):
            text = lookup_key(f'{prefix}{suffix}', bound, tables)
            if text:
                return text
    for key in DESC_KEYS:
        text = lookup_key(key, bound, tables)
        if text:
            return text
    return None


def namemap_objective_ids(namemap: list[Any]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for entry in namemap:
        if not isinstance(entry, str):
            continue
        if entry in NAMEMAP_SKIP or entry in seen:
            continue
        if entry.startswith(('/', 'ST_', 'QF_', 'Quest_', '/Script', '/Game')):
            continue
        if entry in NAME_KEYS or entry in DESC_KEYS:
            continue
        if re.match(r'^A_[A-Z]', entry):
            continue
        if HEX32_RE.match(entry):
            continue
        seen.add(entry)
        out.append(entry)
    return out


def inline_texts(strings: list[str]) -> list[str]:
    out: list[str] = []
    for value in strings:
        if '\x00' in value or HEX32_RE.match(value) or is_real_pid(value):
            continue
        if KEY_RE.match(value):
            continue
        if ' ' in value and len(value) > 8:
            out.append(value)
    return out


def name_from_key(key: str) -> str | None:
    for suffix in ('_name', '_Name', '.Name', '_Title', '_title', 'QuestName'):
        if key.endswith(suffix) and key != suffix.lstrip('._'):
            rest = key[: -len(suffix)].replace('_', ' ').replace('.', ' ').strip()
            pretty = camel_to_spaced(rest) if rest else None
            return pretty or rest or None
    return None


def objective_lookup_keys(fname: str) -> list[str]:
    keys = [fname]
    match = re.match(r'^Objective(\d+)$', fname)
    if match:
        n = match.group(1)
        keys.extend([
            f'QuestObjective.{n}',
            f'Quest.Objective.{n}',
            f'Objective_{n}',
            f'Objective.{n}',
        ])
    match = re.match(r'^Objective(Zero|One|Two|Three|Four|Five|Six|Seven|Eight|Nine)$', fname)
    if match:
        n = WORD_NUM[match.group(1)]
        keys.extend([
            f'QuestObjective.{n}',
            f'Quest.Objective.{n}',
            f'Objective.{n}',
        ])
    match = re.match(r'^Objective_(.+)$', fname)
    if match:
        keys.append(f'Objective.{match.group(1)}')
    return keys


def region_from_path(path: str) -> str:
    posix = path.replace('\\', '/')
    if 'Fellhollow' in posix or '/FH_' in posix or '/FH_Quests/' in posix or '/Quest_FH_' in posix:
        return 'Fellhollow'
    if 'UmbralSands' in posix or '/UmS_' in posix or '/UMS_' in posix or '/UmS_Quests/' in posix:
        return 'Umbral Sands'
    if 'DowdunReach' in posix or '/DR_' in posix or '/Quest_DR_' in posix:
        return 'Dowdun Reach'
    if 'ScornedWilderness' in posix or '/SW_' in posix or '/Quest_SW_' in posix:
        return 'Scorned Wilderness'
    if 'FTUE' in posix or 'Brynmoor' in posix:
        return 'Brynmoor'
    return 'Ghornfell'


def kind_from_stem(stem: str, path: str) -> str:
    lower = f'{stem} {path}'.lower()
    if 'task' in lower or 'ftue' in lower or 'tribe' in lower:
        return 'task'
    if stem in MAIN_STEMS or 'mainquest' in lower:
        return 'main'
    return 'side'


def is_hidden(stem: str, name: str) -> bool:
    if re.search(r'_Q\d+$', stem):
        return True
    return name.startswith('[PH]')


def prefixed_objective_entries(bound: dict[str, str], prefix: str | None) -> list[tuple[str, str]]:
    entries = [(key, value) for key, value in bound.items() if is_objective_key(key)]
    if prefix:
        return [(key, value) for key, value in entries if key.startswith(prefix)]
    return entries


def compact_token(value: str) -> str:
    return re.sub(r'[^a-z0-9]', '', value.lower())


def compact_loose(value: str) -> str:
    return compact_token(value).replace('the', '').replace('to', '')


def pretty_fname(fname: str) -> str:
    spaced = fname.replace('_', ' ').replace('.', ' ').replace('/', ' / ')
    spaced = re.sub(r'([a-z])([A-Z])', r'\1 \2', spaced)
    spaced = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1 \2', spaced)
    return re.sub(r'\s+', ' ', spaced).strip() or fname


def fuzzy_objective_text(fname: str, st_objs: list[tuple[str, str]]) -> str | None:
    variants = [compact_token(fname), compact_loose(fname)]
    variants = [re.sub(r'^objective', '', item) for item in variants if len(item) >= 5]
    best_text: str | None = None
    best_score = 0
    for key, text in st_objs:
        hays = [compact_token(key), compact_loose(key)]
        hays = [re.sub(r'^objective', '', item) for item in hays]
        for needle in variants:
            for hay in hays:
                if not hay:
                    continue
                if needle == hay:
                    return text
                if needle in hay or hay in needle:
                    score = min(len(needle), len(hay))
                    if score > best_score:
                        best_score = score
                        best_text = text
    if best_score >= 8:
        return best_text
    return None


def resolve_objective_text(
    fname: str,
    index: int,
    bound: dict[str, str],
    tables: dict[str, dict[str, str]],
    st_objs: list[tuple[str, str]],
    inline: list[str],
    prefix: str | None,
) -> str:
    for key in objective_lookup_keys(fname):
        text = lookup_key(key, bound, tables)
        if text:
            return text
    fuzzy = fuzzy_objective_text(fname, st_objs)
    if fuzzy:
        return fuzzy
    match = re.match(r'^Objective(\d+)$', fname)
    if match and prefix:
        n = match.group(1)
        for key, text in st_objs:
            if key.endswith(f'Objective{n}') or key.endswith(f'_Objective{n}'):
                return text
        slot = int(n) - 1
        if 0 <= slot < len(st_objs):
            return st_objs[slot][1]
    if ' ' in fname:
        return fname
    if re.match(r'^Objective\d+[a-z]?$', fname) and index < len(inline):
        return inline[index]
    pretty = pretty_fname(fname)
    return pretty or fname


def build_objectives(
    namemap: list[Any],
    fkeys: list[str],
    strings: list[str],
    bound: dict[str, str],
    tables: dict[str, dict[str, str]],
    stem: str,
) -> list[dict[str, str]]:
    ids = namemap_objective_ids(namemap)
    if not ids:
        ids = [key for key in fkeys if is_objective_key(key)]
        if not ids:
            ids = [key for key in bound if is_objective_key(key)]
    prefix = ftue_prefix(stem)
    st_objs = prefixed_objective_entries(bound, prefix)
    inline = inline_texts(strings)
    human_pair = bool(st_objs) and len(st_objs) == len(ids) and all(' ' in item for item in ids)
    objectives: list[dict[str, str]] = []
    seen: set[str] = set()
    for index, fname in enumerate(ids):
        if fname in seen:
            continue
        seen.add(fname)
        text = resolve_objective_text(
            fname, index, bound, tables, st_objs, inline, prefix,
        )
        if human_pair and ' ' in fname and index < len(st_objs):
            text = st_objs[index][1]
        objectives.append({'id': fname, 'text': text})
    return objectives


def load_string_tables(root: Path) -> dict[str, dict[str, str]]:
    tables: dict[str, dict[str, str]] = {}
    for path in sorted(root.rglob('ST_*.json')):
        tables[path.stem] = parse_st_map(collect_strings(path))
    return tables


def build_quests(root: Path, tables: dict[str, dict[str, str]]) -> list[dict[str, Any]]:
    quests: list[dict[str, Any]] = []
    for path in sorted(root.rglob('Quest_*.json')):
        data = load_json(path)
        namemap = data.get('NameMap') or []
        strings = collect_strings(path)
        pid = persistence_id(strings)
        if not pid:
            print(f'skip (no pid): {path.stem}')
            continue
        fkeys = [s for s in strings if KEY_RE.match(s) and '\x00' not in s]
        bound = bind_table(path, namemap, tables)
        name = resolve_name(path.stem, fkeys, strings, bound, tables)
        description = resolve_description(path.stem, fkeys, bound, tables)
        posix = path.as_posix()
        quest: dict[str, Any] = {
            'persistenceId': pid,
            'internalName': path.stem,
            'name': name,
            'region': region_from_path(posix),
            'kind': kind_from_stem(path.stem, posix),
            'objectives': build_objectives(namemap, fkeys, strings, bound, tables, path.stem),
        }
        if description:
            quest['description'] = description
        if is_hidden(path.stem, name):
            quest['hidden'] = True
        quests.append(quest)
    quests.sort(key=lambda row: (row.get('region') or '', row.get('name') or ''))
    return quests


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--raw-root', type=Path, default=RAW_ROOT)
    args = parser.parse_args()
    tables = load_string_tables(args.raw_root)
    quests = build_quests(args.raw_root, tables)
    payload = {
        'sourceUsmap': current_usmap_name(),
        'quests': quests,
    }
    out = DATA_DIR / 'quests.json'
    write_json(out, payload)
    named = sum(1 for q in quests if q.get('name') and not q['name'].startswith('Quest_'))
    with_obj = sum(1 for q in quests if q.get('objectives'))
    print(f'Wrote {len(quests)} quests ({named} named, {with_obj} with objectives) -> {out}')


if __name__ == '__main__':
    main()
